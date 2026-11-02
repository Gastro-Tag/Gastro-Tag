import { describe, expect, it } from 'vitest';
import { AppError } from '../src/utils/errors';
import { calculateDiscard, parseDateOnly } from '../src/domain/shelfLife';

describe('calculateDiscard', () => {
  it('conta o dia da abertura como dia 1', () => {
    const result = calculateDiscard({ openedAt: '2026-09-01', shelfLifeDays: 3, capToOriginalExpiry: false });
    expect(result.discardAt.toISOString().slice(0, 10)).toBe('2026-09-03');
    expect(result.cappedByOriginalExpiry).toBe(false);
  });

  it('com prazo de 1 dia, o descarte é no próprio dia da abertura', () => {
    const result = calculateDiscard({ openedAt: '2026-09-01', shelfLifeDays: 1, capToOriginalExpiry: false });
    expect(result.discardAt.toISOString().slice(0, 10)).toBe('2026-09-01');
  });

  it('mantém a data calculada quando ela coincide com a validade original', () => {
    const result = calculateDiscard({ openedAt: '2026-09-01', shelfLifeDays: 3, originalExpiryDate: '2026-09-03', capToOriginalExpiry: true });
    expect(result.discardAt.toISOString().slice(0, 10)).toBe('2026-09-03');
    expect(result.cappedByOriginalExpiry).toBe(false);
  });

  it('trunca o descarte pela validade original quando a política está ativa', () => {
    const result = calculateDiscard({ openedAt: '2026-09-01', shelfLifeDays: 7, originalExpiryDate: '2026-09-05', capToOriginalExpiry: true });
    expect(result.discardAt.toISOString().slice(0, 10)).toBe('2026-09-05');
    expect(result.cappedByOriginalExpiry).toBe(true);
  });

  it('não trunca se a política está desativada', () => {
    const result = calculateDiscard({ openedAt: '2026-09-01', shelfLifeDays: 7, originalExpiryDate: '2026-09-05', capToOriginalExpiry: false });
    expect(result.discardAt.toISOString().slice(0, 10)).toBe('2026-09-07');
    expect(result.cappedByOriginalExpiry).toBe(false);
  });

  it('rejeita abertura futura em relação à data da cozinha', () => {
    expect(() => calculateDiscard({ openedAt: '2026-09-02', shelfLifeDays: 3, capToOriginalExpiry: true, today: '2026-09-01' }))
      .toThrowError('futura');
  });

  it('aceita etiqueta que vence no dia atual', () => {
    const result = calculateDiscard({ openedAt: '2026-09-01', shelfLifeDays: 3, capToOriginalExpiry: true, today: '2026-09-03' });
    expect(result.discardAt.toISOString().slice(0, 10)).toBe('2026-09-03');
  });

  it('rejeita etiqueta que já nasceria vencida', () => {
    expect(() => calculateDiscard({ openedAt: '2026-09-01', shelfLifeDays: 3, capToOriginalExpiry: true, today: '2026-09-04' }))
      .toThrowError('vencida');
  });

  it('rejeita etiqueta vencida também quando o teto da validade original é o limite', () => {
    expect(() => calculateDiscard({ openedAt: '2026-09-01', shelfLifeDays: 30, originalExpiryDate: '2026-09-02', capToOriginalExpiry: true, today: '2026-09-03' }))
      .toThrowError('vencida');
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