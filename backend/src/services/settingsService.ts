import { Prisma } from '@prisma/client';
import { prisma } from '../prisma/client';

type Db = Prisma.TransactionClient;

/** Linha única até a Fase 2, quando a configuração passa a ser por cliente. */
const SETTINGS_ID = 1;

/** Modelos de etiqueta (os mesmos de frontend/src/utils/labelTemplates.ts). */
export const LABEL_TEMPLATE_IDS = ['a4', 't100x60', 't60x40', 't50x30'] as const;
export type LabelTemplateId = (typeof LABEL_TEMPLATE_IDS)[number];

/** Sem enum no banco: um valor desconhecido gravado vira null (não definido), nunca erro. */
function toLabelTemplate(value: string | null): LabelTemplateId | null {
  return (LABEL_TEMPLATE_IDS as readonly string[]).includes(value ?? '') ? value as LabelTemplateId : null;
}

export interface KitchenSettingsData {
  requireValidatedRule: boolean;
  /** Aviso na prévia quando a validade digitada passa de abertura + N meses. Nulo: desligado. */
  expiryWarningMonths: number | null;
  /** Modelo de etiqueta padrão da cozinha. Nulo: não definido (cada aparelho segue a própria escolha ou A4). */
  labelTemplate: LabelTemplateId | null;
  /** Cabeçalho do relatório do período. Nulo: não informado. */
  kitchenName: string | null;
  technicalResponsible: string | null;
  /** Registro de temperatura dos equipamentos. Desligado (padrão): a leitura é recusada. */
  equipmentTemperatureEnabled: boolean;
  updatedAt: Date | null;
  updatedByName: string | null;
}

/** Sem linha gravada, valem os padrões (bloqueio desligado). */
const DEFAULTS: KitchenSettingsData = {
  requireValidatedRule: false, expiryWarningMonths: null, labelTemplate: null,
  kitchenName: null, technicalResponsible: null, equipmentTemperatureEnabled: false, updatedAt: null, updatedByName: null,
};

const settingsSelect = {
  requireValidatedRule: true, expiryWarningMonths: true, labelTemplate: true,
  kitchenName: true, technicalResponsible: true, equipmentTemperatureEnabled: true, updatedAt: true, updatedByName: true,
} as const;

type SettingsRow = Omit<KitchenSettingsData, 'labelTemplate' | 'updatedAt'> & { labelTemplate: string | null; updatedAt: Date };

const toData = (row: SettingsRow): KitchenSettingsData => ({ ...row, labelTemplate: toLabelTemplate(row.labelTemplate) });

/** Corpo parcial do PUT: só o que vier é alterado. */
export interface KitchenSettingsUpdate {
  requireValidatedRule?: boolean;
  expiryWarningMonths?: number | null;
  labelTemplate?: LabelTemplateId | null;
  kitchenName?: string | null;
  technicalResponsible?: string | null;
  equipmentTemperatureEnabled?: boolean;
}

export const SettingsService = {
  /** Aceita a transação para a leitura valer junto com o que ela decide (ex.: Dividir). */
  async get(db: Db = prisma): Promise<KitchenSettingsData> {
    const row = await db.kitchenSettings.findUnique({
      where: { id: SETTINGS_ID },
      select: settingsSelect,
    });
    return row ? toData(row) : DEFAULTS;
  },

  async update(data: KitchenSettingsUpdate, actor: { id: string; name: string }): Promise<KitchenSettingsData> {
    // `undefined` não altera a coluna; sem linha, o que não veio fica com o padrão do banco.
    const fields = {
      requireValidatedRule: data.requireValidatedRule,
      expiryWarningMonths: data.expiryWarningMonths,
      labelTemplate: data.labelTemplate,
      kitchenName: data.kitchenName,
      technicalResponsible: data.technicalResponsible,
      equipmentTemperatureEnabled: data.equipmentTemperatureEnabled,
      updatedById: actor.id, updatedByName: actor.name,
    };
    const row = await prisma.kitchenSettings.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID, ...fields },
      update: fields,
      select: settingsSelect,
    });
    return toData(row);
  },
};
