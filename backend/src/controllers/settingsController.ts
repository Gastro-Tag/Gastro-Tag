import { Request, Response } from 'express';
import { z } from 'zod';
import { SettingsService } from '../services/settingsService';
import { ProductService } from '../services/productService';

const updateSchema = z.strictObject({
  requireValidatedRule: z.boolean({ error: 'Informe se a etiqueta exige regra validada (true ou false).' }),
});

export const SettingsController = {
  async get(_req: Request, res: Response) {
    res.json({ success: true, data: await SettingsService.get() });
  },

  async update(req: Request, res: Response) {
    const data = updateSchema.parse(req.body);
    const settings = await SettingsService.update(data, { id: req.user!.sub, name: req.user!.name });
    // O que passa a ser recusado (ou deixa de ser) com o bloqueio ligado.
    const { meta } = await ProductService.listWithoutRule();
    res.json({
      success: true,
      data: settings,
      meta: { blockedProducts: meta.total, blockedCombinations: meta.missingCount },
    });
  },
};
