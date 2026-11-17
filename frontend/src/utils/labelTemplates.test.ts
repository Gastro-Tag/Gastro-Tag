import { beforeEach, describe, expect, it } from 'vitest';
import { LABEL_TEMPLATE_KEY, getLabelTemplateChoice, loadLabelTemplateId, saveLabelTemplateId } from './labelTemplates';

beforeEach(() => localStorage.clear());

describe('escolha do modelo de etiqueta', () => {
  it('sem escolha: cai em A4, mas marca como não escolhido', () => {
    expect(getLabelTemplateChoice()).toEqual({ id: 'a4', explicit: false });
  });
  it('valor inválido guardado conta como não escolhido', () => {
    localStorage.setItem(LABEL_TEMPLATE_KEY, 'xpto');
    expect(getLabelTemplateChoice()).toEqual({ id: 'a4', explicit: false });
  });
  it('A4 escolhido de propósito é diferente de não escolhido', () => {
    saveLabelTemplateId('a4');
    expect(getLabelTemplateChoice()).toEqual({ id: 'a4', explicit: true });
  });
  it('quem já escolheu continua com o modelo', () => {
    localStorage.setItem(LABEL_TEMPLATE_KEY, 't60x40');
    expect(getLabelTemplateChoice()).toEqual({ id: 't60x40', explicit: true });
    expect(loadLabelTemplateId()).toBe('t60x40');
  });
  it('avisa as telas abertas ao salvar', () => {
    let calls = 0;
    const listener = () => { calls += 1; };
    window.addEventListener('gastrotag:label-template', listener);
    saveLabelTemplateId('t50x30');
    window.removeEventListener('gastrotag:label-template', listener);
    expect(calls).toBe(1);
  });
});
