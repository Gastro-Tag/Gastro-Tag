import { describe, expect, it } from 'vitest';
import { AppError } from '../src/utils/errors';
import { calculateDiscard, parseDateOnly } from '../src/domain/shelfLife';

describe('calculateDiscard', () => {
  it('soma o prazo à data de abertura', () => {
    const result = calculateDiscard({ openedAt: '2026-09-01', shelfLifeDays: 3, capToOriginalExpiry: false });
    expect(result.discardAt.toISOString().slice(0, 10)).toBe('2026-09-04');
    expect(result.cappedByOriginalExpiry).toBe(false);
  });

  it('mantém a data calculada quando ela coincide com a validade original', () => {
    const result = calculateDiscard({ openedAt: '2026-09-01', shelfLifeDays: 3, originalExpiryDate: '2026-09-04', capToOriginalExpiry: true });
    expect(result.discardAt.toISOString().slice(0, 10)).toBe('2026-09-04');
    expect(result.cappedByOriginalExpiry).toBe(false);
  });

  it('trunca o descarte pela validade original quando a política está ativa', () => {
    const result = calculateDiscard({ openedAt: '2026-09-01', shelfLifeDays: 7, originalExpiryDate: '2026-09-05', capToOriginalExpiry: true });
    expect(result.discardAt.toISOString().slice(0, 10)).toBe('2026-09-05');
    expect(result.cappedByOriginalExpiry).toBe(true);
  });

  it('não trunca se a política está desativada', () => {
    const result = calculateDiscard({ openedAt: '2026-09-01', shelfLifeDays: 7, originalExpiryDate: '2026-09-05', capToOriginalExpiry: false });
    expect(result.discardAt.toISOString().slice(0, 10)).toBe('2026-09-08');
    expect(result.cappedByOriginalExpiry).toBe(false);
  });

  it('rejeita abertura depois da validade original', () => {
    expect(() => calculateDiscard({ openedAt: '2026-09-06', shelfLifeDays: 1, originalExpiryDate: '2026-09-05', capToOriginalExpiry: true }))
      .toThrowError(AppError);
  });

  it.each([0, -1, 1.5])('rejeita prazo inválido: %s', (shelfLifeDays) => {
    expect(() => calculateDiscard({ openedAt: '2026-09-01', shelfLifeDays, capToOriginalExpiry: true }))
      .toThrowError(AppError);
  });

  it('rejeita datas impossíveis', () => {
    expect(() => parseDateOnly('2026-02-31', 'Abertura')).toThrowError(AppError);
  });
});