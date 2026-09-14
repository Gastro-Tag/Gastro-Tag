import { Request, Response } from 'express';
import { z } from 'zod';
import { LabelService } from '../services/labelService';

const createSchema = z.object({
  productId:   z.string().uuid(),
  lot:         z.string().min(1).max(60),
  openedAt:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  storageType: z.enum(['REFRIGERADO', 'CONGELADO']),
  storageTemp: z.string().min(1).max(40),
});

export const LabelController = {
  async list(req: Request, res: Response) {
    const page  = Number(req.query.page)  || 1;
    const limit = Number(req.query.limit) || 20;
    const productId = req.query.productId as string | undefined;
    const result = await LabelService.list({ productId, page, limit });
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

  async registerPrint(req: Request, res: Response) {
    const label = await LabelService.registerPrint(req.params.id);
    res.json({ success: true, data: label });
  },
};
