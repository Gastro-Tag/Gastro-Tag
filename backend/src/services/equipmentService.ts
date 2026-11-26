import { Prisma, StorageType } from '@prisma/client';
import { prisma } from '../prisma/client';
import { AppError, Errors } from '../utils/errors';
import { addDays, daysBetween, kitchenToday } from '../utils/dateUtils';
import { parseDateOnly } from '../domain/shelfLife';
import { SettingsService } from './settingsService';
import type { Responsible } from './labelService';

/**
 * Temperatura dos equipamentos (geladeira, freezer). Registro separado da etiqueta: não entra no cálculo
 * do descarte e não bloqueia etiqueta nenhuma. A faixa de cada equipamento é a que a cozinha cadastra;
 * não é faixa regulatória validada. Turno não é modelado: cada leitura guarda a hora e o responsável.
 */

export const READINGS_DEFAULT_DAYS = 7;
export const READINGS_MAX_DAYS = 92;
export const READINGS_MAX_ROWS = 5000;

export interface EquipmentInput {
  name: string;
  storageType: StorageType;
  minTemperature: number;
  maxTemperature: number;
}

export type EquipmentUpdate = Partial<Pick<EquipmentInput, 'name' | 'minTemperature' | 'maxTemperature'>>;

export interface ReadingInput {
  equipmentId: string;
  /** Conta logada no aparelho. */
  userId: string;
  temperature: number;
  note?: string;
  requestId?: string;
}

/** Chamado só depois de descartar o reenvio: o token do operador não é conferido num reenvio. */
export type ResolveResponsible = () => Promise<Responsible>;

export interface ReadingFilters {
  from?: string;
  to?: string;
  equipmentId?: string;
}

const disabled = () => new AppError(
  'O registro de temperatura dos equipamentos está desligado.', 422, 'EQUIPMENT_TEMPERATURE_DISABLED',
);
const inactive = () => Errors.conflict('Este equipamento está desativado.');
const duplicateName = () => Errors.conflict('Já existe um equipamento ativo com este nome.');

const dateOnly = (value: Date) => value.toISOString().slice(0, 10);
const num = (value: Prisma.Decimal) => Number(value);

type EquipmentRow = Prisma.EquipmentGetPayload<object>;
type ReadingRow = Prisma.TemperatureReadingGetPayload<object>;

function serializeEquipment(row: EquipmentRow) {
  return { ...row, minTemperature: num(row.minTemperature), maxTemperature: num(row.maxTemperature) };
}

function serializeReading(row: ReadingRow & { equipment?: { name: string } }) {
  const { equipment, ...reading } = row;
  return {
    ...reading,
    temperature: num(reading.temperature),
    minTemperature: num(reading.minTemperature),
    maxTemperature: num(reading.maxTemperature),
    kitchenDate: dateOnly(reading.kitchenDate),
    handlerVerified: reading.handlerId !== null,
    ...(equipment ? { equipmentName: equipment.name } : {}),
  };
}

/** Nome único entre os ativos, sem diferenciar maiúsculas. A trava evita dois iguais em envios simultâneos. */
async function assertNameFree(tx: Prisma.TransactionClient, name: string, exceptId?: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('equipment:name'))`;
  const clash = await tx.equipment.findFirst({
    where: { active: true, name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (clash) throw duplicateName();
}

function assertRange(min: number, max: number) {
  if (min > max) throw Errors.validation('A temperatura mínima deve ser menor ou igual à máxima.');
}

async function findReplay(data: ReadingInput) {
  if (!data.requestId) return null;
  const existing = await prisma.temperatureReading.findUnique({
    where: { userId_requestId: { userId: data.userId, requestId: data.requestId } },
    include: { equipment: { select: { name: true } } },
  });
  if (existing && existing.equipmentId !== data.equipmentId) {
    throw Errors.conflict('Este pedido já registrou a temperatura de outro equipamento.');
  }
  return existing;
}

export const EquipmentService = {
  async list(includeInactive: boolean) {
    const rows = await prisma.equipment.findMany({
      where: includeInactive ? {} : { active: true },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
    return rows.map(serializeEquipment);
  },

  async create(data: EquipmentInput) {
    assertRange(data.minTemperature, data.maxTemperature);
    const row = await prisma.$transaction(async (tx) => {
      await assertNameFree(tx, data.name);
      return tx.equipment.create({ data });
    });
    return serializeEquipment(row);
  },

  /** Muda nome e faixa. Leituras antigas guardam a faixa da época e não mudam. */
  async update(id: string, data: EquipmentUpdate) {
    const row = await prisma.$transaction(async (tx) => {
      const current = await tx.equipment.findUnique({ where: { id } });
      if (!current) throw Errors.notFound('Equipamento');
      if (!current.active) throw inactive();
      assertRange(data.minTemperature ?? num(current.minTemperature), data.maxTemperature ?? num(current.maxTemperature));
      if (data.name !== undefined) await assertNameFree(tx, data.name, id);
      return tx.equipment.update({ where: { id }, data });
    });
    return serializeEquipment(row);
  },

  /** Só desativa (as leituras ficam). Repetir devolve o equipamento como está. */
  async deactivate(id: string) {
    const current = await prisma.equipment.findUnique({ where: { id } });
    if (!current) throw Errors.notFound('Equipamento');
    if (!current.active) return serializeEquipment(current);
    return serializeEquipment(await prisma.equipment.update({ where: { id }, data: { active: false } }));
  },

  /**
   * Registra uma leitura. Fora da faixa não é recusada: grava `outOfRange`. O reenvio com o mesmo
   * `requestId` é resolvido antes de tudo (configuração, equipamento e token), como em POST /labels.
   */
  async createReading(data: ReadingInput, resolveResponsible: ResolveResponsible) {
    const replay = await findReplay(data);
    if (replay) return { reading: serializeReading(replay), replayed: true };

    const settings = await SettingsService.get();
    if (!settings.equipmentTemperatureEnabled) throw disabled();
    const equipment = await prisma.equipment.findUnique({ where: { id: data.equipmentId } });
    if (!equipment) throw Errors.notFound('Equipamento');
    if (!equipment.active) throw inactive();
    const responsible = await resolveResponsible();

    const min = num(equipment.minTemperature);
    const max = num(equipment.maxTemperature);
    const readAt = new Date();
    try {
      const reading = await prisma.temperatureReading.create({
        data: {
          equipmentId: equipment.id, temperature: data.temperature,
          minTemperature: equipment.minTemperature, maxTemperature: equipment.maxTemperature,
          outOfRange: data.temperature < min || data.temperature > max,
          readAt, kitchenDate: kitchenToday(readAt),
          responsibleName: responsible.responsibleName.trim(), handlerId: responsible.handlerId,
          userId: data.userId, note: data.note ?? null, requestId: data.requestId ?? null,
        },
        include: { equipment: { select: { name: true } } },
      });
      return { reading: serializeReading(reading), replayed: false };
    } catch (error) {
      // Dois envios simultâneos do mesmo pedido: o segundo perde na chave única e devolve o primeiro.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const raced = await findReplay(data);
        if (raced) return { reading: serializeReading(raced), replayed: true };
      }
      throw error;
    }
  },

  /**
   * Situação de hoje (dia da cozinha) de cada equipamento ativo. Funciona com o registro desligado,
   * para o ADMIN preparar; quem decide mostrar é o frontend.
   */
  async today() {
    const today = kitchenToday();
    const equipment = await prisma.equipment.findMany({ where: { active: true }, orderBy: { name: 'asc' } });
    const readings = equipment.length === 0 ? [] : await prisma.temperatureReading.findMany({
      where: { kitchenDate: today, equipmentId: { in: equipment.map((item) => item.id) } },
      orderBy: { readAt: 'desc' },
      select: { equipmentId: true, temperature: true, readAt: true, responsibleName: true, outOfRange: true },
    });
    return {
      data: equipment.map((item) => {
        const own = readings.filter((reading) => reading.equipmentId === item.id);
        const last = own[0];
        return {
          id: item.id, name: item.name, storageType: item.storageType,
          minTemperature: num(item.minTemperature), maxTemperature: num(item.maxTemperature),
          lastReading: last
            ? { temperature: num(last.temperature), readAt: last.readAt, responsibleName: last.responsibleName, outOfRange: last.outOfRange }
            : null,
          readingsToday: own.length,
          outOfRangeToday: own.filter((reading) => reading.outOfRange).length,
        };
      }),
      meta: { kitchenToday: dateOnly(today) },
    };
  },

  /** Leituras do período (dia da cozinha, inclusivo), da mais nova para a mais antiga. */
  async readings(filters: ReadingFilters) {
    const today = kitchenToday();
    const toDate = filters.to ? parseDateOnly(filters.to, 'Data final') : today;
    const fromDate = filters.from ? parseDateOnly(filters.from, 'Data inicial')
      : addDays(toDate, -(READINGS_DEFAULT_DAYS - 1));
    if (fromDate > toDate) throw Errors.validation('A data inicial deve ser menor ou igual à data final.');
    if (daysBetween(fromDate, toDate) + 1 > READINGS_MAX_DAYS) {
      throw Errors.validation(`O período das leituras é de no máximo ${READINGS_MAX_DAYS} dias.`);
    }
    const where: Prisma.TemperatureReadingWhereInput = {
      kitchenDate: { gte: fromDate, lte: toDate },
      ...(filters.equipmentId ? { equipmentId: filters.equipmentId } : {}),
    };
    const [total, outOfRange, rows] = await Promise.all([
      prisma.temperatureReading.count({ where }),
      prisma.temperatureReading.count({ where: { ...where, outOfRange: true } }),
      prisma.temperatureReading.findMany({
        where, orderBy: [{ readAt: 'desc' }, { id: 'desc' }], take: READINGS_MAX_ROWS,
        include: { equipment: { select: { name: true } } },
      }),
    ]);
    return {
      data: rows.map(serializeReading),
      // total e outOfRange contam o período inteiro; truncated avisa que a lista parou no limite.
      meta: { from: dateOnly(fromDate), to: dateOnly(toDate), total, outOfRange, limit: READINGS_MAX_ROWS, truncated: total > READINGS_MAX_ROWS },
    };
  },
};
