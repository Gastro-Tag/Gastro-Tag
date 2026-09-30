import { Prisma, StorageType } from '@prisma/client';
import { prisma } from '../prisma/client';
import { Errors } from '../utils/errors';
import { generateShortCode } from '../utils/dateUtils';
import { calculateDiscard, parseDateOnly } from '../domain/shelfLife';

const capToOriginalExpiry = process.env.CAP_DISCARD_TO_ORIGINAL_EXPIRY !== 'false';

export interface LabelInput {
  productId: string;
  userId: string;
  lot: string;
  responsibleName: string;
  openedAt: string;
  storageType: 'REFRIGERADO' | 'CONGELADO';
  storageTemp: string;
}

export const LabelService = {
  async preview(data: Omit<LabelInput, 'userId' | 'lot' | 'responsibleName'>) {
    const product = await prisma.product.findUnique({ where: { id: data.productId, active: true } });
    if (!product) throw Errors.notFound('Produto');

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

    if (rule && (rule.minTemperature !== null || rule.maxTemperature !== null)) {
      const temp = Number(data.storageTemp.replace(',', '.').replace(/[^\d,.-]/g, ''));
      if (!Number.isFinite(temp)) throw Errors.validation('Informe uma temperatura numérica em °C.');
      if (rule.minTemperature !== null && temp < Number(rule.minTemperature)) {
        throw Errors.validation(`Temperatura abaixo da faixa permitida pela regra (${rule.minTemperature}°C).`);
      }
      if (rule.maxTemperature !== null && temp > Number(rule.maxTemperature)) {
        throw Errors.validation(`Temperatura acima da faixa permitida pela regra (${rule.maxTemperature}°C).`);
      }
    }

    const calculation = calculateDiscard({
      openedAt: data.openedAt,
      shelfLifeDays,
      originalExpiryDate: product.originalExpiryDate,
      capToOriginalExpiry,
    });
    return {
      product: { id: product.id, name: product.name, brand: product.brand },
      storageType: data.storageType,
      openedAt: parseDateOnly(data.openedAt),
      discardAt: calculation.discardAt,
      rule: rule ? {
        id: rule.id, shelfLifeDays: rule.shelfLifeDays, source: rule.source,
        observation: rule.observation, minTemperature: rule.minTemperature, maxTemperature: rule.maxTemperature,
      } : { id: null, shelfLifeDays, source: 'Prazo cadastrado no produto', observation: null },
      originalExpiryDate: product.originalExpiryDate,
      cappedByOriginalExpiry: calculation.cappedByOriginalExpiry,
    };
  },

  async create(data: LabelInput) {
    const preview = await LabelService.preview(data);
    let shortCode = '';
    for (let attempt = 0; attempt < 10; attempt++) {
      shortCode = generateShortCode();
      if (!await prisma.label.findUnique({ where: { shortCode } })) break;
      if (attempt === 9) throw Errors.internal();
    }
    return prisma.label.create({
      data: {
        shortCode, productId: data.productId, userId: data.userId, lot: data.lot,
        openedAt: preview.openedAt, discardAt: preview.discardAt,
        storageType: data.storageType as StorageType, storageTemp: data.storageTemp,
        ruleId: preview.rule.id, shelfLifeDays: preview.rule.shelfLifeDays,
        originalExpiryDate: preview.originalExpiryDate,
        cappedByOriginalExpiry: preview.cappedByOriginalExpiry,
        productName: preview.product.name, productBrand: preview.product.brand,
        responsibleName: data.responsibleName.trim(),
      },
      include: { product: true, user: { select: { name: true } }, rule: true },
    });
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
    return { data: items, meta: { total, page, limit: Math.min(limit, 100), totalPages: Math.ceil(total / Math.min(limit, 100)) } };
  },

  async getById(id: string) {
    const label = await prisma.label.findUnique({
      where: { id }, include: { product: true, user: { select: { name: true, email: true } }, rule: true },
    });
    if (!label) throw Errors.notFound('Etiqueta');
    return label;
  },

  async registerPrint(id: string) {
    return prisma.label.update({ where: { id }, data: { printedAt: new Date(), printCount: { increment: 1 } } });
  },
};
