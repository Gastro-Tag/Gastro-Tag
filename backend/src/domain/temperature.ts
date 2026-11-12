// Temperatura da etiqueta: o número medido vira o texto impresso, sempre no mesmo formato.

/** Faixa de sanidade da medição informada na etiqueta (°C). Não é faixa de conservação. */
export const LABEL_TEMPERATURE_MIN = -50;
export const LABEL_TEMPERATURE_MAX = 30;

/** Arredonda para uma casa decimal, metade para longe do zero (4,25 → 4,3; −4,25 → −4,3). */
export function roundTemperature(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError('Temperatura inválida.');
  // O épsilon corrige números como 4,25, que em ponto flutuante ficam um pouco abaixo da metade.
  const rounded = Math.sign(value) * Math.round(Math.abs(value) * 10 + 1e-9) / 10;
  return rounded === 0 ? 0 : rounded; // evita "-0,0 °C"
}

/** Texto padronizado gravado e impresso: uma casa decimal, vírgula e " °C" (ex.: "4,0 °C", "-18,0 °C"). */
export function formatTemperature(value: number): string {
  return `${roundTemperature(value).toFixed(1).replace('.', ',')} °C`;
}
