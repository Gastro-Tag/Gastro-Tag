// Plano B: o totem mede quanto tempo ficou sem rede para avisar o gerente (que lança as etiquetas de papel).
// Tudo aqui é local ao aparelho e nunca bloqueia a etiqueta. O valor é uma estimativa, não uma prova.

export const OFFLINE_KEY = 'gastrotag:totem:offlineSince';
export const PENDING_KEY = 'gastrotag:totem:outagePending';

export const MIN_OUTAGE_MS = 5 * 60_000;
/** Teto aceito pela API (7 dias). */
export const MAX_OUTAGE_MS = 7 * 24 * 60 * 60_000;
/** Duração que não conseguiu ser enviada é descartada depois disso, para não reaparecer meses depois. */
export const PENDING_TTL_MS = 24 * 60 * 60_000;

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* sem storage: a medição se perde, nada mais */ }
}
function remove(key: string): void {
  try { localStorage.removeItem(key); } catch { /* ignora */ }
}

/** Marca o início da queda; só grava se ainda não houver uma em andamento. */
export function markOffline(now: number): void {
  const current = Number(read(OFFLINE_KEY));
  if (Number.isFinite(current) && current > 0) return;
  write(OFFLINE_KEY, String(now));
}

/** Há uma queda em andamento (sem retorno de rede ainda)? */
export function isMarkedOffline(): boolean {
  const current = Number(read(OFFLINE_KEY));
  return Number.isFinite(current) && current > 0;
}

/**
 * Encerra a queda: devolve a duração em ms se passou do mínimo, senão null. Sempre limpa o valor.
 * Relógio que voltou para trás (duração <= 0) ou valor ilegível é ignorado; acima de 7 dias vira 7 dias.
 */
export function takeOutage(now: number, minMs: number = MIN_OUTAGE_MS): number | null {
  const raw = read(OFFLINE_KEY);
  remove(OFFLINE_KEY);
  if (raw === null) return null;
  const since = Number(raw);
  if (!Number.isFinite(since) || since <= 0) return null;
  const durationMs = now - since;
  if (durationMs <= 0 || durationMs < minMs) return null;
  return Math.min(Math.round(durationMs), MAX_OUTAGE_MS);
}

interface Pending { durationMs: number; savedAt: number }

/** Guarda uma duração que ainda não foi enviada ao servidor. */
export function savePending(durationMs: number, now: number): void {
  write(PENDING_KEY, JSON.stringify({ durationMs, savedAt: now } satisfies Pending));
}

/** Duração aguardando reenvio; vencida (24 h), ilegível ou fora do intervalo é apagada e vira null. */
export function loadPending(now: number): number | null {
  const raw = read(PENDING_KEY);
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Pending> | null;
    const { durationMs, savedAt } = parsed ?? {};
    if (
      typeof durationMs === 'number' && typeof savedAt === 'number'
      && durationMs >= 60_000 && durationMs <= MAX_OUTAGE_MS
      && now >= savedAt && now - savedAt <= PENDING_TTL_MS
    ) return durationMs;
  } catch { /* cai na limpeza */ }
  remove(PENDING_KEY);
  return null;
}

export function clearPending(): void {
  remove(PENDING_KEY);
}

/** "cerca de 12 min", "cerca de 2 h 5 min". */
export function outageDurationText(durationMs: number): string {
  const minutes = Math.max(1, Math.round(durationMs / 60_000));
  if (minutes < 60) return `cerca de ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `cerca de ${days} ${days === 1 ? 'dia' : 'dias'}`;
  }
  return rest === 0 ? `cerca de ${hours} h` : `cerca de ${hours} h ${rest} min`;
}

/** Aviso do totem. A frase pedida usa minutos; acima de 1 h mostra horas para não ficar "720 min". */
export function outageNoticeText(durationMs: number): string {
  const minutes = Math.max(1, Math.round(durationMs / 60_000));
  const span = minutes < 60 ? `cerca de ${minutes} min` : outageDurationText(durationMs);
  return `A rede ficou fora por ${span}. Se usou etiqueta de papel, entregue a folha ao gerente para lançar no sistema.`;
}
