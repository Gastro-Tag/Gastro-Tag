import { Request, Response } from 'express';
import { z } from 'zod';
import { LotService } from '../services/lotService';
import { parseDateOnly } from '../domain/shelfLife';

const noNullByte = (value: string) => !value.includes('\u0000');

const lotFields = z.object({
  code: z.string().trim().min(1, 'Informe o código do lote.').max(60).toUpperCase()
    .refine(noNullByte, 'Código de lote inválido.'),
  expiryDate: z.string().refine((value) => {
    try { parseDateOnly(value); return true; } catch { return false; }
  }, 'Informe uma data real no formato YYYY-MM-DD.'),
});

const updateSchema = lotFields.partial();
const paramsSchema = z.object({ id: z.string().uuid(), lotId: z.string().uuid().optional() });

export const LotController = {
  async create(req: Request, res: Response) {
    const { id } = paramsSchema.parse(req.params);
    const data = lotFields.parse(req.body);
    const lot = await LotService.create(id, data);
    res.status(201).json({ success: true, data: lot });
  },

  async update(req: Request, res: Response) {
    const { id, lotId } = paramsSchema.required().parse(req.params);
    const data = updateSchema.parse(req.body);
    const lot = await LotService.update(id, lotId, data);
    res.json({ success: true, data: lot });
  },

  async remove(req: Request, res: Response) {
    const { id, lotId } = paramsSchema.required().parse(req.params);
    const lot = await LotService.remove(id, lotId);
    res.json({ success: true, data: lot });
  },
};
