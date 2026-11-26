import { describe, expect, it } from 'vitest';
import {
  EMPTY_CONTINGENCY_FORM, blocksEmUso, buildContingencyDTO, localInputToIso, previewSummary, toLocalInput, validateContingencyForm,
  type ContingencyForm,
} from './contingency';
import type { ContingencyPreview } from '@/types';

const NOW = new Date(2026, 10, 26, 12, 0);
const ok: ContingencyForm = {
  ...EMPTY_CONTINGENCY_FORM, productId: 'p1', lot: ' L1 ', originalExpiryDate: '2026-12-31',
  openedAtLocal: '2026-11-26T09:30', responsibleName: ' Maria ',
};
const preview = (over: Partial<ContingencyPreview> = {}): ContingencyPreview => ({
  shelfLifeDays: 3, discardAt: '2026-11-28', cappedByOriginalExpiry: false,
  rule: { id: 'r', version: 2, source: 'Manual interno', validated: true }, expired: false, ...over,
});

describe('datetime-local', () => {
  it('ida e volta preserva o instante local', () => {
    const iso = localInputToIso('2026-11-26T09:30');
    expect(iso).not.toBeNull();
    expect(toLocalInput(new Date(iso!))).toBe('2026-11-26T09:30');
  });
  it('vazio ou inválido vira null', () => {
    expect(localInputToIso('')).toBeNull();
    expect(localInputToIso('2026-13-45T99:99')).toBeNull();
  });
});

describe('validateContingencyForm', () => {
  it('formulário completo passa', () => expect(validateContingencyForm(ok, NOW)).toBeNull());
  it('exige produto, lote, validade, abertura e responsável', () => {
    expect(validateContingencyForm({ ...ok, productId: '' }, NOW)).toMatch(/produto/);
    expect(validateContingencyForm({ ...ok, lot: '  ' }, NOW)).toMatch(/lote/);
    expect(validateContingencyForm({ ...ok, originalExpiryDate: '' }, NOW)).toMatch(/validade/);
    expect(validateContingencyForm({ ...ok, openedAtLocal: '' }, NOW)).toMatch(/abertura/);
    expect(validateContingencyForm({ ...ok, responsibleName: ' ' }, NOW)).toMatch(/responsável/);
  });
  it('abertura no futuro é recusada', () => {
    expect(validateContingencyForm({ ...ok, openedAtLocal: '2026-11-26T13:00' }, NOW)).toMatch(/futuro/);
  });
  it('descartado exige motivo; "outro" exige observação', () => {
    expect(validateContingencyForm({ ...ok, outcome: 'DESCARTADO' }, NOW)).toMatch(/motivo/);
    expect(validateContingencyForm({ ...ok, outcome: 'DESCARTADO', discardReason: 'OUTRO', note: 'ab' }, NOW)).toMatch(/observação/);
    expect(validateContingencyForm({ ...ok, outcome: 'DESCARTADO', discardReason: 'OUTRO', note: 'abc' }, NOW)).toBeNull();
    expect(validateContingencyForm({ ...ok, outcome: 'DESCARTADO', discardReason: 'PRAZO_VENCIDO' }, NOW)).toBeNull();
  });
});

describe('buildContingencyDTO', () => {
  it('apara textos, converte a abertura e omite o vazio', () => {
    const dto = buildContingencyDTO(ok);
    expect(dto).toMatchObject({ productId: 'p1', storageType: 'REFRIGERADO', lot: 'L1', responsibleName: 'Maria', outcome: 'EM_USO' });
    expect(dto.openedAt).toMatch(/Z$/);
    expect(dto.paperRef).toBeUndefined();
    expect(dto.note).toBeUndefined();
    expect(dto.discardReason).toBeUndefined();
    expect(dto.outageId).toBeUndefined();
  });
  it('motivo só vai com descartado; outageId e referência vão quando preenchidos', () => {
    const base = { ...ok, discardReason: 'OUTRO' as const, paperRef: ' F-12 ', outageId: 'o1', note: ' x ' };
    expect(buildContingencyDTO({ ...base, outcome: 'USADO' }).discardReason).toBeUndefined();
    const dto = buildContingencyDTO({ ...base, outcome: 'DESCARTADO' });
    expect(dto).toMatchObject({ discardReason: 'OUTRO', paperRef: 'F-12', outageId: 'o1', note: 'x' });
  });
});

describe('previewSummary', () => {
  it('regra validada mostra versão e fonte', () => {
    expect(previewSummary(preview()).ruleText).toBe('Regra validada (v2) · Manual interno');
    expect(previewSummary(preview()).warning).toBeNull();
  });
  it('sem regra validada e vencido', () => {
    const s = previewSummary(preview({ rule: { id: null, version: null, source: null, validated: false }, expired: true }));
    expect(s.ruleText).toBe('sem regra validada');
    expect(s.warning).toBe('Já venceu: registre como descartado ou usado.');
  });
});

describe('blocksEmUso', () => {
  it('só bloqueia em uso com cálculo vencido', () => {
    expect(blocksEmUso(preview({ expired: true }), 'EM_USO')).toBe(true);
    expect(blocksEmUso(preview({ expired: true }), 'USADO')).toBe(false);
    expect(blocksEmUso(preview(), 'EM_USO')).toBe(false);
    expect(blocksEmUso(null, 'EM_USO')).toBe(false);
  });
});
