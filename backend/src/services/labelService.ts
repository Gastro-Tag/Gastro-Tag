import {
  DiscardReason, LabelOutcome, LabelStatus, Prisma, ShelfLifeRule, StorageType, TemperatureSource,
} from '@prisma/client';
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
  /** Medição do cliente (ms do toque no produto até criar a etiqueta); não é confiável para auditoria. */
  flowMs?: number;
  /** A temperatura foi a sugerida confirmada ou digitada pelo operador. */
  temperatureSource?: TemperatureSource;
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
  /** Medição do cliente para o Dividir inteiro; gravada igual em cada filha. */
  flowMs?: number;
  temperatureSource?: TemperatureSource;
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

/**
 * Tentativas quando o código curto sorteado já existe. O código é gravado direto (sem consultar antes):
 * consultar e depois inserir deixa uma janela em que outro pedido pega o mesmo código.
 */
const SHORT_CODE_ATTEMPTS = 5;

/** P2002 no código curto (código sorteado já existe), não na chave do reenvio (`requestId`). */
function isShortCodeCollision(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return false;
  const target = error.meta?.target;
  const fields = Array.isArray(target) ? target : typeof target === 'string' ? [target] : [];
  return fields.some((field) => /short_?code/i.test(String(field)));
}

/** `count` códigos distintos entre si; a unicidade no banco é garantida pela chave única. */
function distinctShortCodes(count: number) {
  const codes = new Set<string>();
  for (let drawn = 0; codes.size < count; drawn++) {
    if (drawn >= count * SHORT_CODE_ATTEMPTS) throw Errors.shortCodeUnavailable();
    codes.add(generateShortCode());
  }
  return [...codes];
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
  /**
   * cadastrado: `lotId` preenchido; informado: `lotId` nulo (validade digitada na hora);
   * anterior: `lotId` nulo de antes da migração dos lotes (e as filhas dessas).
   */
  lotSource?: LotSource;
}

export type LotSource = 'cadastrado' | 'informado' | 'anterior';

/** Migração que criou `labels.lot_id`: as etiquetas de antes dela têm `lot_id` nulo sem validade digitada. */
const PRODUCT_LOTS_MIGRATION = '20261103000000_product_lots';
let lotsCutoff: Promise<Date | null> | undefined;

/** Fim da migração dos lotes (lido uma vez por processo). Sem o registro, não há corte e nada é anterior. */
function lotsCutoffDate(): Promise<Date | null> {
  lotsCutoff ??= prisma.$queryRaw<{ finished_at: Date | null }[]>`
    SELECT finished_at FROM _prisma_migrations
    WHERE migration_name = ${PRODUCT_LOTS_MIGRATION} AND finished_at IS NOT NULL AND rolled_back_at IS NULL
    ORDER BY finished_at DESC LIMIT 1`
    .then((rows) => rows[0]?.finished_at ?? null)
    // Falha de leitura não fica no cache: a próxima consulta tenta de novo.
    .catch((error) => { lotsCutoff = undefined; throw error; });
  return lotsCutoff;
}

/**
 * Etiquetas anteriores aos lotes: `lot_id` nulo e criadas antes do corte, mais as filhas do Dividir
 * delas em qualquer nível (a filha nasce depois do corte, mas herda a embalagem da origem).
 */
async function legacyLabelIds(): Promise<Set<string>> {
  const cutoff = await lotsCutoffDate();
  if (!cutoff) return new Set();
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE legacy AS (
      SELECT id FROM labels WHERE lot_id IS NULL AND created_at < ${cutoff}
      UNION
      SELECT child.id FROM labels child JOIN legacy ON child.parent_label_id = legacy.id
      WHERE child.lot_id IS NULL
    )
    SELECT id FROM legacy`;
  return new Set(rows.map((row) => row.id));
}

/** Consulta as anteriores só quando o filtro ou algum item com `lotId` nulo precisa delas. */
function lazyLegacyIds() {
  let ids: Promise<Set<string>> | undefined;
  return () => (ids ??= legacyLabelIds());
}

const lotSourceOf = (label: { id: string; lotId: string | null }, legacy: Set<string>): LotSource =>
  label.lotId ? 'cadastrado' : legacy.has(label.id) ? 'anterior' : 'informado';

const LOT_SOURCE_CSV: Record<LotSource, string> = { cadastrado: 'Sim', informado: 'Não', anterior: 'Anterior aos lotes' };

async function lotSourceWhere(lotSource: LotSource | undefined, legacy: () => Promise<Set<string>>)
  : Promise<Prisma.LabelWhereInput> {
  if (!lotSource) return {};
  if (lotSource === 'cadastrado') return { lotId: { not: null } };
  const ids = [...await legacy()];
  return lotSource === 'informado'
    ? { lotId: null, ...(ids.length > 0 && { id: { notIn: ids } }) }
    : { lotId: null, id: { in: ids } };
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
  'Código', 'Produto', 'Marca', 'Lote', 'Lote cadastrado', 'Validade do fabricante', 'Abertura', 'Fracionado em', 'Origem (código)',
  'Armazenamento', 'Temperatura', 'Descarte', 'Prazo (dias)', 'Regra', 'Responsável', 'Operador com PIN',
  'Situação', 'Destino', 'Motivo', 'Observação', 'Encerrado em', 'Encerrado por', 'Criada em',
  // No fim, para não deslocar as colunas anteriores.
  'Tempo (s)', 'Origem da temperatura',
];
const STORAGE_LABELS: Record<StorageType, string> = { REFRIGERADO: 'Refrigerado', CONGELADO: 'Congelado' };
const STATUS_LABELS: Record<LabelStatus, string> = { ATIVA: 'Ativa', ENCERRADA: 'Encerrada' };
const OUTCOME_LABELS: Record<LabelOutcome, string> = { USADO: 'Usado', DESCARTADO: 'Descartado', CANCELADO: 'Cancelado' };
const TEMPERATURE_SOURCE_LABELS: Record<TemperatureSource, string> = { SUGERIDO: 'Sugerida', DIGITADO: 'Digitada' };
/** Segundos com uma casa e vírgula ("12,3"); vazio sem medição. */
const csvSeconds = (flowMs: number | null) => (flowMs === null ? '' : (flowMs / 1000).toFixed(1).replace('.', ','));
const REASON_LABELS: Record<DiscardReason, string> = {
  PRAZO_VENCIDO: 'Prazo vencido', ALTERACAO_SENSORIAL: 'Alteração sensorial',
  EMBALAGEM_DANIFICADA: 'Embalagem danificada', OUTRO: 'Outro',
};

/** Período padrão do relatório de tempo e temperatura (dias da cozinha, contando hoje) e o máximo aceito. */
const METRICS_DEFAULT_DAYS = 7;
export const METRICS_MAX_DAYS = 92;

export interface MetricsFilters { from?: string; to?: string; productId?: string }

/** Instante UTC sem fuso, no formato de `labels.created_at` (TIMESTAMP(3) gravado em UTC). */
const utcTimestamp = (date: Date) => date.toISOString().slice(0, 23);

/**
 * Teto do tempo plausível no relatório (10 min). Acima dele a medição fica gravada (e no CSV), mas não
 * entra na mediana nem no p90: aparelho esquecido aberto não distorce a conta. Conta em `discardedFlows`.
 */
export const FLOW_PLAUSIBLE_MAX_MS = 600_000;

const roundMs = (value: number | null) => (value === null ? null : Math.round(value));

/**
 * Etiquetas do período para o relatório, já sem as canceladas (erro de cadastro, não trabalho da
 * bancada). `action_key` junta as filhas de um mesmo Dividir (mesma origem e mesmo pedido): o tempo
 * foi medido uma vez para o Dividir inteiro e gravado igual em cada filha. Dividir sem `requestId`
 * não tem como ser agrupado e conta cada filha.
 */
function metricsBase(start: Date, end: Date, productId: string | undefined, timeZone: string) {
  return Prisma.sql`
    base AS (
      SELECT l.id, l.flow_ms, l.temperature_source,
        (l.created_at AT TIME ZONE 'UTC' AT TIME ZONE ${timeZone})::date AS day,
        CASE WHEN l.parent_label_id IS NOT NULL AND l.split_request_id IS NOT NULL
          THEN l.parent_label_id || ':' || l.split_request_id ELSE l.id END AS action_key
      FROM labels l
      WHERE l.created_at >= ${utcTimestamp(start)}::timestamp AND l.created_at < ${utcTimestamp(end)}::timestamp
        AND l.outcome IS DISTINCT FROM 'CANCELADO'
        ${productId ? Prisma.sql`AND l.product_id = ${productId}` : Prisma.empty}
    ),
    measured AS (
      SELECT day, action_key, MIN(flow_ms) AS flow_ms
      FROM base WHERE flow_ms IS NOT NULL GROUP BY day, action_key
    ),
    flows AS (SELECT * FROM measured WHERE flow_ms <= ${FLOW_PLAUSIBLE_MAX_MS})`;
}

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
    for (let attempt = 1; ; attempt++) {
      try {
        const label = await prisma.label.create({
          data: {
            shortCode: generateShortCode(), productId: data.productId, userId: data.userId, lot, lotId: preview.lot?.id,
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
            flowMs: data.flowMs ?? null, temperatureSource: data.temperatureSource ?? null,
          },
          include: labelInclude,
        });
        return { label: serializeLabel(label), replayed: false };
      } catch (error) {
        // Código curto repetido: sorteia outro. Fora de transação, o insert que falhou não deixa nada para trás.
        if (isShortCodeCollision(error)) {
          if (attempt < SHORT_CODE_ATTEMPTS) continue;
          throw Errors.shortCodeUnavailable();
        }
        // Dois envios simultâneos do mesmo pedido: o segundo perde na chave única e devolve o primeiro.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          const raced = await findReplay(data);
          if (raced) return { label: serializeLabel(raced), replayed: true };
        }
        throw error;
      }
    }
  },

  async list(filters: LabelFilters & { page?: number; limit?: number }) {
    const { page = 1, limit = 20 } = filters;
    const legacy = lazyLegacyIds();
    const where = { ...labelWhere(filters, 'openedAt'), ...await lotSourceWhere(filters.lotSource, legacy) };
    const [total, items] = await Promise.all([
      prisma.label.count({ where }),
      prisma.label.findMany({
        where, skip: (page - 1) * limit, take: Math.min(limit, 100),
        orderBy: { createdAt: 'desc' },
        include: listInclude,
      }),
    ]);
    const legacyIds = items.some((item) => item.lotId === null) ? await legacy() : new Set<string>();
    const data = items.map((item) => ({ ...withChildrenCount(item), lotSource: lotSourceOf(item, legacyIds) }));
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
    const legacy = lazyLegacyIds();
    const where = { ...labelWhere(filters, 'createdAt'), ...await lotSourceWhere(filters.lotSource, legacy) };
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
    const legacyIds = labels.some((label) => label.lotId === null) ? await legacy() : new Set<string>();
    const rows = labels.map((label) => [
      label.shortCode, label.productName, label.productBrand, label.lot, LOT_SOURCE_CSV[lotSourceOf(label, legacyIds)],
      date(label.originalExpiryDate), date(label.openedAt), date(label.fractionedAt), label.parent?.shortCode ?? '',
      STORAGE_LABELS[label.storageType], csvTemperature(label.storageTemp), date(label.discardAt), String(label.shelfLifeDays),
      label.ruleId
        ? [label.ruleVersion ? `v${label.ruleVersion}` : null, label.ruleSource].filter(Boolean).join(' - ')
        : 'sem regra validada',
      label.responsibleName ?? '', label.handlerId ? 'sim' : 'não',
      STATUS_LABELS[label.status], label.outcome ? OUTCOME_LABELS[label.outcome] : '',
      label.discardReason ? REASON_LABELS[label.discardReason] : '', label.closeNote ?? '',
      dateTime(label.closedAt), label.closedByName ?? '', dateTime(label.createdAt),
      csvSeconds(label.flowMs), label.temperatureSource ? TEMPERATURE_SOURCE_LABELS[label.temperatureSource] : '',
    ]);
    return {
      csv: toCsv(CSV_HEADER, rows),
      filename: `etiquetas-${dateOnly(kitchenToday())}.csv`,
    };
  },

  /**
   * Relatório de tempo por etiqueta e de temperaturas digitadas x sugeridas, agregado no banco.
   * Período pela data de criação no fuso da cozinha, `from` e `to` inclusive (padrão: os últimos 7 dias
   * da cozinha; no máximo 92). Contagens (`total`, `withTemperatureSource`, `suggestedCount`,
   * `typedCount`) são por etiqueta, origens e filhas, sem as canceladas: cada uma é impressa com a sua
   * temperatura. O tempo (`withFlow`, mediana, p90) é por ação medida: uma por etiqueta criada e uma
   * por Dividir, senão um Dividir de 20 filhas pesaria 20 vezes. Ações acima de `FLOW_PLAUSIBLE_MAX_MS`
   * ficam fora do tempo e contam em `discardedFlows`. `flowMs` é medido no aparelho e não serve para auditoria.
   */
  async metrics(filters: MetricsFilters) {
    const today = kitchenToday();
    const toDate = filters.to ? parseDateOnly(filters.to, 'Data final') : today;
    const fromDate = filters.from ? parseDateOnly(filters.from, 'Data inicial')
      : addDays(toDate, -(METRICS_DEFAULT_DAYS - 1));
    if (fromDate > toDate) throw Errors.validation('A data inicial deve ser menor ou igual à data final.');
    if (daysBetween(fromDate, toDate) + 1 > METRICS_MAX_DAYS) {
      throw Errors.validation(`O período do relatório é de no máximo ${METRICS_MAX_DAYS} dias.`);
    }
    const timeZone = process.env.KITCHEN_TIME_ZONE || 'America/Manaus';
    const base = metricsBase(
      kitchenDayStartInstant(fromDate), kitchenDayStartInstant(addDays(toDate, 1)), filters.productId, timeZone,
    );

    const [[summary], days] = await Promise.all([
      prisma.$queryRaw<{
        total: number; with_flow: number; discarded_flows: number; flow_median: number | null; flow_p90: number | null;
        with_source: number; suggested: number; typed: number;
      }[]>`
        WITH ${base}
        SELECT
          (SELECT COUNT(*) FROM base)::int AS total,
          (SELECT COUNT(*) FROM flows)::int AS with_flow,
          (SELECT COUNT(*) FROM measured WHERE flow_ms > ${FLOW_PLAUSIBLE_MAX_MS})::int AS discarded_flows,
          (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY flow_ms) FROM flows)::float8 AS flow_median,
          (SELECT percentile_cont(0.9) WITHIN GROUP (ORDER BY flow_ms) FROM flows)::float8 AS flow_p90,
          (SELECT COUNT(*) FROM base WHERE temperature_source IS NOT NULL)::int AS with_source,
          (SELECT COUNT(*) FROM base WHERE temperature_source = 'SUGERIDO')::int AS suggested,
          (SELECT COUNT(*) FROM base WHERE temperature_source = 'DIGITADO')::int AS typed`,
      // Todos os dias do período, inclusive os sem etiqueta (zeros), em ordem.
      prisma.$queryRaw<{ date: string; total: number; flow_median: number | null; suggested: number; typed: number }[]>`
        WITH ${base},
        per_day AS (
          SELECT day, COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE temperature_source = 'SUGERIDO')::int AS suggested,
            COUNT(*) FILTER (WHERE temperature_source = 'DIGITADO')::int AS typed
          FROM base GROUP BY day
        ),
        flow_day AS (
          SELECT day, percentile_cont(0.5) WITHIN GROUP (ORDER BY flow_ms)::float8 AS flow_median
          FROM flows GROUP BY day
        )
        SELECT to_char(d.day, 'YYYY-MM-DD') AS date, COALESCE(p.total, 0) AS total, f.flow_median,
          COALESCE(p.suggested, 0) AS suggested, COALESCE(p.typed, 0) AS typed
        FROM generate_series(${dateOnly(fromDate)}::date, ${dateOnly(toDate)}::date, interval '1 day') AS d(day)
        LEFT JOIN per_day p ON p.day = d.day::date
        LEFT JOIN flow_day f ON f.day = d.day::date
        ORDER BY d.day`,
    ]);

    return {
      from: dateOnly(fromDate)!, to: dateOnly(toDate)!,
      total: summary.total, withFlow: summary.with_flow, discardedFlows: summary.discarded_flows,
      flowMedianMs: roundMs(summary.flow_median), flowP90Ms: roundMs(summary.flow_p90),
      withTemperatureSource: summary.with_source, suggestedCount: summary.suggested, typedCount: summary.typed,
      byDay: days.map((day) => ({
        date: day.date, total: day.total, flowMedianMs: roundMs(day.flow_median),
        suggestedCount: day.suggested, typedCount: day.typed,
      })),
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

    // Código curto repetido aborta a transação inteira no Postgres: refaz a transação do começo
    // (trava, reenvio e cálculo de novo) com outros códigos.
    for (let attempt = 1; ; attempt++) {
      try {
        return await prisma.$transaction(async (tx) => {
          await lockLabel(tx, id);
          // Dois envios simultâneos do mesmo pedido: o segundo espera a trava e encontra as filhas do primeiro.
          if (await hasReplay(tx)) return { ...await splitResult(tx, id, replayWhere!), replayed: true };

          const parent = await tx.label.findUnique({ where: { id } });
          if (!parent) throw Errors.notFound('Etiqueta');
          const calculation = await computeSplit(tx, parent, data);
          const codes = distinctShortCodes(data.count);
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
                flowMs: data.flowMs ?? null, temperatureSource: data.temperatureSource ?? null,
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
      } catch (error) {
        if (!isShortCodeCollision(error)) throw error;
        if (attempt >= SHORT_CODE_ATTEMPTS) throw Errors.shortCodeUnavailable();
      }
    }
  },
};
