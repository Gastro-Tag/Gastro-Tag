/**
 * Recebe uma string ISO 'YYYY-MM-DD' e retorna um Date sem horário (meia-noite UTC).
 * Evita bugs de timezone ao parsear datas de formulário.
 */
export function parseDateUTC(str: string): Date {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Adiciona N dias a uma Date e retorna nova Date */
export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/** Calcula data de descarte com base na data de abertura e dias de validade */
export function calcDiscardDate(openedAt: Date, days: number): Date {
  return addDays(openedAt, days);
}

/** Retorna número de dias até a data (negativo = vencido) */
export function daysUntil(date: Date): number {
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return Math.round((d.getTime() - now.getTime()) / 86_400_000);
}

/** Gera short code único de 8 chars para etiqueta */
export function generateShortCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  const arr = new Uint8Array(8);
  // Node.js crypto
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('crypto').getRandomValues
    ? require('crypto').getRandomValues(arr)
    : arr.forEach((_, i) => (arr[i] = Math.floor(Math.random() * 256)));
  for (let i = 0; i < 8; i++) code += chars[arr[i] % chars.length];
  return code;
}
