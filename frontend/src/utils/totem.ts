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

export function getOperator(now = Date.now()): string {
  const saved = read<{ name: string; at: number } | null>('operator', null);
  if (!saved || !saved.name) return '';
  return now - saved.at > SHIFT_MS ? '' : saved.name;
}

export function getRecentOperators(): string[] {
  return read<string[]>('operators', []);
}

export function rememberOperator(name: string, now = Date.now()): void {
  const clean = cleanName(name);
  if (!clean) return;
  write('operator', { name: clean, at: now });
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
