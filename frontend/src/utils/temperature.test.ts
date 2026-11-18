import { describe, expect, it } from 'vitest';
import {
  SUGGESTED_TEMPERATURE, formatTemperature, formatTemperatureRange, formatTemperatureShort,
  parseTemperature, resolveTemperatureSource, temperatureDraft,
} from './temperature';

describe('parseTemperature', () => {
  it.each([
    ['4', 4], ['-18', -18], ['−18', -18], ['4,5', 4.5], ['4.5', 4.5],
    ['4 °C', 4], ['-18°c', -18], [' +3 ', 3], ['0', 0],
  ])('aceita %j', (input, expected) => {
    expect(parseTemperature(input)).toBe(expected);
  });
  it('arredonda para uma casa, metade para longe do zero', () => {
    expect(parseTemperature('-4,25')).toBe(-4.3);
    expect(parseTemperature('4,25')).toBe(4.3);
    expect(parseTemperature('4,24')).toBe(4.2);
  });
  it('nunca devolve -0', () => {
    expect(Object.is(parseTemperature('-0'), 0)).toBe(true);
    expect(Object.is(parseTemperature('-0,04'), 0)).toBe(true);
  });
  it('respeita a faixa -50..30', () => {
    expect(parseTemperature('-50')).toBe(-50);
    expect(parseTemperature('30')).toBe(30);
    expect(parseTemperature('-50,1')).toBeNull();
    expect(parseTemperature('30,1')).toBeNull();
  });
  it.each(['', 'abc', '4,5,6', '--4', '4 graus'])('rejeita %j', (input) => {
    expect(parseTemperature(input)).toBeNull();
  });
});

describe('formatação', () => {
  it('formatTemperature usa uma casa e vírgula', () => {
    expect(formatTemperature(4)).toBe('4,0 °C');
    expect(formatTemperature(-18)).toBe('-18,0 °C');
  });
  it('formatTemperatureShort usa sinal de menos tipográfico', () => {
    expect(formatTemperatureShort(4)).toBe('4 °C');
    expect(formatTemperatureShort(-18)).toBe('−18 °C');
    expect(formatTemperatureShort(4.5)).toBe('4,5 °C');
  });
  it('temperatureDraft', () => {
    expect(temperatureDraft(4.5)).toBe('4,5');
    expect(temperatureDraft(-18)).toBe('-18');
  });
  it('formatTemperatureRange', () => {
    expect(formatTemperatureRange(0, 5)).toBe('0 °C a 5 °C');
    expect(formatTemperatureRange(2, null)).toBe('mínimo 2 °C');
    expect(formatTemperatureRange(null, 5)).toBe('máximo 5 °C');
    expect(formatTemperatureRange(null, undefined)).toBeNull();
  });
  it('sugestões são as esperadas', () => {
    expect(SUGGESTED_TEMPERATURE).toEqual({ REFRIGERADO: 4, CONGELADO: -18 });
  });
});

describe('resolveTemperatureSource', () => {
  it('SUGERIDO só quando sem edição e igual à sugestão', () => {
    expect(resolveTemperatureSource({ value: 4, suggested: 4, edited: false })).toBe('SUGERIDO');
    expect(resolveTemperatureSource({ value: 5, suggested: 4, edited: false })).toBe('DIGITADO');
  });
  it('qualquer edição vira DIGITADO, mesmo voltando ao valor sugerido', () => {
    expect(resolveTemperatureSource({ value: 4, suggested: 4, edited: true })).toBe('DIGITADO');
  });
  it('reabrir sem editar mantém a origem anterior', () => {
    expect(resolveTemperatureSource({ value: 4, suggested: 4, edited: false, previous: 'DIGITADO' })).toBe('DIGITADO');
  });
});
