/** Parse ISO date string without timezone shift */
export function parseDate(iso: string): Date {
  const [y, m, d] = iso.split('T')[0].split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Format date to Brazilian format DD/MM/YYYY */
export function formatBR(iso: string): string {
  if (!iso) return '';
  const d = parseDate(iso);
  return d.toLocaleDateString('pt-BR');
}

/** Today as YYYY-MM-DD (local time, no timezone shift) */
export function todayISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Days between today and a future/past date (negative = past) */
export function daysUntil(iso: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = parseDate(iso);
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
}

export function daysUntilLabel(days: number): string {
  if (days < 0)  return `Vencido há ${Math.abs(days)} dia${Math.abs(days) !== 1 ? 's' : ''}`;
  if (days === 0) return 'Vence hoje!';
  return `${days} dia${days !== 1 ? 's' : ''} restante${days !== 1 ? 's' : ''}`;
}

export function statusFromDays(days: number): 'valid' | 'expiring' | 'expired' {
  if (days < 0)  return 'expired';
  if (days <= 7) return 'expiring';
  return 'valid';
}
