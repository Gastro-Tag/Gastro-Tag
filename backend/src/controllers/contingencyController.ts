import { Request, Response } from 'express';
import { z } from 'zod';
import { ContingencyService, OUTAGE_MAX_MS, OUTAGE_MIN_MS } from '../services/contingencyService';
import { parseDateOnly } from '../domain/shelfLife';

const OUTAGE_DURATION_ERROR = 'Informe a duração da queda em milissegundos inteiros, de 1 minuto a 7 dias.';

const outageSchema = z.strictObject({
  durationMs: z.number({ error: OUTAGE_DURATION_ERROR })
    .int(OUTAGE_DURATION_ERROR).min(OUTAGE_MIN_MS, OUTAGE_DURATION_ERROR).max(OUTAGE_MAX_MS, OUTAGE_DURATION_ERROR),
  // Há quanto tempo a rede voltou (reenvio atrasado), até 24 h: o início fica certo mesmo assim.
  endedAgoMs: z.number({ error: 'Informe endedAgoMs em milissegundos inteiros, de 0 a 24 h.' })
    .int().min(0).max(24 * 60 * 60_000, 'endedAgoMs deve ser de no máximo 24 h.').optional(),
});

const outageListSchema = z.object({
  pending: z.enum(['true', 'false'], { error: 'Use pending=true ou pending=false.' }).optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
});

const idSchema = z.string().uuid();

const dateSchema = z.string({ error: 'Informe a validade da embalagem (YYYY-MM-DD).' }).refine((value) => {
  try { parseDateOnly(value); return true; } catch { return false; }
}, 'Informe uma data real no formato YYYY-MM-DD.');

const noNul = (value: string) => !value.includes('\u0000');
/** Texto opcional: vazio depois do trim conta como não informado. */
const optionalText = (max: number, message: string) => z.string().trim().max(max, message)
  .refine(noNul, 'Texto inválido.').optional().transform((value) => value || undefined);

const discardReasonSchema = z.enum(['PRAZO_VENCIDO', 'ALTERACAO_SENSORIAL', 'EMBALAGEM_DANIFICADA', 'OUTRO'], {
  error: 'Motivo do descarte inválido.',
}).optional();
const noteSchema = optionalText(300, 'A observação deve ter no máximo 300 caracteres.');

// Mesmas regras do encerramento da etiqueta: motivo só (e sempre) para DESCARTADO; OUTRO exige observação.
const reasonMatchesOutcome = [
  (data: { outcome?: string; discardReason?: string }) =>
    data.outcome === undefined || (data.outcome === 'DESCARTADO') === Boolean(data.discardReason),
  { message: 'Informe o motivo do descarte (só para registro descartado).' },
] as const;
const otherNeedsNote = [
  (data: { discardReason?: string; note?: string }) => data.discardReason !== 'OUTRO' || (data.note?.length ?? 0) >= 3,
  { message: 'Descreva o motivo do descarte na observação (mínimo 3 caracteres).' },
] as const;

const recordFields = {
  productId: z.string({ error: 'Escolha o produto.' }).uuid('Produto inválido.'),
  storageType: z.enum(['REFRIGERADO', 'CONGELADO'], { error: 'Escolha o armazenamento.' }),
  lot: z.string({ error: 'Informe o lote da embalagem.' }).trim()
    .min(1, 'Informe o lote da embalagem.').max(60, 'O lote deve ter no máximo 60 caracteres.')
    .refine(noNul, 'Lote inválido.'),
  originalExpiryDate: dateSchema,
  // Data e hora reais (com fuso ou Z); o dia da cozinha desse instante é o dia 1 do prazo.
  openedAt: z.iso.datetime({ offset: true, error: 'Informe a data e a hora da abertura (ISO, com fuso).' })
    .transform((value) => new Date(value)),
  responsibleName: z.string({ error: 'Informe quem abriu a embalagem.' }).trim()
    .min(2, 'Informe quem abriu a embalagem (mínimo 2 caracteres).')
    .max(80, 'O nome deve ter no máximo 80 caracteres.').refine(noNul, 'Nome inválido.'),
  paperRef: optionalText(80, 'A referência do papel deve ter no máximo 80 caracteres.'),
  note: noteSchema,
  outcome: z.enum(['EM_USO', 'USADO', 'DESCARTADO'], { error: 'Escolha a situação da embalagem.' }),
  discardReason: discardReasonSchema,
  outageId: z.string().uuid('Aviso de queda inválido.').optional(),
};

const recordSchema = z.strictObject(recordFields)
  .refine(...reasonMatchesOutcome).refine(...otherNeedsNote);

// Prévia: aceita o mesmo corpo do lançamento, mas só exige o que entra no cálculo.
const previewSchema = z.strictObject({
  ...recordFields,
  lot: recordFields.lot.optional(),
  responsibleName: recordFields.responsibleName.optional(),
  outcome: recordFields.outcome.optional(),
}).refine(...reasonMatchesOutcome).refine(...otherNeedsNote);

const recordListSchema = z.object({
  status: z.enum(['open', 'all'], { error: 'Use status=open ou status=all.' }).optional().default('all'),
});

const closeSchema = z.strictObject({
  outcome: z.enum(['USADO', 'DESCARTADO'], { error: 'Escolha o destino: usado ou descartado.' }),
  discardReason: discardReasonSchema,
  note: noteSchema,
}).refine(...reasonMatchesOutcome).refine(...otherNeedsNote);

const actor = (req: Request) => ({ id: req.user!.sub, name: req.user!.name });

export const ContingencyController = {
  async reportOutage(req: Request, res: Response) {
    const { durationMs, endedAgoMs } = outageSchema.parse(req.body);
    const { outage, replayed } = await ContingencyService.reportOutage(durationMs, actor(req), endedAgoMs ?? 0);
    res.status(replayed ? 200 : 201).json({ success: true, data: outage });
  },

  async listOutages(req: Request, res: Response) {
    const { pending } = outageListSchema.parse(req.query);
    const result = await ContingencyService.listOutages(pending);
    res.json({ success: true, ...result });
  },

  async reviewOutage(req: Request, res: Response) {
    const id = idSchema.parse(req.params.id);
    res.json({ success: true, data: await ContingencyService.reviewOutage(id, actor(req)) });
  },

  async previewRecord(req: Request, res: Response) {
    const data = previewSchema.parse(req.body);
    res.json({ success: true, data: await ContingencyService.previewRecord(data) });
  },

  async createRecord(req: Request, res: Response) {
    const data = recordSchema.parse(req.body);
    res.status(201).json({ success: true, data: await ContingencyService.createRecord(data, actor(req)) });
  },

  async listRecords(req: Request, res: Response) {
    const { status } = recordListSchema.parse(req.query);
    res.json({ success: true, data: await ContingencyService.listRecords(status) });
  },

  async closeRecord(req: Request, res: Response) {
    const id = idSchema.parse(req.params.id);
    const data = closeSchema.parse(req.body);
    const { record } = await ContingencyService.closeRecord(id, data, actor(req));
    res.json({ success: true, data: record });
  },
};
