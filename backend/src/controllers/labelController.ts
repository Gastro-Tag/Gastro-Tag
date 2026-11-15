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
}).refine((query) => !query.from || !query.to || query.from <= query.to, {
  message: 'A data inicial deve ser menor ou igual à data final.',
});

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

  async registerPrint(req: Request, res: Response) {
    const label = await LabelService.registerPrint(req.params.id);
    res.json({ success: true, data: label });
  },
};
