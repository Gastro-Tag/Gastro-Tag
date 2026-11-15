import { Request, Response } from 'express';
import { z } from 'zod';
import { LabelService } from '../services/labelService';
import { parseDateOnly } from '../domain/shelfLife';
import { LABEL_TEMPERATURE_MAX, LABEL_TEMPERATURE_MIN } from '../domain/temperature';

const dateSchema = z.string().refine((value) => {
  try { parseDateOnly(value); return true; } catch { return false; }
}, 'Informe uma data real no formato YYYY-MM-DD.');

const labelFields = z.object({
  productId:   z.string().uuid(),
  lotId:       z.string().uuid().optional(),
  originalExpiryDate: dateSchema.optional(),
  openedAt:    dateSchema.optional(),
  storageType: z.enum(['REFRIGERADO', 'CONGELADO']),
  // Medição em °C; o servidor arredonda a uma casa e gera o texto impresso ("4,0 °C").
  storageTemperature: z.number({
    required_error: 'Informe a temperatura medida em °C.',
    invalid_type_error: 'Informe a temperatura em número (°C).',
  }).finite('Informe a temperatura em número (°C).')
    .min(LABEL_TEMPERATURE_MIN, `Temperatura fora da faixa aceita (${LABEL_TEMPERATURE_MIN} a ${LABEL_TEMPERATURE_MAX} °C).`)
    .max(LABEL_TEMPERATURE_MAX, `Temperatura fora da faixa aceita (${LABEL_TEMPERATURE_MIN} a ${LABEL_TEMPERATURE_MAX} °C).`)
    .optional(),
});

// A validade vem de um lote cadastrado ou da embalagem em mãos, nunca dos dois.
const oneExpirySource = (data: { lotId?: string; originalExpiryDate?: string }) =>
  Boolean(data.lotId) !== Boolean(data.originalExpiryDate);
const expirySourceError = { message: 'Escolha um lote ou informe a validade da embalagem.' };

const previewSchema = labelFields.refine(oneExpirySource, expirySourceError);

const createSchema = labelFields.extend({
  storageTemperature: labelFields.shape.storageTemperature.unwrap(),
  lot: z.string().trim().min(1).max(60).refine((value) => !value.includes('\u0000'), 'Lote inválido.').optional(),
  responsibleName: z.string().trim().min(1, 'Informe o nome do responsável.').max(100),
  requestId: z.string().uuid().optional(),
}).refine(oneExpirySource, expirySourceError)
  .refine((data) => (data.lotId ? !data.lot : Boolean(data.lot)), {
    message: 'Informe o lote da embalagem.',
  });
const listSchema = z.object({
  productId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  q: z.string().max(120).optional(),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  storageType: z.enum(['REFRIGERADO', 'CONGELADO']).optional(),
  status: z.enum(['ATIVA', 'ENCERRADA']).optional(),
  // Pela data da cozinha. Faz sentido junto com status=ATIVA.
  due: z.enum(['expired', 'today', 'upcoming']).optional(),
  parentLabelId: z.string().uuid().optional(),
}).refine((query) => !query.from || !query.to || query.from <= query.to, {
  message: 'A data inicial deve ser menor ou igual à data final.',
});

const closeSchema = z.object({
  outcome: z.enum(['USADO', 'DESCARTADO', 'CANCELADO'], { errorMap: () => ({ message: 'Escolha o destino da etiqueta.' }) }),
  discardReason: z.enum(['PRAZO_VENCIDO', 'ALTERACAO_SENSORIAL', 'EMBALAGEM_DANIFICADA', 'OUTRO'], {
    errorMap: () => ({ message: 'Motivo do descarte inválido.' }),
  }).optional(),
  // Observação vazia conta como não informada.
  note: z.string().trim().max(300, 'A observação deve ter no máximo 300 caracteres.').optional()
    .transform((value) => value || undefined),
}).refine((data) => (data.outcome === 'DESCARTADO') === Boolean(data.discardReason), {
  message: 'Informe o motivo do descarte (só para etiqueta descartada).',
}).refine((data) => data.discardReason !== 'OUTRO' || (data.note?.length ?? 0) >= 3, {
  message: 'Descreva o motivo do descarte na observação (mínimo 3 caracteres).',
});

const splitPreviewSchema = z.object({
  storageType: labelFields.shape.storageType,
  storageTemperature: labelFields.shape.storageTemperature,
});

const splitSchema = splitPreviewSchema.extend({
  count: z.number({ required_error: 'Informe a quantidade de etiquetas.', invalid_type_error: 'Quantidade inválida.' })
    .int('A quantidade deve ser um número inteiro.')
    .min(1, 'A quantidade deve ser de 1 a 20 etiquetas.').max(20, 'A quantidade deve ser de 1 a 20 etiquetas.'),
  storageTemperature: labelFields.shape.storageTemperature.unwrap(),
  responsibleName: z.string().trim().min(1, 'Informe o nome do responsável.').max(100),
  closeParent: z.boolean().optional(),
  requestId: z.string().uuid().optional(),
});

const actor = (req: Request) => ({ id: req.user!.sub, name: req.user!.name, role: req.user!.role });

export const LabelController = {
  async list(req: Request, res: Response) {
    const query = listSchema.parse(req.query);
    const result = await LabelService.list(query);
    res.json({ success: true, ...result });
  },

  async getById(req: Request, res: Response) {
    const label = await LabelService.getById(req.params.id);
    res.json({ success: true, data: label });
  },

  async create(req: Request, res: Response) {
    const data  = createSchema.parse(req.body);
    const { label, replayed } = await LabelService.create({ ...data, userId: req.user!.sub });
    res.status(replayed ? 200 : 201).json({ success: true, data: label });
  },

  async preview(req: Request, res: Response) {
    const data = previewSchema.parse(req.body);
    const result = await LabelService.preview(data);
    res.json({ success: true, data: result });
  },

  async close(req: Request, res: Response) {
    const data = closeSchema.parse(req.body);
    const { label, activeChildren } = await LabelService.close(req.params.id, data, actor(req));
    res.json({ success: true, data: label, meta: { activeChildren } });
  },

  async splitPreview(req: Request, res: Response) {
    const data = splitPreviewSchema.parse(req.body);
    const result = await LabelService.splitPreview(req.params.id, data);
    res.json({ success: true, data: result });
  },

  async split(req: Request, res: Response) {
    const data = splitSchema.parse(req.body);
    const { replayed, ...result } = await LabelService.split(req.params.id, data, actor(req));
    res.status(replayed ? 200 : 201).json({ success: true, data: result });
  },

  async registerPrint(req: Request, res: Response) {
    const label = await LabelService.registerPrint(req.params.id);
    res.json({ success: true, data: label });
  },
};
