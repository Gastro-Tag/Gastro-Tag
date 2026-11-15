import { Errors } from '../utils/errors';
import { addDays } from '../utils/dateUtils';

export interface CalculateDiscardInput {
  openedAt: string | Date;
  shelfLifeDays: number;
  originalExpiryDate?: string | Date | null;
  capToOriginalExpiry: boolean;
  /** Data atual da cozinha. Quando informada, recusa abertura futura e etiqueta já vencida. */
  today?: string | Date | null;
}

export interface CalculateDiscardResult {
  discardAt: Date;
  shelfLifeDays: number;
  cappedByOriginalExpiry: boolean;
}

export function parseDateOnly(value: string | Date, fieldName = 'Data'): Date {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw Errors.validation(`${fieldName} inválida.`);
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw Errors.validation(`${fieldName} deve usar o formato YYYY-MM-DD.`);

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw Errors.validation(`${fieldName} não existe no calendário.`);
  }
  return parsed;
}

export function calculateDiscard(input: CalculateDiscardInput): CalculateDiscardResult {
  if (!Number.isInteger(input.shelfLifeDays) || input.shelfLifeDays <= 0) {
    throw Errors.validation('O prazo de validade deve ser um número inteiro positivo de dias.');
  }

  const openedAt = parseDateOnly(input.openedAt, 'Data de abertura');
  const originalExpiryDate = input.originalExpiryDate == null
    ? null
    : parseDateOnly(input.originalExpiryDate, 'Validade original');
  const today = input.today == null ? null : parseDateOnly(input.today, 'Data atual');

  if (today && openedAt.getTime() > today.getTime()) {
    throw Errors.validation('A data de abertura não pode ser futura.');
  }

  // Vale mesmo com o teto desligado: embalagem vencida não gera etiqueta nova.
  if (today && originalExpiryDate && originalExpiryDate.getTime() < today.getTime()) {
    throw Errors.validation('Esta embalagem está vencida. Não use: descarte o produto.');
  }

  if (originalExpiryDate && openedAt.getTime() > originalExpiryDate.getTime()) {
    throw Errors.validation('A data de abertura não pode ser posterior à validade original.');
  }

  // O dia da abertura conta como dia 1: 3 dias a partir de 01/09 vão até 03/09.
  const calculatedDiscardAt = addDays(openedAt, input.shelfLifeDays - 1);
  const cappedByOriginalExpiry = Boolean(
    input.capToOriginalExpiry &&
    originalExpiryDate &&
    calculatedDiscardAt.getTime() > originalExpiryDate.getTime()
  );
  const discardAt = cappedByOriginalExpiry ? originalExpiryDate! : calculatedDiscardAt;

  if (today && discardAt.getTime() < today.getTime()) {
    throw Errors.validation('Esta etiqueta já nasceria vencida. Confira a data de abertura ou descarte o produto.');
  }

  return {
    discardAt,
    shelfLifeDays: input.shelfLifeDays,
    cappedByOriginalExpiry,
  };
}

export interface CalculateSplitDiscardInput {
  /** Data de descarte da etiqueta de origem. */
  parentDiscardAt: string | Date;
  /** Prazo da filha, pelo armazenamento escolhido para ela. */
  shelfLifeDays: number;
  originalExpiryDate?: string | Date | null;
  capToOriginalExpiry: boolean;
  /** Data atual da cozinha: é o dia do fracionamento. */
  today: string | Date;
}

export interface CalculateSplitDiscardResult {
  discardAt: Date;
  fractionedAt: Date;
  shelfLifeDays: number;
  /** A data da filha ficou limitada pela data da origem. */
  cappedByParent: boolean;
  cappedByOriginalExpiry: boolean;
}

/**
 * Dividir: a filha conta o prazo a partir do dia do fracionamento, mas nunca passa da data de
 * descarte da origem (o produto é o mesmo, já aberto).
 */
export function calculateSplitDiscard(input: CalculateSplitDiscardInput): CalculateSplitDiscardResult {
  const today = parseDateOnly(input.today, 'Data atual');
  const parentDiscardAt = parseDateOnly(input.parentDiscardAt, 'Descarte da origem');
  if (parentDiscardAt.getTime() < today.getTime()) {
    throw Errors.validation('A etiqueta de origem está vencida. Descarte o produto.');
  }

  const own = calculateDiscard({
    openedAt: today,
    shelfLifeDays: input.shelfLifeDays,
    originalExpiryDate: input.originalExpiryDate,
    capToOriginalExpiry: input.capToOriginalExpiry,
    today,
  });
  const cappedByParent = own.discardAt.getTime() > parentDiscardAt.getTime();
  return {
    discardAt: cappedByParent ? parentDiscardAt : own.discardAt,
    fractionedAt: today,
    shelfLifeDays: input.shelfLifeDays,
    cappedByParent,
    cappedByOriginalExpiry: !cappedByParent && own.cappedByOriginalExpiry,
  };
}
