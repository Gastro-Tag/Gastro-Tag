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

/** Format a timestamp consistently with the application's Manaus timezone. */
export function formatDateTimeBR(iso?: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Manaus',
  }).format(date);
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

/** Resumo dos lotes ativos para os selos de status do produto. */
export function productStatusLabel(product: {
  computedStatus: string; daysUntilExpiry: number | null; expiredLotCount: number;
}): string {
  if (product.computedStatus === 'no_lot') return 'Sem lote';
  if (product.expiredLotCount > 0) {
    return `${product.expiredLotCount} lote${product.expiredLotCount !== 1 ? 's' : ''} vencido${product.expiredLotCount !== 1 ? 's' : ''}`;
  }
  return daysUntilLabel(product.daysUntilExpiry ?? 0);
}

export function statusFromDays(days: number): 'valid' | 'expiring' | 'expired' {
  if (days < 0)  return 'expired';
  if (days <= 7) return 'expiring';
  return 'valid';
}
