import { describe, expect, it } from 'vitest';
import { FLOW_PLAUSIBLE_MAX_MS, elapsedFlowMs, flowStartFromState, formatFlowSeconds, percentOf } from './flowTime';

describe('elapsedFlowMs', () => {
  it('devolve a diferença arredondada em ms inteiros', () => {
    expect(elapsedFlowMs(1000, 13_400.6)).toBe(12_401);
    expect(elapsedFlowMs(0, 0)).toBe(0);
  });
  it('descarta início ausente ou inválido', () => {
    expect(elapsedFlowMs(undefined, 5000)).toBeUndefined();
    expect(elapsedFlowMs(null, 5000)).toBeUndefined();
    expect(elapsedFlowMs(Number.NaN, 5000)).toBeUndefined();
  });
  it('descarta valor negativo (página recarregada) e acima de 10 minutos', () => {
    expect(elapsedFlowMs(9000, 5000)).toBeUndefined();
    expect(elapsedFlowMs(0, FLOW_PLAUSIBLE_MAX_MS)).toBe(FLOW_PLAUSIBLE_MAX_MS);
    expect(elapsedFlowMs(0, FLOW_PLAUSIBLE_MAX_MS + 1)).toBeUndefined();
  });
});

describe('flowStartFromState', () => {
  it('lê flowStart numérico e ignora o resto', () => {
    expect(flowStartFromState({ flowStart: 1234.5 })).toBe(1234.5);
    expect(flowStartFromState(null)).toBeUndefined();
    expect(flowStartFromState({ flowStart: '10' })).toBeUndefined();
    expect(flowStartFromState({ flowStart: -1 })).toBeUndefined();
    expect(flowStartFromState(undefined)).toBeUndefined();
  });
});

describe('formatFlowSeconds e percentOf', () => {
  it('formata segundos com uma casa e vírgula', () => {
    expect(formatFlowSeconds(12_340)).toBe('12,3 s');
    expect(formatFlowSeconds(0)).toBe('0,0 s');
    expect(formatFlowSeconds(null)).toBe('—');
  });
  it('percentual sem base devolve null', () => {
    expect(percentOf(1, 3)).toBe(33);
    expect(percentOf(0, 0)).toBeNull();
  });
});
