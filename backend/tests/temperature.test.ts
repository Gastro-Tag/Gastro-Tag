import { describe, expect, it } from 'vitest';
import { formatTemperature, roundTemperature } from '../src/domain/temperature';

describe('roundTemperature', () => {
  it('arredonda para uma casa decimal, metade para longe do zero', () => {
    expect(roundTemperature(4)).toBe(4);
    expect(roundTemperature(4.25)).toBe(4.3);
    expect(roundTemperature(4.24)).toBe(4.2);
    expect(roundTemperature(-4.25)).toBe(-4.3);
    expect(roundTemperature(-18)).toBe(-18);
    expect(roundTemperature(1.45)).toBe(1.5);
  });

  it('não devolve zero negativo', () => {
    expect(Object.is(roundTemperature(-0.04), 0)).toBe(true);
    expect(Object.is(roundTemperature(-0), 0)).toBe(true);
  });

  it('recusa valores não finitos', () => {
    expect(() => roundTemperature(Number.NaN)).toThrow(RangeError);
    expect(() => roundTemperature(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('formatTemperature', () => {
  it('usa uma casa decimal, vírgula e " °C"', () => {
    expect(formatTemperature(4)).toBe('4,0 °C');
    expect(formatTemperature(-18)).toBe('-18,0 °C');
    expect(formatTemperature(3.96)).toBe('4,0 °C');
    expect(formatTemperature(-0.01)).toBe('0,0 °C');
    expect(formatTemperature(7.5)).toBe('7,5 °C');
  });
});
