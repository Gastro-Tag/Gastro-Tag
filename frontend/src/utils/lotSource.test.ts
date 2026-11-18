import { describe, expect, it } from 'vitest';
import { isOtherPackage, lotSourceText, parseLotSource } from './lotSource';

describe('parseLotSource', () => {
  it('aceita só os valores do servidor', () => {
    expect(parseLotSource('cadastrado')).toBe('cadastrado');
    expect(parseLotSource('informado')).toBe('informado');
    expect(parseLotSource('anterior')).toBe('anterior');
    expect(parseLotSource('outro')).toBe('');
    expect(parseLotSource(null)).toBe('');
  });
});

describe('lotSourceText', () => {
  it('descreve o filtro', () => {
    expect(lotSourceText('')).toBe('');
    expect(lotSourceText('cadastrado')).toBe('lote cadastrado');
    expect(lotSourceText('informado')).toBe('outra embalagem');
    expect(lotSourceText('anterior')).toBe('anterior aos lotes');
  });
});

describe('isOtherPackage', () => {
  it('só lotSource informado conta como outra embalagem', () => {
    expect(isOtherPackage({ lotSource: 'informado' })).toBe(true);
    expect(isOtherPackage({ lotSource: 'cadastrado' })).toBe(false);
    expect(isOtherPackage({ lotSource: 'anterior' })).toBe(false);
    expect(isOtherPackage({})).toBe(false);
  });
});
