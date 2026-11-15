import { describe, expect, it } from 'vitest';
import { AppError } from '../src/utils/errors';
import { calculateDiscard, calculateSplitDiscard, parseDateOnly } from '../src/domain/shelfLife';

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

  it.each([true, false])('recusa embalagem vencida com o teto %s', (capToOriginalExpiry) => {
    expect(() => calculateDiscard({ openedAt: '2026-08-25', shelfLifeDays: 30, originalExpiryDate: '2026-08-30', capToOriginalExpiry, today: '2026-09-02' }))
      .toThrowError('vencida');
  });

  it.each([0, -1, 1.5])('rejeita prazo inválido: %s', (shelfLifeDays) => {
    expect(() => calculateDiscard({ openedAt: '2026-09-01', shelfLifeDays, capToOriginalExpiry: true }))
      .toThrowError(AppError);
  });

  it('rejeita datas impossíveis', () => {
    expect(() => parseDateOnly('2026-02-31', 'Abertura')).toThrowError(AppError);
  });
});

describe('calculateSplitDiscard', () => {
  const iso = (date: Date) => date.toISOString().slice(0, 10);
  const base = { today: '2026-09-10', capToOriginalExpiry: true, originalExpiryDate: '2026-12-31' };

  it('conta o prazo da filha a partir do dia do fracionamento quando cabe na origem', () => {
    const result = calculateSplitDiscard({ ...base, parentDiscardAt: '2026-09-20', shelfLifeDays: 3 });
    expect(iso(result.discardAt)).toBe('2026-09-12');
    expect(iso(result.fractionedAt)).toBe('2026-09-10');
    expect(result.cappedByParent).toBe(false);
    expect(result.cappedByOriginalExpiry).toBe(false);
  });

  it('nunca passa da data da origem', () => {
    const result = calculateSplitDiscard({ ...base, parentDiscardAt: '2026-09-11', shelfLifeDays: 30 });
    expect(iso(result.discardAt)).toBe('2026-09-11');
    expect(result.cappedByParent).toBe(true);
    expect(result.cappedByOriginalExpiry).toBe(false);
  });

  it('com a mesma data da origem não marca limitação pela origem', () => {
    const result = calculateSplitDiscard({ ...base, parentDiscardAt: '2026-09-12', shelfLifeDays: 3 });
    expect(iso(result.discardAt)).toBe('2026-09-12');
    expect(result.cappedByParent).toBe(false);
  });

  it('respeita a validade original quando ela é a menor data', () => {
    const result = calculateSplitDiscard({
      ...base, originalExpiryDate: '2026-09-11', parentDiscardAt: '2026-09-11', shelfLifeDays: 5,
    });
    expect(iso(result.discardAt)).toBe('2026-09-11');
    expect(result.cappedByParent).toBe(false);
    expect(result.cappedByOriginalExpiry).toBe(true);
  });

  it('origem que vence hoje ainda pode ser dividida, com descarte hoje', () => {
    const result = calculateSplitDiscard({ ...base, parentDiscardAt: '2026-09-10', shelfLifeDays: 4 });
    expect(iso(result.discardAt)).toBe('2026-09-10');
    expect(result.cappedByParent).toBe(true);
  });

  it('recusa origem vencida e prazo inválido', () => {
    expect(() => calculateSplitDiscard({ ...base, parentDiscardAt: '2026-09-09', shelfLifeDays: 3 }))
      .toThrowError(/origem está vencida/);
    expect(() => calculateSplitDiscard({ ...base, parentDiscardAt: '2026-09-20', shelfLifeDays: 0 }))
      .toThrowError(AppError);
  });

  it('para qualquer prazo, a filha nunca vence depois da origem', () => {
    for (let days = 1; days <= 60; days++) {
      for (const parent of ['2026-09-10', '2026-09-15', '2026-10-30']) {
        const result = calculateSplitDiscard({ ...base, parentDiscardAt: parent, shelfLifeDays: days });
        expect(result.discardAt.getTime()).toBeLessThanOrEqual(new Date(`${parent}T00:00:00Z`).getTime());
      }
    }
  });
});
