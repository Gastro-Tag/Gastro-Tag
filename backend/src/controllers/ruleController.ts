import { Request, Response } from 'express';
import { z } from 'zod';
import { RuleService } from '../services/ruleService';
import { parseDateOnly } from '../domain/shelfLife';
import { LABEL_TEMPERATURE_MAX, LABEL_TEMPERATURE_MIN } from '../domain/temperature';

const noNullByte = (value: string) => !value.includes('\u0000');

// Mesma faixa de sanidade da temperatura informada na etiqueta.
const temperature = z.number({ invalid_type_error: 'Informe a temperatura em número (°C).' })
  .finite()
  .min(LABEL_TEMPERATURE_MIN, `Temperatura mínima: ${LABEL_TEMPERATURE_MIN} °C.`)
  .max(LABEL_TEMPERATURE_MAX, `Temperatura máxima: ${LABEL_TEMPERATURE_MAX} °C.`)
  .nullable().optional();

// Conteúdo de cada versão. Prazos e fontes vêm do ADMIN: o sistema não cadastra valores por conta própria.
const versionFields = z.object({
  shelfLifeDays: z.number().int('O prazo deve ser um número inteiro de dias.')
    .min(1, 'O prazo deve ser de pelo menos 1 dia.').max(3650, 'O prazo máximo é de 3650 dias.'),
  minTemperature: temperature,
  maxTemperature: temperature,
  sourceType: z.enum(['NORMA_LEGAL', 'REFERENCIA_TECNICA', 'FABRICANTE', 'PROCEDIMENTO_INTERNO']),
  source: z.string().trim().min(3, 'Informe a fonte da regra.').max(300).refine(noNullByte, 'Fonte inválida.'),
  observation: z.string().trim().max(500).refine(noNullByte, 'Observação inválida.').nullable().optional()
    .transform((value) => value || null),
  validatedByName: z.string().trim().min(2, 'Informe quem validou a regra.').max(100)
    .refine(noNullByte, 'Nome inválido.'),
  validatedAt: z.string().refine((value) => {
    try { parseDateOnly(value); return true; } catch { return false; }
  }, 'Informe uma data real no formato YYYY-MM-DD.'),
});

const temperatureOrder = (data: { minTemperature?: number | null; maxTemperature?: number | null }) =>
  data.minTemperature == null || data.maxTemperature == null || data.minTemperature <= data.maxTemperature;
const temperatureOrderError = { message: 'A temperatura mínima deve ser menor ou igual à máxima.' };

const createSchema = versionFields.extend({
  productId: z.string().uuid().optional(),
  category: z.string().trim().min(1).max(60).refine(noNullByte, 'Categoria inválida.').optional(),
  storageType: z.enum(['REFRIGERADO', 'CONGELADO']),
}).refine(temperatureOrder, temperatureOrderError)
  .refine((data) => Boolean(data.productId) !== Boolean(data.category), {
    message: 'A regra vale para um produto ou para uma categoria, nunca para os dois.',
  });

// Nova versão: alvo e armazenamento vêm da versão anterior; se enviados, são ignorados.
const versionSchema = versionFields.refine(temperatureOrder, temperatureOrderError);

const listSchema = z.object({
  productId: z.string().uuid().optional(),
  category: z.string().trim().max(60).optional(),
  storageType: z.enum(['REFRIGERADO', 'CONGELADO']).optional(),
  includeInactive: z.enum(['true', 'false']).optional().transform((value) => value === 'true'),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

const idSchema = z.object({ id: z.string().uuid() });

export const RuleController = {
  async list(req: Request, res: Response) {
    const query = listSchema.parse(req.query);
    const result = await RuleService.list(query);
    res.json({ success: true, ...result });
  },

  async versions(req: Request, res: Response) {
    const { id } = idSchema.parse(req.params);
    const versions = await RuleService.versions(id);
    res.json({ success: true, data: versions });
  },

  async create(req: Request, res: Response) {
    const data = createSchema.parse(req.body);
    const rule = await RuleService.create(data, req.user!.sub);
    res.status(201).json({ success: true, data: rule });
  },

  async createVersion(req: Request, res: Response) {
    const { id } = idSchema.parse(req.params);
    const data = versionSchema.parse(req.body);
    const rule = await RuleService.createVersion(id, data, req.user!.sub);
    res.status(201).json({ success: true, data: rule });
  },

  async deactivate(req: Request, res: Response) {
    const { id } = idSchema.parse(req.params);
    const rule = await RuleService.deactivate(id);
    res.json({ success: true, data: rule });
  },
};
