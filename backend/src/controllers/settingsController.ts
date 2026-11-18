import { Request, Response } from 'express';
import { z } from 'zod';
import { SettingsService } from '../services/settingsService';
import { ProductService } from '../services/productService';

const EXPIRY_WARNING_MONTHS_ERROR = 'Informe o limite do aviso de validade em meses inteiros, de 1 a 60, ou null para desligar.';

// Corpo parcial: só o que vier é alterado, mas ao menos um campo.
const updateSchema = z.strictObject({
  requireValidatedRule: z.boolean({ error: 'Informe se a etiqueta exige regra validada (true ou false).' }).optional(),
  expiryWarningMonths: z.number({ error: EXPIRY_WARNING_MONTHS_ERROR })
    .int(EXPIRY_WARNING_MONTHS_ERROR).min(1, EXPIRY_WARNING_MONTHS_ERROR).max(60, EXPIRY_WARNING_MONTHS_ERROR)
    .nullable().optional(),
}).refine(
  (data) => data.requireValidatedRule !== undefined || data.expiryWarningMonths !== undefined,
  { message: 'Informe ao menos uma configuração para alterar.' },
);

export const SettingsController = {
  async get(_req: Request, res: Response) {
    res.json({ success: true, data: await SettingsService.get() });
  },

  async update(req: Request, res: Response) {
    const data = updateSchema.parse(req.body);
    const settings = await SettingsService.update(data, { id: req.user!.sub, name: req.user!.name });
    // O que passa a ser recusado (ou deixa de ser) com o bloqueio ligado.
    // A configuração já foi gravada: falha nesta contagem não pode virar erro (o ADMIN acharia que nada mudou).
    const meta = await ProductService.listWithoutRule().then(
      (r) => ({ blockedProducts: r.meta.total as number | null, blockedCombinations: r.meta.missingCount as number | null }),
      () => ({ blockedProducts: null, blockedCombinations: null }),
    );
    res.json({ success: true, data: settings, meta });
  },
};
