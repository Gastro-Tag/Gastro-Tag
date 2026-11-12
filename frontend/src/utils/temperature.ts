import type { StorageType } from '@/types';

/** Faixa aceita pela API na etiqueta (°C). */
export const TEMP_MIN = -50;
export const TEMP_MAX = 30;

/**
 * Valores sugeridos por armazenamento. São só sugestão: não contam como medição
 * e o operador precisa digitá-los ou confirmá-los a cada etiqueta.
 */
export const SUGGESTED_TEMPERATURE: Record<StorageType, number> = {
  REFRIGERADO: 4,
  CONGELADO: -18,
};

/** "4", "-18", "−18", "4,5", "4 °C" → número com uma casa; null se inválido ou fora de −50..30. */
export function parseTemperature(raw: string): number | null {
  const text = raw
    .replace(/[−‒–]/g, '-')
    .replace(/°?\s*c\s*$/i, '')
    .replace(/\s+/g, '')
    .replace(',', '.');
  if (!/^[-+]?\d+(\.\d+)?$/.test(text)) return null;
  const raw10 = Number(text) * 10;
  // Metade para longe do zero, como no backend: -4,25 -> -4,3.
  const value = (Math.sign(raw10) * Math.round(Math.abs(raw10) + 1e-9)) / 10;
  if (!Number.isFinite(value) || value < TEMP_MIN || value > TEMP_MAX) return null;
  return Object.is(value, -0) ? 0 : value;
}

/** Mesmo formato do servidor para temperatura informada: 4 → "4,0 °C"; -18 → "-18,0 °C". */
export function formatTemperature(value: number): string {
  return `${value.toFixed(1).replace('.', ',')} °C`;
}

/** Sugestões e faixas: 4 → "4 °C"; -18 → "\u221218 °C"; 4.5 → "4,5 °C". */
export function formatTemperatureShort(value: number): string {
  return `${String(value).replace('-', '−').replace('.', ',')} °C`;
}

/** Valor para campo de texto/teclado: 4.5 → "4,5"; -18 → "-18". */
export function temperatureDraft(value: number): string {
  return String(value).replace('.', ',');
}

/** Faixa da regra em texto, ou null quando não há faixa. */
export function formatTemperatureRange(min: number | null | undefined, max: number | null | undefined): string | null {
  if (min != null && max != null) return `${formatTemperatureShort(min)} a ${formatTemperatureShort(max)}`;
  if (min != null) return `mínimo ${formatTemperatureShort(min)}`;
  if (max != null) return `máximo ${formatTemperatureShort(max)}`;
  return null;
}
