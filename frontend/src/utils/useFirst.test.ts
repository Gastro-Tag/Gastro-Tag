import { describe, expect, it } from 'vitest';
import { expiresInText, firstToUseLotIds } from './useFirst';

const lot = (id: string, expiryDate: string, daysUntilExpiry = 5) => ({ id, expiryDate, daysUntilExpiry });

describe('firstToUseLotIds', () => {
  it('um lote só não ganha selo', () => {
    expect(firstToUseLotIds([lot('a', '2026-12-01')]).size).toBe(0);
  });
  it('marca o de menor validade', () => {
    expect([...firstToUseLotIds([lot('a', '2026-12-05'), lot('b', '2026-12-01'), lot('c', '2026-12-09')])]).toEqual(['b']);
  });
  it('empate na menor validade marca todos os empatados', () => {
    const ids = firstToUseLotIds([lot('a', '2026-12-01'), lot('b', '2026-12-01'), lot('c', '2026-12-09')]);
    expect([...ids].sort()).toEqual(['a', 'b']);
  });
  it('todos com a mesma validade: sem selo', () => {
    expect(firstToUseLotIds([lot('a', '2026-12-01'), lot('b', '2026-12-01')]).size).toBe(0);
  });
});

describe('expiresInText', () => {
  it('hoje, amanhã e N dias', () => {
    expect(expiresInText(0)).toBe('vence hoje');
    expect(expiresInText(1)).toBe('vence amanhã');
    expect(expiresInText(12)).toBe('vence em 12 dias');
  });
});
