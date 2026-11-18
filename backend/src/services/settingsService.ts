import { Prisma } from '@prisma/client';
import { prisma } from '../prisma/client';

type Db = Prisma.TransactionClient;

/** Linha única até a Fase 2, quando a configuração passa a ser por cliente. */
const SETTINGS_ID = 1;

export interface KitchenSettingsData {
  requireValidatedRule: boolean;
  /** Aviso na prévia quando a validade digitada passa de abertura + N meses. Nulo: desligado. */
  expiryWarningMonths: number | null;
  updatedAt: Date | null;
  updatedByName: string | null;
}

/** Sem linha gravada, valem os padrões (bloqueio desligado). */
const DEFAULTS: KitchenSettingsData = {
  requireValidatedRule: false, expiryWarningMonths: null, updatedAt: null, updatedByName: null,
};

const settingsSelect = {
  requireValidatedRule: true, expiryWarningMonths: true, updatedAt: true, updatedByName: true,
} as const;

/** Corpo parcial do PUT: só o que vier é alterado. */
export interface KitchenSettingsUpdate {
  requireValidatedRule?: boolean;
  expiryWarningMonths?: number | null;
}

export const SettingsService = {
  /** Aceita a transação para a leitura valer junto com o que ela decide (ex.: Dividir). */
  async get(db: Db = prisma): Promise<KitchenSettingsData> {
    const row = await db.kitchenSettings.findUnique({
      where: { id: SETTINGS_ID },
      select: settingsSelect,
    });
    return row ?? DEFAULTS;
  },

  async update(data: KitchenSettingsUpdate, actor: { id: string; name: string }): Promise<KitchenSettingsData> {
    // `undefined` não altera a coluna; sem linha, o que não veio fica com o padrão do banco.
    const fields = {
      requireValidatedRule: data.requireValidatedRule,
      expiryWarningMonths: data.expiryWarningMonths,
      updatedById: actor.id, updatedByName: actor.name,
    };
    return prisma.kitchenSettings.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID, ...fields },
      update: fields,
      select: settingsSelect,
    });
  },
};
