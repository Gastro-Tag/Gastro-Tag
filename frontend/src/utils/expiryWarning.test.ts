import { describe, expect, it } from 'vitest';
import { expiryWarningText, needsExpiryConfirmation, parseExpiryMonths, toastAvisoValidade } from './expiryWarning';

describe('expiryWarningText', () => {
  it('ABOVE_HISTORY cita a data, os dias e a referência', () => {
    const text = expiryWarningText({ reason: 'ABOVE_HISTORY', typedDays: 366, referenceDays: 45, limitMonths: null }, '2027-11-18');
    expect(text).toBe('A validade digitada (18/11/2027) dá 366 dias; o normal para este produto é cerca de 45 dias. Confira a data na embalagem.');
  });
  it('ABOVE_LIMIT cita o limite em meses', () => {
    const text = expiryWarningText({ reason: 'ABOVE_LIMIT', typedDays: 400, referenceDays: 0, limitMonths: 12 }, '2027-11-18');
    expect(text).toContain('passa do limite de 12 meses definido pela cozinha');
  });
  it('singular', () => {
    expect(expiryWarningText({ reason: 'ABOVE_LIMIT', typedDays: 1, referenceDays: 0, limitMonths: 1 }, '2026-11-18')).toContain('dá 1 dia e passa do limite de 1 mês');
  });
});

describe('needsExpiryConfirmation', () => {
  const w = { reason: 'ABOVE_HISTORY' as const, typedDays: 366, referenceDays: 45, limitMonths: null };
  it('sem aviso nunca exige', () => expect(needsExpiryConfirmation(null, '2027-11-18', '')).toBe(false));
  it('exige até confirmar a mesma data', () => {
    expect(needsExpiryConfirmation(w, '2027-11-18', '')).toBe(true);
    expect(needsExpiryConfirmation(w, '2027-11-18', '2027-11-18')).toBe(false);
  });
  it('data diferente zera a confirmação', () => expect(needsExpiryConfirmation(w, '2027-11-19', '2027-11-18')).toBe(true));
});

describe('parseExpiryMonths', () => {
  it('vazio desliga', () => expect(parseExpiryMonths('  ')).toEqual({ value: null, error: '' }));
  it('aceita 1 a 60', () => {
    expect(parseExpiryMonths('1').value).toBe(1);
    expect(parseExpiryMonths('60').value).toBe(60);
  });
  it('recusa fora da faixa e não inteiros', () => {
    for (const t of ['0', '61', '1.5', '-3', 'abc', '1e2']) expect(parseExpiryMonths(t).error).not.toBe('');
  });
});

describe('toastAvisoValidade', () => {
  it('textos', () => {
    expect(toastAvisoValidade(null)).toContain('desligado');
    expect(toastAvisoValidade(12)).toContain('12 meses');
  });
});
