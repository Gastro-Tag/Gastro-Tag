import { describe, expect, it } from 'vitest';
import { reportClosedDetail, reportKitchenTitle, reportLotText, reportPeriodText, reportSituation } from './report';

const base = { status: 'ATIVA' as const, outcome: null, discardReason: null, discardAt: '2026-11-25' };

describe('reportSituation', () => {
  it('ativa no dia do descarte ainda não está vencida', () => {
    expect(reportSituation(base, '2026-11-25')).toBe('Ativa');
  });
  it('ativa depois do descarte fica vencida', () => {
    expect(reportSituation({ ...base, discardAt: '2026-11-24' }, '2026-11-25')).toBe('Ativa — vencida');
  });
  it('descreve usada, cancelada e descartada com motivo', () => {
    const closed = { ...base, status: 'ENCERRADA' as const };
    expect(reportSituation({ ...closed, outcome: 'USADO' }, '2026-11-25')).toBe('Usada');
    expect(reportSituation({ ...closed, outcome: 'CANCELADO' }, '2026-11-25')).toBe('Cancelada');
    expect(reportSituation({ ...closed, outcome: 'DESCARTADO', discardReason: 'PRAZO_VENCIDO' }, '2026-11-25')).toBe('Descartada: prazo vencido');
    expect(reportSituation({ ...closed, outcome: 'DESCARTADO' }, '2026-11-25')).toBe('Descartada');
  });
});

describe('reportPeriodText', () => {
  it('formata sem deslocar o dia', () => {
    expect(reportPeriodText('2026-11-01', '2026-11-30')).toBe('01/11/2026 a 30/11/2026');
  });
});

describe('reportLotText', () => {
  it('marca outra embalagem apenas quando digitada', () => {
    expect(reportLotText({ lot: 'L1', lotSource: 'informado' })).toBe('L1 (outra embalagem)');
    expect(reportLotText({ lot: 'L1', lotSource: 'cadastrado' })).toBe('L1');
  });
});

describe('reportKitchenTitle', () => {
  it('usa aviso sem nome', () => {
    expect(reportKitchenTitle(null)).toBe('Cozinha (nome não definido)');
    expect(reportKitchenTitle('  ')).toBe('Cozinha (nome não definido)');
    expect(reportKitchenTitle(' Cozinha A ')).toBe('Cozinha A');
  });
});

describe('relatório: anterior ao encerramento e detalhe do encerramento', () => {
  it('ativa anterior ao encerramento não vira vencida', () => {
    expect(reportSituation({ status: 'ATIVA', outcome: null, discardReason: null, discardAt: '2026-11-01', beforeClosing: true }, '2026-11-20'))
      .toBe('Anterior ao encerramento');
  });
  it('mostra quem encerrou, quando e a observação', () => {
    const fmt = (iso: string) => `F(${iso})`;
    expect(reportClosedDetail({ status: 'ENCERRADA', closedByName: 'Ana', closedAt: 'X', closeNote: 'Caiu' }, fmt)).toBe('Ana, F(X) · "Caiu"');
    expect(reportClosedDetail({ status: 'ATIVA', closedByName: null, closedAt: null, closeNote: null }, fmt)).toBe('');
  });
});
