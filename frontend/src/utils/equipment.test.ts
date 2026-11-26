import { describe, expect, it } from 'vitest';
import {
  countMissingToday, equipmentRangeText, missingToday, outOfRangeMessage, parseReading, validateEquipmentForm,
} from './equipment';

describe('texto de faixa', () => {
  it('formata a faixa com sinal e vírgula', () => {
    expect(equipmentRangeText(2, 5)).toBe('2 °C a 5 °C');
    expect(equipmentRangeText(-25, -18)).toBe('−25 °C a −18 °C');
    expect(equipmentRangeText(0.5, 4.5)).toBe('0,5 °C a 4,5 °C');
  });
  it('monta o aviso de fora da faixa', () => {
    expect(outOfRangeMessage(2, 5)).toBe('Fora da faixa (2 a 5 °C): avise o responsável');
    expect(outOfRangeMessage(-25, -18)).toBe('Fora da faixa (−25 a −18 °C): avise o responsável');
  });
});

describe('sem leitura hoje', () => {
  it('só conta quem tem zero leituras no dia', () => {
    expect(missingToday({ readingsToday: 0 })).toBe(true);
    expect(missingToday({ readingsToday: 1 })).toBe(false);
    expect(countMissingToday([{ readingsToday: 0 }, { readingsToday: 3 }, { readingsToday: 0 }])).toBe(2);
    expect(countMissingToday([])).toBe(0);
  });
});

describe('parseReading', () => {
  it('aceita negativo, vírgula e uma casa', () => {
    expect(parseReading('4')).toBe(4);
    expect(parseReading('-18,5')).toBe(-18.5);
    expect(parseReading('−18')).toBe(-18);
    expect(parseReading('4.5')).toBe(4.5);
  });
  it('recusa vazio, texto, fora de -50..30 e mais de uma casa', () => {
    expect(parseReading('')).toBeNull();
    expect(parseReading('-')).toBeNull();
    expect(parseReading('abc')).toBeNull();
    expect(parseReading('31')).toBeNull();
    expect(parseReading('-51')).toBeNull();
    expect(parseReading('4,25')).toBeNull();
  });
});

describe('validateEquipmentForm', () => {
  const base = { name: ' Geladeira  1 ', storageType: 'REFRIGERADO' as const, min: '2', max: '5' };
  it('normaliza e converte', () => {
    expect(validateEquipmentForm(base)).toEqual({
      ok: true, value: { name: 'Geladeira 1', storageType: 'REFRIGERADO', minTemperature: 2, maxTemperature: 5 },
    });
  });
  it('exige nome e faixa preenchida (sem padrão)', () => {
    expect(validateEquipmentForm({ ...base, name: ' ' }).ok).toBe(false);
    expect(validateEquipmentForm({ ...base, min: '' }).ok).toBe(false);
    expect(validateEquipmentForm({ ...base, max: '' }).ok).toBe(false);
  });
  it('recusa mínima maior que a máxima', () => {
    expect(validateEquipmentForm({ ...base, min: '6', max: '5' }).ok).toBe(false);
    expect(validateEquipmentForm({ ...base, min: '5', max: '5' }).ok).toBe(true);
  });
});
