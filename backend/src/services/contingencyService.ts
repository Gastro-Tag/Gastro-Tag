import { ContingencyOutcome, DiscardReason, Prisma, StorageType } from '@prisma/client';
import { prisma } from '../prisma/client';
import { Errors } from '../utils/errors';
import { kitchenToday } from '../utils/dateUtils';
import { calculateDiscard, parseDateOnly } from '../domain/shelfLife';
import { capToOriginalExpiry, PRODUCT_DAYS_SOURCE, resolveShelfLifeUnblocked } from './labelService';

/**
 * Plano B. Sem rede, a cozinha usa etiqueta de papel; quando a rede volta, o ADMIN lança aqui o que foi
 * aberto. O registro NÃO é etiqueta: não imprime, não entra no CSV nem em /labels. O prazo vem da mesma
 * resolução da etiqueta, mas sem o bloqueio "exigir regra validada", sem faixa de temperatura e sem o
 * aviso de validade distante.
 */

export interface Actor { id: string; name: string }

/** Reenvio do aviso de queda: o mesmo usuário dentro deste intervalo recebe o aviso já gravado. */
export const OUTAGE_RESEND_WINDOW_MS = 60_000;
export const OUTAGE_MIN_MS = 60_000;
export const OUTAGE_MAX_MS = 7 * 24 * 60 * 60 * 1000;
const OUTAGE_LIST_LIMIT = 100;

/** A abertura lançada pode ser de até 30 dias antes de agora (passa de MAX_BACKDATE_DAYS de propósito). */
export const CONTINGENCY_MAX_BACKDATE_DAYS = 30;
const RECORD_LIST_LIMIT = 200;

export interface RecordInput {
  productId: string;
  storageType: StorageType;
  lot: string;
  originalExpiryDate: string;
  /** Instante real da abertura, da folha de papel. */
  openedAt: Date;
  responsibleName: string;
  paperRef?: string;
  note?: string;
  outcome: ContingencyOutcome;
  discardReason?: DiscardReason;
  outageId?: string;
}

/** A prévia só precisa do que entra no cálculo. */
export type RecordPreviewInput = Pick<RecordInput, 'productId' | 'storageType' | 'originalExpiryDate' | 'openedAt'>;

export interface RecordCloseInput {
  outcome: Exclude<ContingencyOutcome, 'EM_USO'>;
  discardReason?: DiscardReason;
  note?: string;
}

const dateOnly = (value: Date) => value.toISOString().slice(0, 10);

type RecordRow = Prisma.ContingencyRecordGetPayload<object>;

/** Datas sem horário saem como YYYY-MM-DD; `expired` é pelo dia da cozinha de agora. */
function serializeRecord(record: RecordRow, today = kitchenToday()) {
  return {
    ...record,
    originalExpiryDate: dateOnly(record.originalExpiryDate),
    openedDate: dateOnly(record.openedDate),
    discardAt: dateOnly(record.discardAt),
    ruleValidated: record.ruleId !== null,
    expired: record.discardAt.getTime() < today.getTime(),
  };
}

/** Cálculo comum à prévia e ao lançamento. Produto inativo é aceito: a embalagem pode ter sido aberta antes. */
async function compute(data: RecordPreviewInput) {
  const product = await prisma.product.findUnique({ where: { id: data.productId } });
  if (!product) throw Errors.notFound('Produto');

  const now = new Date();
  if (data.openedAt.getTime() > now.getTime()) throw Errors.validation('A abertura não pode ser no futuro.');
  if (now.getTime() - data.openedAt.getTime() > CONTINGENCY_MAX_BACKDATE_DAYS * 86_400_000) {
    throw Errors.validation(`A abertura não pode ser de mais de ${CONTINGENCY_MAX_BACKDATE_DAYS} dias atrás.`);
  }

  const openedDate = kitchenToday(data.openedAt);
  const originalExpiryDate = parseDateOnly(data.originalExpiryDate, 'Validade original');
  const { rule, shelfLifeDays } = await resolveShelfLifeUnblocked(prisma, product, data.storageType);
  // Sem `today`: o registro pode já estar vencido (é o que aconteceu no papel). O dia 1 é o dia da abertura.
  const calculation = calculateDiscard({ openedAt: openedDate, shelfLifeDays, originalExpiryDate, capToOriginalExpiry });
  const today = kitchenToday(now);
  return {
    product,
    openedAt: data.openedAt,
    openedDate,
    originalExpiryDate,
    storageType: data.storageType,
    shelfLifeDays,
    discardAt: calculation.discardAt,
    cappedByOriginalExpiry: calculation.cappedByOriginalExpiry,
    rule: rule
      ? { id: rule.id, version: rule.version, source: rule.source, validated: true }
      : { id: null, version: null, source: PRODUCT_DAYS_SOURCE, validated: false },
    expired: calculation.discardAt.getTime() < today.getTime(),
  };
}

const alreadyClosed = () => Errors.conflict('Este registro já foi encerrado com outro destino.');

export const ContingencyService = {
  /**
   * Aviso de queda vindo do aparelho quando a rede volta. Reenvio do mesmo usuário em até 60 s devolve
   * o aviso já gravado (`replayed`); a trava por usuário evita dois avisos em envios simultâneos.
   */
  async reportOutage(durationMs: number, actor: Actor) {
    return prisma.$transaction(async (tx) => {
      const key = `outage:${actor.id}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
      const now = new Date();
      const recent = await tx.connectivityOutage.findFirst({
        where: { reportedById: actor.id, reportedAt: { gte: new Date(now.getTime() - OUTAGE_RESEND_WINDOW_MS) } },
        orderBy: { reportedAt: 'desc' },
      });
      if (recent) return { outage: recent, replayed: true };
      const outage = await tx.connectivityOutage.create({
        data: {
          durationMs, reportedAt: now, startedAt: new Date(now.getTime() - durationMs),
          reportedById: actor.id, reportedByName: actor.name,
        },
      });
      return { outage, replayed: false };
    });
  },

  async listOutages(pending: boolean | undefined) {
    const [items, pendingCount] = await Promise.all([
      prisma.connectivityOutage.findMany({
        where: pending === undefined ? {} : { reviewedAt: pending ? null : { not: null } },
        orderBy: { reportedAt: 'desc' },
        take: OUTAGE_LIST_LIMIT,
      }),
      prisma.connectivityOutage.count({ where: { reviewedAt: null } }),
    ]);
    return { data: items, meta: { pendingCount } };
  },

  /** Idempotente: já revisada volta como está (quem revisou primeiro fica). */
  async reviewOutage(id: string, actor: Actor) {
    await prisma.connectivityOutage.updateMany({
      where: { id, reviewedAt: null }, data: { reviewedAt: new Date(), reviewedByName: actor.name },
    });
    const outage = await prisma.connectivityOutage.findUnique({ where: { id } });
    if (!outage) throw Errors.notFound('Aviso de queda');
    return outage;
  },

  async previewRecord(data: RecordPreviewInput) {
    const result = await compute(data);
    return {
      product: { id: result.product.id, name: result.product.name, brand: result.product.brand, active: result.product.active },
      storageType: result.storageType,
      openedAt: result.openedAt,
      openedDate: dateOnly(result.openedDate),
      originalExpiryDate: dateOnly(result.originalExpiryDate),
      shelfLifeDays: result.shelfLifeDays,
      discardAt: dateOnly(result.discardAt),
      cappedByOriginalExpiry: result.cappedByOriginalExpiry,
      rule: result.rule,
      expired: result.expired,
    };
  },

  async createRecord(data: RecordInput, actor: Actor) {
    const result = await compute(data);
    if (data.outcome === 'EM_USO' && result.expired) {
      throw Errors.validation('O prazo já venceu: registre como descartado ou usado.');
    }
    if (data.outageId && !await prisma.connectivityOutage.findUnique({ where: { id: data.outageId }, select: { id: true } })) {
      throw Errors.notFound('Aviso de queda');
    }
    const closed = data.outcome !== 'EM_USO';
    const record = await prisma.contingencyRecord.create({
      data: {
        productId: result.product.id, productName: result.product.name, productBrand: result.product.brand,
        lot: data.lot, originalExpiryDate: result.originalExpiryDate,
        openedAt: result.openedAt, openedDate: result.openedDate,
        storageType: data.storageType, shelfLifeDays: result.shelfLifeDays,
        ruleId: result.rule.id, ruleVersion: result.rule.version, ruleSource: result.rule.source,
        discardAt: result.discardAt, cappedByOriginalExpiry: result.cappedByOriginalExpiry,
        responsibleName: data.responsibleName, paperRef: data.paperRef ?? null, note: data.note ?? null,
        outcome: data.outcome, discardReason: data.discardReason ?? null,
        closedAt: closed ? new Date() : null, closedByName: closed ? actor.name : null,
        createdById: actor.id, createdByName: actor.name, outageId: data.outageId ?? null,
      },
    });
    return serializeRecord(record);
  },

  /** EM_USO primeiro (descarte mais próximo antes); depois os encerrados, mais recentes primeiro. Até 200. */
  async listRecords(status: 'open' | 'all') {
    const open = await prisma.contingencyRecord.findMany({
      where: { outcome: 'EM_USO' },
      orderBy: [{ discardAt: 'asc' }, { createdAt: 'desc' }],
      take: RECORD_LIST_LIMIT,
    });
    const closed = status === 'all' && open.length < RECORD_LIST_LIMIT
      ? await prisma.contingencyRecord.findMany({
        where: { outcome: { not: 'EM_USO' } },
        orderBy: { createdAt: 'desc' },
        take: RECORD_LIST_LIMIT - open.length,
      })
      : [];
    const today = kitchenToday();
    return [...open, ...closed].map((record) => serializeRecord(record, today));
  },

  /**
   * Só de EM_USO. Repetir o mesmo destino (e motivo) devolve o registro como está; outro destino é 409.
   * A observação do encerramento é acrescentada à do lançamento, sem apagar a original.
   */
  async closeRecord(id: string, data: RecordCloseInput, actor: Actor) {
    return prisma.$transaction(async (tx) => {
      const current = await tx.contingencyRecord.findUnique({ where: { id } });
      if (!current) throw Errors.notFound('Registro de contingência');
      const note = data.note
        ? (current.note ? `${current.note}\nEncerramento: ${data.note}` : data.note)
        : current.note;
      // Atualização condicional: dois encerramentos ao mesmo tempo não passam os dois.
      const updated = await tx.contingencyRecord.updateMany({
        where: { id, outcome: 'EM_USO' },
        data: {
          outcome: data.outcome, discardReason: data.discardReason ?? null, note,
          closedAt: new Date(), closedByName: actor.name,
        },
      });
      const record = await tx.contingencyRecord.findUniqueOrThrow({ where: { id } });
      if (updated.count === 0) {
        const same = record.outcome === data.outcome && (record.discardReason ?? null) === (data.discardReason ?? null);
        if (!same) throw alreadyClosed();
        return { record: serializeRecord(record), replayed: true };
      }
      return { record: serializeRecord(record), replayed: false };
    });
  },
};
