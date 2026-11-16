import type { StorageType } from '@/types';
import { parseDate } from './date';

/**
 * Preferências do totem, guardadas só neste aparelho (localStorage).
 * Servem apenas para reduzir toques; as regras de validade e o cálculo continuam no backend.
 */
const NS = 'gastrotag:totem:';
const SHIFT_MS = 10 * 60 * 60 * 1000; // responsável expira após 10 h (troca de turno)
const MAX_RECENT_OPERATORS = 8;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(NS + key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(NS + key, JSON.stringify(value));
  } catch {
    /* modo privado ou cota cheia: o totem segue funcionando sem memória */
  }
}

/** Temperatura sugerida (°C). Não é medição: o operador confirma a cada etiqueta. */
export { SUGGESTED_TEMPERATURE as DEFAULT_TEMP } from './temperature';

export const STORAGE_LABEL: Record<StorageType, string> = {
  REFRIGERADO: 'Refrigerado',
  CONGELADO: 'Congelado',
};

// ── Responsável ──────────────────────────────────────────
export function cleanName(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 100);
}

/** Operador do turno, guardado neste aparelho. Com PIN, traz também o id e o handlerToken. */
export interface OperatorSession {
  name: string;
  /** Preenchidos só quando o operador confirmou o PIN. */
  id?: string;
  handlerToken?: string;
  /** Fim da validade do handlerToken (ms desde 1970). */
  tokenExpiresAt?: number;
}

type SavedOperator = { name: string; at: number } & Partial<Pick<OperatorSession, 'id' | 'handlerToken' | 'tokenExpiresAt'>>;

/** Sessão válida do operador: some 10 h depois, ou antes se o token do PIN vencer antes. */
export function getOperatorSession(now = Date.now()): OperatorSession | null {
  const saved = read<SavedOperator | null>('operator', null);
  if (!saved || !saved.name) return null;
  if (now - saved.at > SHIFT_MS) return null;
  if (saved.handlerToken && saved.tokenExpiresAt !== undefined && now >= saved.tokenExpiresAt) return null;
  return { name: saved.name, id: saved.id, handlerToken: saved.handlerToken, tokenExpiresAt: saved.tokenExpiresAt };
}

export function getOperator(now = Date.now()): string {
  return getOperatorSession(now)?.name ?? '';
}

/** Token do operador confirmado por PIN; vazio quando o nome foi apenas digitado. */
export function getHandlerToken(now = Date.now()): string {
  return getOperatorSession(now)?.handlerToken ?? '';
}

/** Operador que confirmou o PIN: guarda o token junto do turno (mesma expiração, a menor entre as duas). */
export function rememberVerifiedOperator(
  operator: { id: string; name: string }, handlerToken: string, expiresAtIso: string, now = Date.now(),
): void {
  const parsed = Date.parse(expiresAtIso);
  const entry: SavedOperator = {
    name: cleanName(operator.name), at: now, id: operator.id, handlerToken,
    // Sem data válida, o turno de 10 h continua valendo como limite.
    tokenExpiresAt: Number.isNaN(parsed) ? now + SHIFT_MS : Math.min(parsed, now + SHIFT_MS),
  };
  write('operator', entry);
}

/** Esquece o operador só se ele tem handlerToken (o token é da sessão que o gerou); nome digitado pode ficar. */
export function clearVerifiedOperator(): void {
  if (read<SavedOperator | null>('operator', null)?.handlerToken) clearOperator();
}

/** Esquece o operador do turno (ex.: o servidor recusou o token). */
export function clearOperator(): void {
  try {
    localStorage.removeItem(NS + 'operator');
  } catch {
    /* sem armazenamento: nada a limpar */
  }
}

export function getRecentOperators(): string[] {
  return read<string[]>('operators', []);
}

export function rememberOperator(name: string, now = Date.now()): void {
  const clean = cleanName(name);
  if (!clean) return;
  write('operator', { name: clean, at: now }); // nome digitado: sem PIN, sem token
  const recents = getRecentOperators().filter((n) => n.toLowerCase() !== clean.toLowerCase());
  write('operators', [clean, ...recents].slice(0, MAX_RECENT_OPERATORS));
}

// ── Lote / armazenamento por produto ─────────────────────
/** Registrado quando a embalagem não mostra o lote, para não inventar um código. */
export const UNREADABLE_LOT = 'NÃO INFORMADO';

export function getLastStorage(productId: string): StorageType | null {
  return read<Record<string, StorageType>>('storage', {})[productId] ?? null;
}

export function rememberChoices(productId: string, storage: StorageType): void {
  write('storage', { ...read<Record<string, StorageType>>('storage', {}), [productId]: storage });
  write('usage', { ...read<Record<string, number>>('usage', {}), [productId]: Date.now() });
}

/** productId → timestamp da última etiqueta feita neste totem */
export function getUsage(): Record<string, number> {
  return read<Record<string, number>>('usage', {});
}

// ── Formatação ───────────────────────────────────────────
export function normalizeText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

export function weekdayShort(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { weekday: 'short' })
    .format(parseDate(iso))
    .replace('.', '');
}

/** "2512", "25122026" → "25/12", "25/12/2026" (dígitos digitados no teclado de data) */
export function formatDateDraft(digits: string): string {
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)].filter(Boolean).join('/');
}

/** "25122026" ou "251226" → "2026-12-25". Retorna null se a data não existir. */
export function parseDateDraft(digits: string): string | null {
  const match = /^(\d{2})(\d{2})(\d{2}|\d{4})$/.exec(digits);
  if (!match) return null;
  const [, day, month, yearText] = match;
  const year = Number(yearText.length === 2 ? `20${yearText}` : yearText);
  const date = new Date(Date.UTC(year, Number(month) - 1, Number(day)));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

/** "2026-12-25" → "25122026" (valor inicial do teclado de data) */
export function dateDraft(iso: string): string {
  return iso.split('-').reverse().join('');
}
