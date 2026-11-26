import { beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_OUTAGE_MS, OFFLINE_KEY, PENDING_KEY, PENDING_TTL_MS, clearPending, isMarkedOffline, loadPending, markOffline,
  outageDurationText, outageNoticeText, savePending, takeOutage,
} from './outage';

const MIN = 60_000;
beforeEach(() => localStorage.clear());

describe('markOffline', () => {
  it('grava o primeiro instante e não sobrescreve', () => {
    markOffline(1_000);
    markOffline(9_000);
    expect(localStorage.getItem(OFFLINE_KEY)).toBe('1000');
    expect(isMarkedOffline()).toBe(true);
  });
});

describe('takeOutage', () => {
  it('devolve a duração acima do mínimo e limpa', () => {
    markOffline(1_000);
    expect(takeOutage(1_000 + 6 * MIN)).toBe(6 * MIN);
    expect(localStorage.getItem(OFFLINE_KEY)).toBeNull();
  });
  it('devolve null abaixo do mínimo e também limpa', () => {
    markOffline(1_000);
    expect(takeOutage(1_000 + 4 * MIN)).toBeNull();
    expect(localStorage.getItem(OFFLINE_KEY)).toBeNull();
  });
  it('aceita exatamente o mínimo', () => {
    markOffline(1_000);
    expect(takeOutage(1_000 + 5 * MIN)).toBe(5 * MIN);
  });
  it('null sem marca', () => {
    expect(takeOutage(Date.now())).toBeNull();
  });
  it('ignora relógio que voltou para trás', () => {
    markOffline(50_000);
    expect(takeOutage(10_000)).toBeNull();
    expect(localStorage.getItem(OFFLINE_KEY)).toBeNull();
  });
  it('ignora valor ilegível', () => {
    localStorage.setItem(OFFLINE_KEY, 'abc');
    expect(takeOutage(Date.now())).toBeNull();
    expect(localStorage.getItem(OFFLINE_KEY)).toBeNull();
  });
  it('limita em 7 dias', () => {
    markOffline(1_000);
    expect(takeOutage(1_000 + 30 * 24 * 60 * MIN)).toBe(MAX_OUTAGE_MS);
  });
  it('respeita um mínimo informado', () => {
    markOffline(1_000);
    expect(takeOutage(1_000 + 2 * MIN, MIN)).toBe(2 * MIN);
  });
});

describe('pendente de reenvio', () => {
  it('guarda e lê', () => {
    savePending(8 * MIN, 1_000);
    expect(loadPending(2_000)).toBe(8 * MIN);
  });
  it('vence em 24 h e é apagada', () => {
    savePending(8 * MIN, 1_000);
    expect(loadPending(1_000 + PENDING_TTL_MS + 1)).toBeNull();
    expect(localStorage.getItem(PENDING_KEY)).toBeNull();
  });
  it('lixo no storage vira null e é apagado', () => {
    localStorage.setItem(PENDING_KEY, '{"durationMs":"x"}');
    expect(loadPending(Date.now())).toBeNull();
    expect(localStorage.getItem(PENDING_KEY)).toBeNull();
  });
  it('clearPending apaga', () => {
    savePending(8 * MIN, 1_000);
    clearPending();
    expect(loadPending(2_000)).toBeNull();
  });
});

describe('textos', () => {
  it('minutos, horas e dias', () => {
    expect(outageDurationText(12 * MIN)).toBe('cerca de 12 min');
    expect(outageDurationText(125 * MIN)).toBe('cerca de 2 h 5 min');
    expect(outageDurationText(120 * MIN)).toBe('cerca de 2 h');
    expect(outageDurationText(2 * 24 * 60 * MIN)).toBe('cerca de 2 dias');
  });
  it('aviso do totem usa a frase pedida', () => {
    expect(outageNoticeText(12 * MIN)).toBe(
      'A rede ficou fora por cerca de 12 min. Se usou etiqueta de papel, entregue a folha ao gerente para lançar no sistema.',
    );
  });
});
