import { Request, Response } from 'express';
import { z } from 'zod';
import { LabelService } from '../services/labelService';
import { parseDateOnly } from '../domain/shelfLife';

const dateSchema = z.string().refine((value) => {
  try { parseDateOnly(value); return true; } catch { return false; }
}, 'Informe uma data real no formato YYYY-MM-DD.');

const createSchema = z.object({
  productId:   z.string().uuid(),
  lot:         z.string().min(1).max(60),
  responsibleName: z.string().trim().min(1, 'Informe o nome do responsável.').max(100),
  openedAt:    dateSchema,
  storageType: z.enum(['REFRIGERADO', 'CONGELADO']),
  storageTemp: z.string().min(1).max(40),
});

const previewSchema = createSchema.omit({ lot: true, responsibleName: true });
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
    const label = await LabelService.create({ ...data, userId: req.user!.sub });
    res.status(201).json({ success: true, data: label });
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
