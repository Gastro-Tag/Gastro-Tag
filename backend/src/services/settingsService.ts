import { Prisma } from '@prisma/client';
import { prisma } from '../prisma/client';

type Db = Prisma.TransactionClient;

/** Linha única até a Fase 2, quando a configuração passa a ser por cliente. */
const SETTINGS_ID = 1;

export interface KitchenSettingsData {
  requireValidatedRule: boolean;
  updatedAt: Date | null;
  updatedByName: string | null;
}

/** Sem linha gravada, valem os padrões (bloqueio desligado). */
const DEFAULTS: KitchenSettingsData = { requireValidatedRule: false, updatedAt: null, updatedByName: null };

export const SettingsService = {
  /** Aceita a transação para a leitura valer junto com o que ela decide (ex.: Dividir). */
  async get(db: Db = prisma): Promise<KitchenSettingsData> {
    const row = await db.kitchenSettings.findUnique({
      where: { id: SETTINGS_ID },
      select: { requireValidatedRule: true, updatedAt: true, updatedByName: true },
    });
    return row ?? DEFAULTS;
  },

  async update(data: { requireValidatedRule: boolean }, actor: { id: string; name: string }): Promise<KitchenSettingsData> {
    const fields = { requireValidatedRule: data.requireValidatedRule, updatedById: actor.id, updatedByName: actor.name };
    return prisma.kitchenSettings.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID, ...fields },
      update: fields,
      select: { requireValidatedRule: true, updatedAt: true, updatedByName: true },
    });
  },
};
