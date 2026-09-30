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
  const now = kitchenToday();
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return Math.round((d.getTime() - now.getTime()) / 86_400_000);
}

export function kitchenToday(): Date {
  const timeZone = process.env.KITCHEN_TIME_ZONE || 'America/Manaus';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: string) => Number(parts.find((item) => item.type === type)?.value);
  return new Date(Date.UTC(part('year'), part('month') - 1, part('day')));
}

export function kitchenDayStartInstant(date = kitchenToday()): Date {
  const timeZone = process.env.KITCHEN_TIME_ZONE || 'America/Manaus';
  const guess = new Date(date);
  guess.setUTCHours(0, 0, 0, 0);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(guess);
  const part = (type: string) => Number(parts.find((item) => item.type === type)?.value);
  const displayedAsUtc = Date.UTC(
    part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'),
  );
  return new Date(guess.getTime() + guess.getTime() - displayedAsUtc);
}

export function getProductStatus(date: Date): 'valid' | 'expiring' | 'expired' {
  const days = daysUntil(date);
  if (days < 0) return 'expired';
  if (days <= 7) return 'expiring';
  return 'valid';
}

export function kitchenWeekAgo(): Date {
  const today = kitchenToday();
  today.setUTCDate(today.getUTCDate() - 7);
  return kitchenDayStartInstant(today);
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
