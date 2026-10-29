import type { StorageType } from '@/types';
import { parseDate, todayISO } from './date';

/**
 * Preferências do totem, guardadas só neste aparelho (localStorage).
 * Servem apenas para reduzir toques; a regra sanitária e o cálculo continuam no backend.
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

export const DEFAULT_TEMP: Record<StorageType, string> = {
  REFRIGERADO: '4 °C',
  CONGELADO: '-18 °C',
};

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
export function defaultLot(): string {
  return `L${todayISO().replace(/-/g, '')}`;
}

export function getLastLot(productId: string): string | null {
  return read<Record<string, string>>('lots', {})[productId] ?? null;
}

export function getLastStorage(productId: string): StorageType | null {
  return read<Record<string, StorageType>>('storage', {})[productId] ?? null;
}

export function rememberChoices(productId: string, lot: string, storage: StorageType): void {
  write('lots', { ...read<Record<string, string>>('lots', {}), [productId]: lot });
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

/** "4", "-18", "4,5" → "4 °C", "-18 °C", "4,5 °C". Retorna null se não for número. */
export function formatTemperature(raw: string): string | null {
  const text = raw.replace(/[^\d,.-]/g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  const value = Number(text);
  if (!Number.isFinite(value) || value < -60 || value > 100) return null;
  return `${String(value).replace('.', ',')} °C`;
}

/** "4 °C" → "4" (valor inicial do teclado numérico) */
export function temperatureDraft(formatted: string): string {
  return formatted.replace(/[^\d,.-]/g, '');
}
