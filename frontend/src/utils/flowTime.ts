/** Limite aceito pela API para o tempo do fluxo (1 hora). */
export const FLOW_MAX_MS = 3_600_000;
/** Teto de plausibilidade no cliente: acima de 10 minutos o aparelho ficou parado e o tempo não é enviado. */
export const FLOW_PLAUSIBLE_MAX_MS = 600_000;

/**
 * Tempo decorrido entre `start` e `now` (ambos de performance.now()), em ms inteiros.
 * Devolve undefined quando não dá para confiar: início ausente, relógio que voltou
 * (ex.: página recarregada, performance.now() recomeça) ou fluxo acima de 10 min (aparelho parado).
 * Nesses casos o campo simplesmente não é enviado.
 */
export function elapsedFlowMs(start: number | null | undefined, now: number): number | undefined {
  if (typeof start !== 'number' || !Number.isFinite(start) || !Number.isFinite(now)) return undefined;
  const elapsed = Math.round(now - start);
  if (elapsed < 0 || elapsed > FLOW_PLAUSIBLE_MAX_MS) return undefined;
  return elapsed;
}

/** Lê o início do fluxo passado no estado da navegação (`{ flowStart }`); undefined se não vier um número válido. */
export function flowStartFromState(state: unknown): number | undefined {
  if (typeof state !== 'object' || state === null) return undefined;
  const value = (state as { flowStart?: unknown }).flowStart;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** ms para "12,3 s" (uma casa, vírgula); "—" quando não há dado. */
export function formatFlowSeconds(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  return `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
}

/** Percentual inteiro de `part` sobre `total`; null quando não há base. */
export function percentOf(part: number, total: number): number | null {
  if (!total || total <= 0) return null;
  return Math.round((part / total) * 100);
}
