import type { EquipmentToday, StorageType } from '@/types';
import { TEMP_MAX, TEMP_MIN, formatTemperatureShort, parseTemperature } from '@/utils/temperature';

export const NO_READING_TODAY = 'Sem leitura hoje';

/** Faixa do equipamento em texto: "2 °C a 5 °C" (só descreve a faixa cadastrada). */
export function equipmentRangeText(min: number, max: number): string {
  return `${formatTemperatureShort(min)} a ${formatTemperatureShort(max)}`;
}

/** 4 → "4"; -18 → "−18"; 4.5 → "4,5" (sem unidade, para compor "min a max °C"). */
function plain(value: number): string {
  return String(value).replace('-', '−').replace('.', ',');
}

/** Aviso do totem quando a leitura sai da faixa: não bloqueia, só manda avisar o responsável. */
export function outOfRangeMessage(min: number, max: number): string {
  return `Fora da faixa (${plain(min)} a ${plain(max)} °C): avise o responsável`;
}

/** Equipamento ainda sem nenhuma leitura no dia da cozinha. */
export function missingToday(item: Pick<EquipmentToday, 'readingsToday'>): boolean {
  return item.readingsToday === 0;
}

export function countMissingToday(items: Pick<EquipmentToday, 'readingsToday'>[]): number {
  return items.filter(missingToday).length;
}

/**
 * Leitura digitada: o mesmo parse da etiqueta (sinal negativo, vírgula, −50..30),
 * mas recusa mais de uma casa decimal em vez de arredondar em silêncio (a leitura tem que ser a medida).
 */
export function parseReading(raw: string): number | null {
  const text = raw.trim().replace(/[−‒–]/g, '-').replace(',', '.');
  const decimals = text.split('.')[1];
  if (decimals !== undefined && decimals.replace(/\s*°?\s*c\s*$/i, '').length > 1) return null;
  return parseTemperature(raw);
}

export const READING_INVALID_MESSAGE = `Digite a temperatura medida, de ${TEMP_MIN} a ${TEMP_MAX} °C, com no máximo uma casa decimal.`;

export const EQUIPMENT_STORAGE_LABEL: Record<StorageType, string> = {
  REFRIGERADO: 'Refrigerado',
  CONGELADO: 'Congelado',
};

export interface EquipmentFormValues {
  name: string;
  storageType: StorageType;
  min: string;
  max: string;
}

export type EquipmentFormResult =
  | { ok: true; value: { name: string; storageType: StorageType; minTemperature: number; maxTemperature: number } }
  | { ok: false; error: string };

/** Valida o cadastro. A faixa começa vazia: não há padrão inventado. */
export function validateEquipmentForm(form: EquipmentFormValues): EquipmentFormResult {
  const name = form.name.trim().replace(/\s+/g, ' ');
  if (name.length < 2) return { ok: false, error: 'Informe o nome do equipamento.' };
  if (name.length > 60) return { ok: false, error: 'O nome pode ter no máximo 60 caracteres.' };
  const min = parseReading(form.min);
  const max = parseReading(form.max);
  if (min === null || max === null) {
    return { ok: false, error: `Informe a temperatura mínima e a máxima, de ${TEMP_MIN} a ${TEMP_MAX} °C, com no máximo uma casa decimal.` };
  }
  if (min > max) return { ok: false, error: 'A mínima não pode ser maior que a máxima.' };
  return { ok: true, value: { name, storageType: form.storageType, minTemperature: min, maxTemperature: max } };
}
