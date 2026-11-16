import { describe, expect, it } from 'vitest';
import { OUTCOME_LABEL, REASON_LABEL, REASON_OPTIONS, outcomeText } from './labelStatus';

describe('outcomeText', () => {
  it('vazio para etiqueta ativa', () => {
    expect(outcomeText({ status: 'ATIVA', outcome: null, discardReason: null })).toBe('');
  });
  it('vazio se encerrada sem destino', () => {
    expect(outcomeText({ status: 'ENCERRADA', outcome: null, discardReason: null })).toBe('');
  });
  it('usado e cancelado não mostram motivo', () => {
    expect(outcomeText({ status: 'ENCERRADA', outcome: 'USADO', discardReason: null })).toBe('Usado');
    expect(outcomeText({ status: 'ENCERRADA', outcome: 'CANCELADO', discardReason: 'OUTRO' })).toBe('Cancelado');
  });
  it('descartado mostra o motivo', () => {
    expect(outcomeText({ status: 'ENCERRADA', outcome: 'DESCARTADO', discardReason: 'PRAZO_VENCIDO' }))
      .toBe('Descartado · Prazo vencido');
    expect(outcomeText({ status: 'ENCERRADA', outcome: 'DESCARTADO', discardReason: null })).toBe('Descartado');
  });
});

describe('constantes', () => {
  it('REASON_OPTIONS cobre todos os motivos', () => {
    expect(REASON_OPTIONS).toEqual(['PRAZO_VENCIDO', 'ALTERACAO_SENSORIAL', 'EMBALAGEM_DANIFICADA', 'OUTRO']);
    expect(Object.keys(OUTCOME_LABEL)).toHaveLength(3);
    expect(REASON_LABEL.OUTRO).toBe('Outro');
  });
});
