import { DiscardReason, LabelOutcome, Prisma, ShelfLifeRule, StorageType } from '@prisma/client';
import { prisma } from '../prisma/client';
import { Errors } from '../utils/errors';
import { generateShortCode, kitchenToday } from '../utils/dateUtils';
import { calculateDiscard, calculateSplitDiscard, parseDateOnly } from '../domain/shelfLife';
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

export interface CloseInput {
  outcome: LabelOutcome;
  discardReason?: DiscardReason;
  note?: string;
}

export interface SplitPreviewInput {
  storageType: 'REFRIGERADO' | 'CONGELADO';
  /** Medição em °C. Opcional na prévia; obrigatória ao dividir. */
  storageTemperature?: number;
}

export interface SplitInput extends SplitPreviewInput {
  count: number;
  storageTemperature: number;
  responsibleName: string;
  /** A embalagem original acabou: encerra a origem como USADO na mesma transação. */
  closeParent?: boolean;
  /** Gerado pelo aparelho a cada pedido: o reenvio devolve as filhas já criadas. */
  requestId?: string;
}

export interface Actor { id: string; name: string; role: string }

type Db = Prisma.TransactionClient;

const parentSelect = { select: { id: true, shortCode: true } } as const;
const labelInclude = { product: true, user: { select: { name: true } }, rule: true, parent: parentSelect } as const;

type LabelRow = (Prisma.LabelGetPayload<{ include: { rule: true } }> | Prisma.LabelGetPayload<object>)
  & { parent?: { id: string; shortCode: string } | null };

const dateOnly = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : null);

/** Decimal vira número na resposta, na etiqueta e na regra ligada a ela. */
function serializeLabel<T extends LabelRow>(label: T) {
  const rule = 'rule' in label && label.rule ? serializeRule(label.rule) : ('rule' in label ? null : undefined);
  return {
    ...label,
    storageTemperature: label.storageTemperature === null ? null : Number(label.storageTemperature),
    fractionedAt: dateOnly(label.fractionedAt),
    parent: label.parent ?? null,
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

const alreadyClosed = () => Errors.conflict('Esta etiqueta já foi encerrada.');

/**
 * Serializa encerrar e dividir a mesma etiqueta até o fim da transação: sem isso, uma filha poderia
 * nascer de uma origem que acabou de ser encerrada, ou o mesmo pedido criaria filhas em dobro.
 */
async function lockLabel(tx: Db, labelId: string) {
  const key = `label:${labelId}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
}

/** Regra ativa mais recente do produto; sem ela, a da categoria. Mesma busca na prévia, na etiqueta e no Dividir. */
async function findActiveRule(db: Db, product: { id: string; category: string | null }, storageType: StorageType) {
  return await db.shelfLifeRule.findFirst({
    where: { active: true, productId: product.id, storageType },
    orderBy: { createdAt: 'desc' },
  }) ?? (product.category ? await db.shelfLifeRule.findFirst({
    where: { active: true, productId: null, category: product.category, storageType },
    orderBy: { createdAt: 'desc' },
  }) : null);
}

/** Prazo da regra; sem regra, o cadastrado no produto para o armazenamento. */
function resolveShelfLifeDays(
  rule: ShelfLifeRule | null,
  product: { daysValidRefrigerated: number; daysValidFrozen: number },
  storageType: StorageType,
) {
  const fallbackDays = storageType === 'REFRIGERADO' ? product.daysValidRefrigerated : product.daysValidFrozen;
  const shelfLifeDays = rule?.shelfLifeDays ?? fallbackDays;
  if (shelfLifeDays <= 0) {
    throw Errors.validation(`Produto não possui validade configurada para ${storageType.toLowerCase()}.`);
  }
  return shelfLifeDays;
}

/** Arredonda a medição e confere a faixa da regra. Sem medição (só nas prévias), não confere. */
function checkTemperature(rule: ShelfLifeRule | null, value: number | undefined) {
  const storageTemperature = value === undefined ? null : roundTemperature(value);
  if (rule && storageTemperature !== null) {
    if (rule.minTemperature !== null && storageTemperature < Number(rule.minTemperature)) {
      throw Errors.validation(`Temperatura abaixo da faixa permitida pela regra (${Number(rule.minTemperature)}°C).`);
    }
    if (rule.maxTemperature !== null && storageTemperature > Number(rule.maxTemperature)) {
      throw Errors.validation(`Temperatura acima da faixa permitida pela regra (${Number(rule.maxTemperature)}°C).`);
    }
  }
  return storageTemperature;
}

/** Regra no formato das prévias; sem regra, o prazo do produto marcado como não validado. */
function previewRule(rule: ShelfLifeRule | null, shelfLifeDays: number) {
  return rule ? {
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
  };
}

/** Cálculo da filha a partir da origem. Na criação, a origem já foi lida dentro da transação travada. */
async function computeSplit(
  db: Db,
  parent: { productId: string; discardAt: Date; originalExpiryDate: Date; status: string },
  data: SplitPreviewInput,
) {
  if (parent.status !== 'ATIVA') throw alreadyClosed();
  // Produto removido do catálogo não impede dividir a embalagem que já está aberta.
  const product = await db.product.findUnique({ where: { id: parent.productId } });
  if (!product) throw Errors.notFound('Produto');
  const storageType = data.storageType as StorageType;
  const rule = await findActiveRule(db, product, storageType);
  const shelfLifeDays = resolveShelfLifeDays(rule, product, storageType);
  const storageTemperature = checkTemperature(rule, data.storageTemperature);
  const calculation = calculateSplitDiscard({
    parentDiscardAt: parent.discardAt,
    shelfLifeDays,
    originalExpiryDate: parent.originalExpiryDate,
    capToOriginalExpiry,
    today: kitchenToday(),
  });
  return {
    discardAt: calculation.discardAt,
    cappedByParent: calculation.cappedByParent,
    cappedByOriginalExpiry: calculation.cappedByOriginalExpiry,
    fractionedAt: dateOnly(calculation.fractionedAt)!,
    rule: previewRule(rule, shelfLifeDays),
    storageTemperature,
    storageTemp: storageTemperature === null ? null : formatTemperature(storageTemperature),
  };
}

/** Filhas ainda ativas: o aviso ao encerrar a origem (elas não são encerradas junto). */
function activeChildren(db: Db, parentLabelId: string) {
  return db.label.findMany({
    where: { parentLabelId, status: 'ATIVA' },
    select: { id: true, shortCode: true, discardAt: true },
    orderBy: [{ createdAt: 'asc' }, { shortCode: 'asc' }],
  });
}

async function uniqueShortCodes(db: Db, count: number) {
  const codes = new Set<string>();
  for (let attempt = 0; codes.size < count; attempt++) {
    if (attempt >= 10) throw Errors.internal();
    const candidates = Array.from({ length: count - codes.size }, () => generateShortCode());
    const taken = await db.label.findMany({ where: { shortCode: { in: candidates } }, select: { shortCode: true } });
    const takenCodes = new Set(taken.map((row) => row.shortCode));
    for (const code of candidates) if (!takenCodes.has(code)) codes.add(code);
  }
  return [...codes].slice(0, count);
}

async function splitResult(db: Db, parentId: string, childWhere: Prisma.LabelWhereInput) {
  const parent = await db.label.findUniqueOrThrow({ where: { id: parentId }, include: labelInclude });
  const children = await db.label.findMany({
    where: { parentLabelId: parentId, ...childWhere }, include: labelInclude,
    orderBy: [{ createdAt: 'asc' }, { shortCode: 'asc' }],
  });
  return { parent: serializeLabel(parent), children: children.map(serializeLabel) };
}

export const LabelService = {
  async preview(data: Omit<LabelInput, 'userId' | 'lot' | 'responsibleName'>) {
    const product = await prisma.product.findUnique({ where: { id: data.productId, active: true } });
    if (!product) throw Errors.notFound('Produto');

    const lot = data.lotId ? await LotService.findActiveLot(product.id, data.lotId) : null;
    const expiry = lot?.expiryDate ?? data.originalExpiryDate;
    if (!expiry) throw Errors.validation('Escolha um lote ou informe a validade da embalagem.');
    const originalExpiryDate = parseDateOnly(expiry, 'Validade original');

    const storageType = data.storageType as StorageType;
    const rule = await findActiveRule(prisma, product, storageType);
    const shelfLifeDays = resolveShelfLifeDays(rule, product, storageType);
    const storageTemperature = checkTemperature(rule, data.storageTemperature);

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
      rule: previewRule(rule, shelfLifeDays),
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
    status?: 'ATIVA' | 'ENCERRADA'; due?: 'expired' | 'today' | 'upcoming'; parentLabelId?: string;
  }) {
    const { productId, userId, page = 1, limit = 20, q, from, to, storageType, status, due, parentLabelId } = filters;
    // Vencimento pela data da cozinha: vencida antes de hoje, vence hoje, vence depois.
    const today = kitchenToday();
    const dueWhere: Prisma.DateTimeFilter | undefined = due === 'expired' ? { lt: today }
      : due === 'today' ? { equals: today }
        : due === 'upcoming' ? { gt: today } : undefined;
    const where: Prisma.LabelWhereInput = {
      ...(productId && { productId }), ...(userId && { userId }), ...(storageType && { storageType }),
      ...(status && { status }), ...(parentLabelId && { parentLabelId }),
      ...(dueWhere && { discardAt: dueWhere }),
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
        include: {
          product: { select: { name: true, brand: true } }, user: { select: { name: true } }, rule: true,
          parent: parentSelect, _count: { select: { children: true } },
        },
      }),
    ]);
    const data = items.map(({ _count, ...item }) => ({ ...serializeLabel(item), childrenCount: _count.children }));
    return { data, meta: { total, page, limit: Math.min(limit, 100), totalPages: Math.ceil(total / Math.min(limit, 100)) } };
  },

  async getById(id: string) {
    const label = await prisma.label.findUnique({
      where: { id },
      include: {
        product: true, user: { select: { name: true, email: true } }, rule: true, parent: parentSelect,
        children: {
          select: { id: true, shortCode: true, status: true, discardAt: true },
          orderBy: [{ createdAt: 'asc' }, { shortCode: 'asc' }],
        },
      },
    });
    if (!label) throw Errors.notFound('Etiqueta');
    return serializeLabel(label);
  },

  async registerPrint(id: string) {
    // Só conta a impressão de etiqueta ativa: encerrada não volta para a bancada.
    const updated = await prisma.label.updateMany({
      where: { id, status: 'ATIVA' }, data: { printedAt: new Date(), printCount: { increment: 1 } },
    });
    if (updated.count === 0) {
      const exists = await prisma.label.findUnique({ where: { id }, select: { id: true } });
      if (!exists) throw Errors.notFound('Etiqueta');
      throw Errors.conflict('Etiqueta encerrada não pode ser reimpressa.');
    }
    const label = await prisma.label.findUniqueOrThrow({ where: { id }, include: { parent: parentSelect } });
    return serializeLabel(label);
  },

  /**
   * Registra o destino da etiqueta. Sem desfazer. Repetir o mesmo destino devolve a etiqueta como está;
   * outro destino numa etiqueta já encerrada é conflito. Filhas ativas não são encerradas junto.
   */
  async close(id: string, data: CloseInput, actor: Actor) {
    if (data.outcome === 'CANCELADO' && actor.role !== 'ADMIN') throw Errors.forbidden();
    return prisma.$transaction(async (tx) => {
      await lockLabel(tx, id);
      const current = await tx.label.findUnique({
        where: { id }, select: { status: true, outcome: true, discardReason: true },
      });
      if (!current) throw Errors.notFound('Etiqueta');
      const replayed = current.status === 'ENCERRADA';
      if (replayed) {
        const sameOutcome = current.outcome === data.outcome
          && (current.discardReason ?? null) === (data.discardReason ?? null);
        if (!sameOutcome) throw alreadyClosed();
      } else {
        await tx.label.update({
          where: { id },
          data: {
            status: 'ENCERRADA', outcome: data.outcome, discardReason: data.discardReason ?? null,
            closeNote: data.note ?? null, closedAt: new Date(), closedById: actor.id, closedByName: actor.name,
          },
        });
      }
      const label = await tx.label.findUniqueOrThrow({ where: { id }, include: labelInclude });
      return { label: serializeLabel(label), activeChildren: await activeChildren(tx, id), replayed };
    }, { timeout: 15_000 });
  },

  async splitPreview(id: string, data: SplitPreviewInput) {
    const parent = await prisma.label.findUnique({ where: { id } });
    if (!parent) throw Errors.notFound('Etiqueta');
    return computeSplit(prisma, parent, data);
  },

  /**
   * Cria `count` filhas da etiqueta numa transação, travada por origem. `replayed`: o mesmo pedido
   * (mesmo `requestId` para a mesma origem) já tinha criado as filhas, que são devolvidas sem criar outras.
   */
  async split(id: string, data: SplitInput, actor: Actor) {
    const replayWhere = data.requestId ? { splitRequestId: data.requestId } : null;
    const hasReplay = async (db: Db) =>
      replayWhere !== null && await db.label.count({ where: { parentLabelId: id, ...replayWhere } }) > 0;

    // Reenvio: vale mesmo depois que a origem foi encerrada por este pedido (closeParent).
    if (await hasReplay(prisma)) return { ...await splitResult(prisma, id, replayWhere!), replayed: true };

    return prisma.$transaction(async (tx) => {
      await lockLabel(tx, id);
      // Dois envios simultâneos do mesmo pedido: o segundo espera a trava e encontra as filhas do primeiro.
      if (await hasReplay(tx)) return { ...await splitResult(tx, id, replayWhere!), replayed: true };

      const parent = await tx.label.findUnique({ where: { id } });
      if (!parent) throw Errors.notFound('Etiqueta');
      const calculation = await computeSplit(tx, parent, data);
      const codes = await uniqueShortCodes(tx, data.count);
      const fractionedAt = parseDateOnly(calculation.fractionedAt);
      const childIds: string[] = [];
      for (const shortCode of codes) {
        const child = await tx.label.create({
          data: {
            shortCode, productId: parent.productId, userId: actor.id,
            lot: parent.lot, lotId: parent.lotId,
            openedAt: parent.openedAt, discardAt: calculation.discardAt,
            storageType: data.storageType as StorageType,
            storageTemperature: calculation.storageTemperature, storageTemp: calculation.storageTemp!,
            ruleId: calculation.rule.id, shelfLifeDays: calculation.rule.shelfLifeDays,
            ruleVersion: calculation.rule.version, ruleSource: calculation.rule.source,
            originalExpiryDate: parent.originalExpiryDate,
            cappedByOriginalExpiry: calculation.cappedByOriginalExpiry,
            productName: parent.productName, productBrand: parent.productBrand,
            responsibleName: data.responsibleName.trim(),
            parentLabelId: parent.id, fractionedAt, splitRequestId: data.requestId,
            cappedByParent: calculation.cappedByParent,
          },
          select: { id: true },
        });
        childIds.push(child.id);
      }
      if (data.closeParent) {
        await tx.label.update({
          where: { id },
          data: {
            // Quem encerrou é o responsável do turno informado; a conta logada fica em closedById.
            status: 'ENCERRADA', outcome: 'USADO', closedAt: new Date(),
            closedById: actor.id, closedByName: data.responsibleName.trim(),
          },
        });
      }
      return { ...await splitResult(tx, id, { id: { in: childIds } }), replayed: false };
    }, { timeout: 15_000 });
  },
};
