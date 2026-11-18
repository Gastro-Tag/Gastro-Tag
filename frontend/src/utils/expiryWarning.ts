import type { ExpiryWarning } from '@/types';
import { formatBR } from '@/utils/date';

export const EXPIRY_MONTHS_MIN = 1;
export const EXPIRY_MONTHS_MAX = 60;

function dias(n: number): string {
  return `${n} ${n === 1 ? 'dia' : 'dias'}`;
}

/** Texto do aviso de validade digitada muito distante. `typedDate` é a validade digitada (YYYY-MM-DD). */
export function expiryWarningText(warning: ExpiryWarning, typedDate: string): string {
  const typed = `A validade digitada (${formatBR(typedDate)}) dá ${dias(warning.typedDays)}`;
  if (warning.reason === 'ABOVE_LIMIT' && warning.limitMonths != null) {
    const meses = warning.limitMonths === 1 ? '1 mês' : `${warning.limitMonths} meses`;
    return `${typed} e passa do limite de ${meses} definido pela cozinha. Confira a data na embalagem.`;
  }
  return `${typed}; o normal para este produto é cerca de ${dias(warning.referenceDays)}. Confira a data na embalagem.`;
}

/** `key` identifica o que foi conferido (ex.: produto|data); se mudar, a confirmação volta a ser exigida. */
export function needsExpiryConfirmation(warning: ExpiryWarning | null | undefined, typedDate: string, confirmedDate: string): boolean {
  return Boolean(warning) && confirmedDate !== typedDate;
}

/** Campo vazio = desligado (null). Senão, inteiro de 1 a 60. */
export function parseExpiryMonths(text: string): { value: number | null; error: string } {
  const trimmed = text.trim();
  if (trimmed === '') return { value: null, error: '' };
  if (!/^\d+$/.test(trimmed)) return { value: null, error: `Informe um número inteiro de ${EXPIRY_MONTHS_MIN} a ${EXPIRY_MONTHS_MAX}.` };
  const n = Number(trimmed);
  if (n < EXPIRY_MONTHS_MIN || n > EXPIRY_MONTHS_MAX) {
    return { value: null, error: `Informe um número inteiro de ${EXPIRY_MONTHS_MIN} a ${EXPIRY_MONTHS_MAX}.` };
  }
  return { value: n, error: '' };
}

export function toastAvisoValidade(months: number | null): string {
  return months === null
    ? 'Aviso de validade distante desligado.'
    : `Aviso ligado: validade digitada acima de ${months === 1 ? '1 mês' : `${months} meses`}.`;
}
