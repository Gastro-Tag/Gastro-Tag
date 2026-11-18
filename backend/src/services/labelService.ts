import { DiscardReason, LabelOutcome, LabelStatus, Prisma, ShelfLifeRule, StorageType } from '@prisma/client';
import { prisma } from '../prisma/client';
import { Errors } from '../utils/errors';
import {
  addDays, addMonths, daysBetween, formatDateBR, formatKitchenDateTime, generateShortCode, kitchenDayStartInstant,
  kitchenToday, MAX_BACKDATE_DAYS,
} from '../utils/dateUtils';
import { toCsv } from '../utils/csv';
import { calculateDiscard, calculateSplitDiscard, parseDateOnly } from '../domain/shelfLife';
import { formatTemperature, roundTemperature } from '../domain/temperature';
import { LotService } from './lotService';
import { serializeRule } from './ruleService';
import { SettingsService } from './settingsService';

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
  /** Operador confirmado com PIN (o nome dele já vem em `responsibleName`); nulo: nome digitado. */
  handlerId?: string | null;
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
  /** Quem encerrou: operador com PIN ou nome digitado no totem. Sem valor, o nome da conta logada. */
  closedByName?: string;
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
  /** Operador confirmado com PIN (o nome dele já vem em `responsibleName`); nulo: nome digitado. */
  handlerId?: string | null;
  /** A embalagem original acabou: encerra a origem como USADO na mesma transação. */
  closeParent?: boolean;
  /** Gerado pelo aparelho a cada pedido: o reenvio devolve as filhas já criadas. */
  requestId?: string;
}

export interface Actor { id: string; name: string; role: string }

/** Quem fez a etiqueta: operador confirmado com PIN (handlerId) ou nome digitado (handlerId nulo). */
export interface Responsible { responsibleName: string; handlerId: string | null }

/**
 * Resolve o responsável só depois de conferir o reenvio: o mesmo pedido devolve o que já foi criado
 * mesmo que o token do operador tenha vencido ou o PIN tenha mudado nesse meio tempo.
 */
export type ResolveResponsible = () => Promise<Responsible>;

const typedResponsible = (data: { responsibleName: string; handlerId?: string | null }): ResolveResponsible =>
  async () => ({ responsibleName: data.responsibleName, handlerId: data.handlerId ?? null });

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
    handlerVerified: label.handlerId !== null,
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

/**
 * Regra ativa mais recente do produto; sem ela, a da categoria. Mesma busca na prévia, na etiqueta e no Dividir.
 * Ao mudar o critério, mude junto `hasActiveRuleFor` (lista de produtos sem regra).
 */
async function findActiveRule(db: Db, product: { id: string; category: string | null }, storageType: StorageType) {
  return await db.shelfLifeRule.findFirst({
    where: { active: true, productId: product.id, storageType },
    orderBy: { createdAt: 'desc' },
  }) ?? (product.category ? await db.shelfLifeRule.findFirst({
    where: { active: true, productId: null, category: product.category, storageType },
    orderBy: { createdAt: 'desc' },
  }) : null);
}

/**
 * Mesmo critério de `findActiveRule`, em memória, para cruzar muitas regras ativas de uma vez:
 * regra do produto; senão, regra sem produto com a categoria exatamente igual (sem categoria, não há).
 */
export function hasActiveRuleFor(
  activeRules: { productId: string | null; category: string | null; storageType: StorageType }[],
  product: { id: string; category: string | null },
  storageType: StorageType,
) {
  return activeRules.some((rule) => rule.storageType === storageType && (
    rule.productId === product.id
    || (!!product.category && rule.productId === null && rule.category === product.category)
  ));
}

/** Prazo cadastrado no produto para o armazenamento (usado quando não há regra). */
export function productShelfLifeDays(
  product: { daysValidRefrigerated: number; daysValidFrozen: number },
  storageType: StorageType,
) {
  return storageType === 'REFRIGERADO' ? product.daysValidRefrigerated : product.daysValidFrozen;
}

/** Prazo da regra; sem regra, o cadastrado no produto para o armazenamento. */
function resolveShelfLifeDays(
  rule: ShelfLifeRule | null,
  product: { daysValidRefrigerated: number; daysValidFrozen: number },
  storageType: StorageType,
  requireValidatedRule: boolean,
) {
  const fallbackDays = productShelfLifeDays(product, storageType);
  const shelfLifeDays = rule?.shelfLifeDays ?? fallbackDays;
  if (shelfLifeDays <= 0) {
    throw Errors.validation(`Produto não possui validade configurada para ${storageType.toLowerCase()}.`);
  }
  // Mesma condição de `rule.validated === false` e de `listWithoutRule` (que não conta 0 dias, recusado acima).
  if (!rule && requireValidatedRule) throw Errors.ruleRequired();
  return shelfLifeDays;
}

/**
 * Regra e prazo para a prévia, a etiqueta e o Dividir: ponto único da busca da regra e do bloqueio
 * "exigir regra validada". A configuração é lida aqui, uma vez por pedido, com o mesmo `db` (a
 * transação do Dividir, quando houver).
 */
async function resolveShelfLife(
  db: Db,
  product: { id: string; category: string | null; daysValidRefrigerated: number; daysValidFrozen: number },
  storageType: StorageType,
) {
  const rule = await findActiveRule(db, product, storageType);
  const settings = await SettingsService.get(db);
  return { rule, shelfLifeDays: resolveShelfLifeDays(rule, product, storageType, settings.requireValidatedRule) };
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
  const { rule, shelfLifeDays } = await resolveShelfLife(db, product, storageType);
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

export interface LabelFilters {
  productId?: string; userId?: string; q?: string; from?: string; to?: string;
  storageType?: 'REFRIGERADO' | 'CONGELADO';
  status?: 'ATIVA' | 'ENCERRADA'; due?: 'expired' | 'today' | 'upcoming'; parentLabelId?: string;
}

/**
 * Filtros da lista e da exportação. O período (`from`/`to`) vale para a data de abertura na lista e
 * para a data de criação (dia da cozinha) na exportação.
 */
function labelWhere(filters: LabelFilters, period: 'openedAt' | 'createdAt'): Prisma.LabelWhereInput {
  const { productId, userId, q, from, to, storageType, status, due, parentLabelId } = filters;
  // Vencimento pela data da cozinha: vencida antes de hoje, vence hoje, vence depois.
  const today = kitchenToday();
  const dueWhere: Prisma.DateTimeFilter | undefined = due === 'expired' ? { lt: today }
    : due === 'today' ? { equals: today }
      : due === 'upcoming' ? { gt: today } : undefined;
  const fromDate = from ? parseDateOnly(from, 'Data inicial') : undefined;
  const toDate = to ? parseDateOnly(to, 'Data final') : undefined;
  const periodWhere: Prisma.LabelWhereInput | undefined = !fromDate && !toDate ? undefined
    : period === 'openedAt'
      ? { openedAt: { ...(fromDate && { gte: fromDate }), ...(toDate && { lte: toDate }) } }
      // Criada em: do início do dia inicial até antes do início do dia seguinte ao final, no fuso da cozinha.
      : { createdAt: {
        ...(fromDate && { gte: kitchenDayStartInstant(fromDate) }),
        ...(toDate && { lt: kitchenDayStartInstant(addDays(toDate, 1)) }),
      } };
  return {
    ...(productId && { productId }), ...(userId && { userId }), ...(storageType && { storageType }),
    ...(status && { status }), ...(parentLabelId && { parentLabelId }),
    ...(dueWhere && { discardAt: dueWhere }),
    ...periodWhere,
    ...(q && { OR: [
      { productName: { contains: q, mode: 'insensitive' } },
      { productBrand: { contains: q, mode: 'insensitive' } },
      { lot: { contains: q, mode: 'insensitive' } },
      { shortCode: { contains: q, mode: 'insensitive' } },
    ] }),
  };
}

const listInclude = {
  product: { select: { name: true, brand: true } }, user: { select: { name: true } }, rule: true,
  parent: parentSelect, _count: { select: { children: true } },
} as const;

function withChildrenCount({ _count, ...item }: Prisma.LabelGetPayload<{ include: typeof listInclude }>) {
  return { ...serializeLabel(item), childrenCount: _count.children };
}

const DUE_GROUP_LIMIT = 100;

/**
 * Temperatura negativa com o sinal de menos U+2212 ("−18,0 °C"): a planilha não a lê como fórmula,
 * então não precisa do apóstrofo do escape genérico.
 */
const csvTemperature = (text: string) => text.replace(/^-/, '\u2212');
const CSV_MAX_ROWS = 10_000;

const CSV_HEADER = [
  'Código', 'Produto', 'Marca', 'Lote', 'Validade do fabricante', 'Abertura', 'Fracionado em', 'Origem (código)',
  'Armazenamento', 'Temperatura', 'Descarte', 'Prazo (dias)', 'Regra', 'Responsável', 'Operador com PIN',
  'Situação', 'Destino', 'Motivo', 'Observação', 'Encerrado em', 'Encerrado por', 'Criada em',
];
const STORAGE_LABELS: Record<StorageType, string> = { REFRIGERADO: 'Refrigerado', CONGELADO: 'Congelado' };
const STATUS_LABELS: Record<LabelStatus, string> = { ATIVA: 'Ativa', ENCERRADA: 'Encerrada' };
const OUTCOME_LABELS: Record<LabelOutcome, string> = { USADO: 'Usado', DESCARTADO: 'Descartado', CANCELADO: 'Cancelado' };
const REASON_LABELS: Record<DiscardReason, string> = {
  PRAZO_VENCIDO: 'Prazo vencido', ALTERACAO_SENSORIAL: 'Alteração sensorial',
  EMBALAGEM_DANIFICADA: 'Embalagem danificada', OUTRO: 'Outro',
};

/** Etiquetas e lotes considerados no histórico do produto (os mais recentes de cada um). */
const EXPIRY_HISTORY_LIMIT = 200;
/** Mínimo de registros para o histórico valer como referência. */
const EXPIRY_HISTORY_MIN = 3;

export interface ExpiryWarning {
  /** ABOVE_LIMIT: passa do limite configurado; ABOVE_HISTORY: passa da mediana do histórico + folga. */
  reason: 'ABOVE_HISTORY' | 'ABOVE_LIMIT';
  /** Dias entre a abertura e a validade digitada. */
  typedDays: number;
  /** ABOVE_LIMIT: dias até abertura + N meses; ABOVE_HISTORY: a mediana do histórico (arredondada). */
  referenceDays: number;
  /** Limite configurado em meses (nulo: desligado). */
  limitMonths: number | null;
}

/**
 * Folga sobre a mediana do histórico. Heurística para pegar o erro de digitação do ano (que soma
 * ~365 dias à validade) sem avisar a cada embalagem um pouco mais nova; não é limite regulatório.
 */
const EXPIRY_HISTORY_MARGIN_DAYS = 180;

/**
 * Mediana do prazo "validade do fabricante − abertura/cadastro" já registrado para o produto, em uma
 * consulta. Mediana, não o máximo: uma etiqueta com o ano errado não desliga o aviso. Entram as
 * últimas etiquetas de origem com validade digitada (as filhas do Dividir repetem a embalagem da
 * origem; as de lote já contam pelo lote), exceto as canceladas, e os últimos lotes (validade − dia
 * do cadastro na cozinha), ativos ou não.
 */
async function expiryHistory(productId: string) {
  const timeZone = process.env.KITCHEN_TIME_ZONE || 'America/Manaus';
  const [row] = await prisma.$queryRaw<{ count: number; median: number | null }[]>`
    SELECT COUNT(*)::int AS count,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY days)::float8 AS median
    FROM (
      (SELECT l.original_expiry_date - l.opened_at AS days
        FROM labels l
        WHERE l.product_id = ${productId} AND l.parent_label_id IS NULL AND l.lot_id IS NULL
          AND l.outcome IS DISTINCT FROM 'CANCELADO'
        ORDER BY l.created_at DESC LIMIT ${EXPIRY_HISTORY_LIMIT})
      UNION ALL
      (SELECT pl.expiry_date - (pl.created_at AT TIME ZONE 'UTC' AT TIME ZONE ${timeZone})::date AS days
        FROM product_lots pl
        WHERE pl.product_id = ${productId}
        ORDER BY pl.created_at DESC LIMIT ${EXPIRY_HISTORY_LIMIT})
    ) history`;
  return row ?? { count: 0, median: null };
}

/**
 * Aviso (não bloqueia) para validade digitada muito distante da abertura, ex.: 2027 no lugar de 2026,
 * que anularia o teto pela validade do fabricante. O limite em meses é da cozinha e vem desligado;
 * o histórico só vale com ao menos 3 registros e avisa acima da mediana + folga. Os dois valendo,
 * prevalece o limite.
 */
async function expiryWarningFor(productId: string, openedAt: Date, originalExpiryDate: Date): Promise<ExpiryWarning | null> {
  const typedDays = daysBetween(openedAt, originalExpiryDate);
  const { expiryWarningMonths: limitMonths } = await SettingsService.get();
  if (limitMonths !== null) {
    const limit = addMonths(openedAt, limitMonths);
    if (originalExpiryDate > limit) {
      return { reason: 'ABOVE_LIMIT', typedDays, referenceDays: daysBetween(openedAt, limit), limitMonths };
    }
  }
  const history = await expiryHistory(productId);
  if (history.count < EXPIRY_HISTORY_MIN || history.median === null) return null;
  const referenceDays = Math.round(history.median);
  if (typedDays > referenceDays + EXPIRY_HISTORY_MARGIN_DAYS) {
    return { reason: 'ABOVE_HISTORY', typedDays, referenceDays, limitMonths };
  }
  return null;
}

/** Cálculo comum à prévia e à etiqueta (a etiqueta não consulta o aviso de validade). */
async function computePreview(data: Omit<LabelInput, 'userId' | 'lot' | 'responsibleName'>) {
  const product = await prisma.product.findUnique({ where: { id: data.productId, active: true } });
  if (!product) throw Errors.notFound('Produto');

  const lot = data.lotId ? await LotService.findActiveLot(product.id, data.lotId) : null;
  const expiry = lot?.expiryDate ?? data.originalExpiryDate;
  if (!expiry) throw Errors.validation('Escolha um lote ou informe a validade da embalagem.');
  const originalExpiryDate = parseDateOnly(expiry, 'Validade original');

  const storageType = data.storageType as StorageType;
  const { rule, shelfLifeDays } = await resolveShelfLife(prisma, product, storageType);
  const storageTemperature = checkTemperature(rule, data.storageTemperature);

  const today = kitchenToday();
  const openedAt = data.openedAt ?? today;
  const calculation = calculateDiscard({
    openedAt,
    shelfLifeDays,
    originalExpiryDate,
    capToOriginalExpiry,
    today,
    // Só a data digitada tem limite para trás; sem ela, vale hoje.
    earliestOpenedAt: data.openedAt ? addDays(today, -MAX_BACKDATE_DAYS) : null,
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
}

export const LabelService = {
  /** `expiryWarning` só para a validade digitada (sem lote cadastrado). */
  async preview(data: Omit<LabelInput, 'userId' | 'lot' | 'responsibleName'>) {
    const result = await computePreview(data);
    const expiryWarning = data.lotId ? null
      : await expiryWarningFor(result.product.id, result.openedAt, result.originalExpiryDate);
    return { ...result, expiryWarning };
  },

  /** `replayed`: o mesmo pedido já tinha gerado esta etiqueta (rede caiu, toque repetido). */
  async create(data: LabelInput, resolveResponsible: ResolveResponsible = typedResponsible(data)) {
    const replay = await findReplay(data);
    if (replay) return { label: serializeLabel(replay), replayed: true };
    const responsible = await resolveResponsible();

    if (data.storageTemperature === undefined) throw Errors.validation('Informe a temperatura medida em °C.');
    const preview = await computePreview(data);
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
          responsibleName: responsible.responsibleName.trim(), handlerId: responsible.handlerId,
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

  async list(filters: LabelFilters & { page?: number; limit?: number }) {
    const { page = 1, limit = 20 } = filters;
    const where = labelWhere(filters, 'openedAt');
    const [total, items] = await Promise.all([
      prisma.label.count({ where }),
      prisma.label.findMany({
        where, skip: (page - 1) * limit, take: Math.min(limit, 100),
        orderBy: { createdAt: 'desc' },
        include: listInclude,
      }),
    ]);
    const data = items.map(withChildrenCount);
    return { data, meta: { total, page, limit: Math.min(limit, 100), totalPages: Math.ceil(total / Math.min(limit, 100)) } };
  },

  /**
   * Descarte do dia: etiquetas ativas vencidas, que vencem hoje e amanhã, pela data da cozinha.
   * Cada lista vem ordenada pelo descarte e limitada a 100; as contagens são os totais.
   */
  async due() {
    const today = kitchenToday();
    const group = async (discardAt: Prisma.DateTimeFilter) => {
      const where: Prisma.LabelWhereInput = { status: 'ATIVA', discardAt };
      const [count, items] = await Promise.all([
        prisma.label.count({ where }),
        prisma.label.findMany({
          where, take: DUE_GROUP_LIMIT, include: listInclude,
          orderBy: [{ discardAt: 'asc' }, { createdAt: 'asc' }],
        }),
      ]);
      return { count, items: items.map(withChildrenCount) };
    };
    const [expired, dueToday, tomorrow] = await Promise.all([
      group({ lt: today }), group({ equals: today }), group({ equals: addDays(today, 1) }),
    ]);
    return {
      data: { expired: expired.items, today: dueToday.items, tomorrow: tomorrow.items },
      meta: {
        counts: { expired: expired.count, today: dueToday.count, tomorrow: tomorrow.count },
        kitchenToday: dateOnly(today)!,
      },
    };
  },

  /** Histórico em CSV (planilha). Mesmos filtros da lista; o período é pela data de criação na cozinha. */
  async exportCsv(filters: LabelFilters) {
    const where = labelWhere(filters, 'createdAt');
    const total = await prisma.label.count({ where });
    if (total > CSV_MAX_ROWS) {
      throw Errors.validation(
        `A exportação teria ${total.toLocaleString('pt-BR')} etiquetas (máximo ${CSV_MAX_ROWS.toLocaleString('pt-BR')}). Escolha um período menor.`,
      );
    }
    const labels = await prisma.label.findMany({
      where, orderBy: { createdAt: 'desc' }, take: CSV_MAX_ROWS, include: { parent: parentSelect },
    });
    const date = (value: Date | null) => (value ? formatDateBR(value) : '');
    const dateTime = (value: Date | null) => (value ? formatKitchenDateTime(value) : '');
    const rows = labels.map((label) => [
      label.shortCode, label.productName, label.productBrand, label.lot,
      date(label.originalExpiryDate), date(label.openedAt), date(label.fractionedAt), label.parent?.shortCode ?? '',
      STORAGE_LABELS[label.storageType], csvTemperature(label.storageTemp), date(label.discardAt), String(label.shelfLifeDays),
      label.ruleId
        ? [label.ruleVersion ? `v${label.ruleVersion}` : null, label.ruleSource].filter(Boolean).join(' - ')
        : 'sem regra validada',
      label.responsibleName ?? '', label.handlerId ? 'sim' : 'não',
      STATUS_LABELS[label.status], label.outcome ? OUTCOME_LABELS[label.outcome] : '',
      label.discardReason ? REASON_LABELS[label.discardReason] : '', label.closeNote ?? '',
      dateTime(label.closedAt), label.closedByName ?? '', dateTime(label.createdAt),
    ]);
    return {
      csv: toCsv(CSV_HEADER, rows),
      filename: `etiquetas-${dateOnly(kitchenToday())}.csv`,
    };
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
            closeNote: data.note ?? null, closedAt: new Date(), closedById: actor.id,
            closedByName: data.closedByName?.trim() || actor.name,
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
  async split(id: string, data: SplitInput, actor: Actor, resolveResponsible: ResolveResponsible = typedResponsible(data)) {
    const replayWhere = data.requestId ? { splitRequestId: data.requestId } : null;
    const hasReplay = async (db: Db) =>
      replayWhere !== null && await db.label.count({ where: { parentLabelId: id, ...replayWhere } }) > 0;

    // Reenvio: vale mesmo depois que a origem foi encerrada por este pedido (closeParent).
    if (await hasReplay(prisma)) return { ...await splitResult(prisma, id, replayWhere!), replayed: true };
    // Fora da transação: confere o token do operador sem segurar a trava da etiqueta.
    const responsible = await resolveResponsible();

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
            responsibleName: responsible.responsibleName.trim(), handlerId: responsible.handlerId,
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
            closedById: actor.id, closedByName: responsible.responsibleName.trim(),
          },
        });
      }
      return { ...await splitResult(tx, id, { id: { in: childIds } }), replayed: false };
    }, { timeout: 15_000 });
  },
};
