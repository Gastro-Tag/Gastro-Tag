import { Errors } from '../utils/errors';
import { addDays } from '../utils/dateUtils';

export interface CalculateDiscardInput {
  openedAt: string | Date;
  shelfLifeDays: number;
  originalExpiryDate?: string | Date | null;
  capToOriginalExpiry: boolean;
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

  if (originalExpiryDate && openedAt.getTime() > originalExpiryDate.getTime()) {
    throw Errors.validation('A data de abertura não pode ser posterior à validade original.');
  }

  const calculatedDiscardAt = addDays(openedAt, input.shelfLifeDays);
  const cappedByOriginalExpiry = Boolean(
    input.capToOriginalExpiry &&
    originalExpiryDate &&
    calculatedDiscardAt.getTime() > originalExpiryDate.getTime()
  );

  return {
    discardAt: cappedByOriginalExpiry ? originalExpiryDate! : calculatedDiscardAt,
    shelfLifeDays: input.shelfLifeDays,
    cappedByOriginalExpiry,
  };
}