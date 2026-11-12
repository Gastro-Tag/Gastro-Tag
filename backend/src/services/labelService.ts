import { Prisma, StorageType } from '@prisma/client';
import { prisma } from '../prisma/client';
import { Errors } from '../utils/errors';
import { generateShortCode, kitchenToday } from '../utils/dateUtils';
import { calculateDiscard, parseDateOnly } from '../domain/shelfLife';
import { formatTemperature, roundTemperature } from '../domain/temperature';
import { LotService } from './lotService';
import { serializeRule } from './ruleService';

const capToOriginalExpiry = process.env.CAP_DISCARD_TO_ORIGINAL_EXPIRY !== 'false';

/** Fonte gravada na etiqueta quando o prazo vem do cadastro do produto. */
export const PRODUCT_DAYS_SOURCE = 'Prazo cadastrado no produto (sem regra validada)';

export interface LabelInput {
  productId: string;
  userId: string;
  /** Lote cadastrado. Sem ele, valem `lot` e `originalExpiryDate` da embalagem em mãos. */
  lotId?: string;
  lot?: string;
  originalExpiryDate?: string;
  responsibleName: string;
  /** Sem valor, vale a data atual da cozinha, não o relógio do aparelho. */
  openedAt?: string;
  storageType: 'REFRIGERADO' | 'CONGELADO';
  /** Medição em °C. Opcional na prévia (sem ela a faixa da regra não é conferida); obrigatória na etiqueta. */
  storageTemperature?: number;
  /** Gerado pelo aparelho a cada pedido: o reenvio do mesmo pedido devolve a etiqueta já criada. */
  requestId?: string;
}

const labelInclude = { product: true, user: { select: { name: true } }, rule: true } as const;

type LabelRow = Prisma.LabelGetPayload<{ include: { rule: true } }> | Prisma.LabelGetPayload<object>;

/** Decimal vira número na resposta, na etiqueta e na regra ligada a ela. */
function serializeLabel<T extends LabelRow>(label: T) {
  const rule = 'rule' in label && label.rule ? serializeRule(label.rule) : ('rule' in label ? null : undefined);
  return {
    ...label,
    storageTemperature: label.storageTemperature === null ? null : Number(label.storageTemperature),
    ...(rule !== undefined && { rule }),
  };
}

async function findReplay(data: LabelInput) {
  if (!data.requestId) return null;
  const existing = await prisma.label.findUnique({
    where: { userId_requestId: { userId: data.userId, requestId: data.requestId } },
    include: labelInclude,
  });
  if (existing && existing.productId !== data.productId) {
    throw Errors.conflict('Este pedido já gerou uma etiqueta de outro produto.');
  }
  return existing;
}

export const LabelService = {
  async preview(data: Omit<LabelInput, 'userId' | 'lot' | 'responsibleName'>) {
    const product = await prisma.product.findUnique({ where: { id: data.productId, active: true } });
    if (!product) throw Errors.notFound('Produto');

    const lot = data.lotId ? await LotService.findActiveLot(product.id, data.lotId) : null;
    const expiry = lot?.expiryDate ?? data.originalExpiryDate;
    if (!expiry) throw Errors.validation('Escolha um lote ou informe a validade da embalagem.');
    const originalExpiryDate = parseDateOnly(expiry, 'Validade original');

    const rule = await prisma.shelfLifeRule.findFirst({
      where: { active: true, productId: product.id, storageType: data.storageType as StorageType },
      orderBy: { createdAt: 'desc' },
    }) ?? (product.category ? await prisma.shelfLifeRule.findFirst({
      where: { active: true, productId: null, category: product.category, storageType: data.storageType as StorageType },
      orderBy: { createdAt: 'desc' },
    }) : null);
    const fallbackDays = data.storageType === 'REFRIGERADO'
      ? product.daysValidRefrigerated : product.daysValidFrozen;
    const shelfLifeDays = rule?.shelfLifeDays ?? fallbackDays;
    if (shelfLifeDays <= 0) {
      throw Errors.validation(`Produto não possui validade configurada para ${data.storageType.toLowerCase()}.`);
    }

    const storageTemperature = data.storageTemperature === undefined
      ? null : roundTemperature(data.storageTemperature);
    if (rule && storageTemperature !== null) {
      if (rule.minTemperature !== null && storageTemperature < Number(rule.minTemperature)) {
        throw Errors.validation(`Temperatura abaixo da faixa permitida pela regra (${Number(rule.minTemperature)}°C).`);
      }
      if (rule.maxTemperature !== null && storageTemperature > Number(rule.maxTemperature)) {
        throw Errors.validation(`Temperatura acima da faixa permitida pela regra (${Number(rule.maxTemperature)}°C).`);
      }
    }

    const today = kitchenToday();
    const openedAt = data.openedAt ?? today;
    const calculation = calculateDiscard({
      openedAt,
      shelfLifeDays,
      originalExpiryDate,
      capToOriginalExpiry,
      today,
    });
    return {
      product: { id: product.id, name: product.name, brand: product.brand },
      storageType: data.storageType,
      lot: lot ? { id: lot.id, code: lot.code } : null,
      openedAt: parseDateOnly(openedAt),
      discardAt: calculation.discardAt,
      rule: rule ? {
        id: rule.id, shelfLifeDays: rule.shelfLifeDays, source: rule.source, sourceType: rule.sourceType,
        observation: rule.observation,
        minTemperature: rule.minTemperature === null ? null : Number(rule.minTemperature),
        maxTemperature: rule.maxTemperature === null ? null : Number(rule.maxTemperature),
        version: rule.version, validatedByName: rule.validatedByName,
        validatedAt: rule.validatedAt ? rule.validatedAt.toISOString().slice(0, 10) : null,
        // Veio de uma regra cadastrada pelo ADMIN (mesmo critério da etiqueta, da impressão e do histórico).
        validated: true,
      } : {
        id: null, shelfLifeDays, source: PRODUCT_DAYS_SOURCE, sourceType: null, observation: null,
        minTemperature: null, maxTemperature: null, version: null,
        validatedByName: null, validatedAt: null, validated: false,
      },
      storageTemperature,
      storageTemp: storageTemperature === null ? null : formatTemperature(storageTemperature),
      originalExpiryDate,
      cappedByOriginalExpiry: calculation.cappedByOriginalExpiry,
    };
  },

  /** `replayed`: o mesmo pedido já tinha gerado esta etiqueta (rede caiu, toque repetido). */
  async create(data: LabelInput) {
    const replay = await findReplay(data);
    if (replay) return { label: serializeLabel(replay), replayed: true };

    if (data.storageTemperature === undefined) throw Errors.validation('Informe a temperatura medida em °C.');
    const preview = await LabelService.preview(data);
    const lot = preview.lot?.code ?? data.lot;
    if (!lot) throw Errors.validation('Informe o lote da embalagem.');
    let shortCode = '';
    for (let attempt = 0; attempt < 10; attempt++) {
      shortCode = generateShortCode();
      if (!await prisma.label.findUnique({ where: { shortCode } })) break;
      if (attempt === 9) throw Errors.internal();
    }
    try {
      const label = await prisma.label.create({
        data: {
          shortCode, productId: data.productId, userId: data.userId, lot, lotId: preview.lot?.id,
          openedAt: preview.openedAt, discardAt: preview.discardAt,
          storageType: data.storageType as StorageType,
          storageTemperature: preview.storageTemperature, storageTemp: preview.storageTemp!,
          ruleId: preview.rule.id, shelfLifeDays: preview.rule.shelfLifeDays,
          ruleVersion: preview.rule.version, ruleSource: preview.rule.source,
          originalExpiryDate: preview.originalExpiryDate,
          cappedByOriginalExpiry: preview.cappedByOriginalExpiry,
          productName: preview.product.name, productBrand: preview.product.brand,
          responsibleName: data.responsibleName.trim(),
          requestId: data.requestId,
        },
        include: labelInclude,
      });
      return { label: serializeLabel(label), replayed: false };
    } catch (error) {
      // Dois envios simultâneos do mesmo pedido: o segundo perde na chave única e devolve o primeiro.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const raced = await findReplay(data);
        if (raced) return { label: serializeLabel(raced), replayed: true };
      }
      throw error;
    }
  },

  async list(filters: {
    productId?: string; userId?: string; page?: number; limit?: number;
    q?: string; from?: string; to?: string; storageType?: 'REFRIGERADO' | 'CONGELADO';
  }) {
    const { productId, userId, page = 1, limit = 20, q, from, to, storageType } = filters;
    const where: Prisma.LabelWhereInput = {
      ...(productId && { productId }), ...(userId && { userId }), ...(storageType && { storageType }),
      ...((from || to) && { openedAt: {
        ...(from && { gte: parseDateOnly(from, 'Data inicial') }),
        ...(to && { lte: parseDateOnly(to, 'Data final') }),
      } }),
      ...(q && { OR: [
        { productName: { contains: q, mode: 'insensitive' } },
        { productBrand: { contains: q, mode: 'insensitive' } },
        { lot: { contains: q, mode: 'insensitive' } },
        { shortCode: { contains: q, mode: 'insensitive' } },
      ] }),
    };
    const [total, items] = await Promise.all([
      prisma.label.count({ where }),
      prisma.label.findMany({
        where, skip: (page - 1) * limit, take: Math.min(limit, 100),
        orderBy: { createdAt: 'desc' },
        include: { product: { select: { name: true, brand: true } }, user: { select: { name: true } }, rule: true },
      }),
    ]);
    return { data: items.map(serializeLabel), meta: { total, page, limit: Math.min(limit, 100), totalPages: Math.ceil(total / Math.min(limit, 100)) } };
  },

  async getById(id: string) {
    const label = await prisma.label.findUnique({
      where: { id }, include: { product: true, user: { select: { name: true, email: true } }, rule: true },
    });
    if (!label) throw Errors.notFound('Etiqueta');
    return serializeLabel(label);
  },

  async registerPrint(id: string) {
    const label = await prisma.label.update({ where: { id }, data: { printedAt: new Date(), printCount: { increment: 1 } } });
    return serializeLabel(label);
  },
};
