import { Request, Response } from 'express';
import { z } from 'zod';
import { EquipmentService } from '../services/equipmentService';
import { OperatorService } from '../services/operatorService';
import { parseDateOnly } from '../domain/shelfLife';
import { LABEL_TEMPERATURE_MAX, LABEL_TEMPERATURE_MIN, roundTemperature } from '../domain/temperature';
import { Errors } from '../utils/errors';

const noNul = (value: string) => !value.includes('\u0000');
const idSchema = z.string().uuid('Equipamento inválido.');

const dateSchema = z.string().refine((value) => {
  try { parseDateOnly(value); return true; } catch { return false; }
}, 'Informe uma data real no formato YYYY-MM-DD.');

/** °C de −50 a 30, arredondado a uma casa (como na etiqueta). */
const temperature = (label: string) => {
  const rangeError = `${label} fora da faixa aceita (${LABEL_TEMPERATURE_MIN} a ${LABEL_TEMPERATURE_MAX} °C).`;
  return z.number({
    error: (issue) => (issue.input === undefined ? `Informe ${label.toLowerCase()} em °C.` : `${label} deve ser um número (°C).`),
  }).min(LABEL_TEMPERATURE_MIN, rangeError).max(LABEL_TEMPERATURE_MAX, rangeError).transform(roundTemperature);
};

const nameSchema = z.string({ error: 'Informe o nome do equipamento.' }).trim()
  .min(1, 'Informe o nome do equipamento.').max(60, 'O nome do equipamento deve ter no máximo 60 caracteres.')
  .refine(noNul, 'Nome inválido.');

const rangeOrder = [
  (data: { minTemperature?: number; maxTemperature?: number }) =>
    data.minTemperature === undefined || data.maxTemperature === undefined || data.minTemperature <= data.maxTemperature,
  { message: 'A temperatura mínima deve ser menor ou igual à máxima.' },
] as const;

const createSchema = z.strictObject({
  name: nameSchema,
  storageType: z.enum(['REFRIGERADO', 'CONGELADO'], { error: 'Escolha o tipo de armazenamento do equipamento.' }),
  minTemperature: temperature('A temperatura mínima'),
  maxTemperature: temperature('A temperatura máxima'),
}).refine(...rangeOrder);

// Parcial: nome e faixa. O tipo de armazenamento não muda (strict recusa).
const updateSchema = z.strictObject({
  name: nameSchema.optional(),
  minTemperature: temperature('A temperatura mínima').optional(),
  maxTemperature: temperature('A temperatura máxima').optional(),
}).refine(...rangeOrder).refine(
  (data) => data.name !== undefined || data.minTemperature !== undefined || data.maxTemperature !== undefined,
  { message: 'Informe o nome ou a faixa para alterar.' },
);

const listSchema = z.object({
  all: z.enum(['true', 'false'], { error: 'Use all=true ou all=false.' }).optional(),
});

const readingSchema = z.strictObject({
  temperature: temperature('A temperatura'),
  // Sem token do operador (PIN), o nome digitado é obrigatório; com token, o nome vem dele.
  responsibleName: z.string({ error: 'Informe o nome do responsável.' }).trim()
    .min(2, 'Informe o nome do responsável (mínimo 2 caracteres).').max(100, 'O nome deve ter no máximo 100 caracteres.')
    .refine(noNul, 'Nome inválido.').optional(),
  handlerToken: z.string().min(1).max(2000).optional(),
  note: z.string({ error: 'A observação deve ser texto.' }).trim().max(200, 'A observação deve ter no máximo 200 caracteres.')
    .refine(noNul, 'Observação inválida.').optional().transform((value) => value || undefined),
  requestId: z.string().uuid('Identificador do envio inválido.').optional(),
}).refine((data) => Boolean(data.responsibleName || data.handlerToken), { message: 'Informe o nome do responsável.' });

const readingsQuerySchema = z.object({
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  equipmentId: idSchema.optional(),
}).refine((query) => !query.from || !query.to || query.from <= query.to, {
  message: 'A data inicial deve ser menor ou igual à data final.',
});

export const EquipmentController = {
  async list(req: Request, res: Response) {
    const { all } = listSchema.parse(req.query);
    const includeInactive = all === 'true';
    if (includeInactive && req.user!.role !== 'ADMIN') throw Errors.forbidden();
    res.json({ success: true, data: await EquipmentService.list(includeInactive) });
  },

  async create(req: Request, res: Response) {
    const data = createSchema.parse(req.body);
    res.status(201).json({ success: true, data: await EquipmentService.create(data) });
  },

  async update(req: Request, res: Response) {
    const id = idSchema.parse(req.params.id);
    const data = updateSchema.parse(req.body);
    res.json({ success: true, data: await EquipmentService.update(id, data) });
  },

  async remove(req: Request, res: Response) {
    const id = idSchema.parse(req.params.id);
    res.json({ success: true, data: await EquipmentService.deactivate(id) });
  },

  async createReading(req: Request, res: Response) {
    const equipmentId = idSchema.parse(req.params.id);
    const { handlerToken, responsibleName, ...data } = readingSchema.parse(req.body);
    const { reading, replayed } = await EquipmentService.createReading(
      { ...data, equipmentId, userId: req.user!.sub },
      // Operador do token (401 HANDLER_INVALID se inválido) ou o nome digitado; não roda num reenvio.
      async () => {
        const handler = await OperatorService.resolve(handlerToken, req.user!.sid);
        return { responsibleName: handler?.name ?? responsibleName!, handlerId: handler?.id ?? null };
      },
    );
    res.status(replayed ? 200 : 201).json({ success: true, data: reading });
  },

  async today(_req: Request, res: Response) {
    res.json({ success: true, ...await EquipmentService.today() });
  },

  async readings(req: Request, res: Response) {
    const query = readingsQuerySchema.parse(req.query);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, ...await EquipmentService.readings(query) });
  },
};
