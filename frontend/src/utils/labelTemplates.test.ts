import { beforeEach, describe, expect, it } from 'vitest';
import {
  LABEL_TEMPLATE_KEY, LABEL_TEMPLATE_SOURCE_TEXT, clearLabelTemplateId, getLabelTemplateChoice, loadLabelTemplateId,
  resolveLabelTemplate, saveLabelTemplateId, setKitchenLabelTemplate,
} from './labelTemplates';

beforeEach(() => { localStorage.clear(); setKitchenLabelTemplate(null); });

describe('escolha do modelo de etiqueta', () => {
  it('sem escolha: cai em A4, mas marca como não escolhido', () => {
    expect(getLabelTemplateChoice()).toEqual({ id: 'a4', explicit: false, source: 'none' });
  });
  it('valor inválido guardado conta como não escolhido', () => {
    localStorage.setItem(LABEL_TEMPLATE_KEY, 'xpto');
    expect(getLabelTemplateChoice()).toEqual({ id: 'a4', explicit: false, source: 'none' });
  });
  it('A4 escolhido de propósito é diferente de não escolhido', () => {
    saveLabelTemplateId('a4');
    expect(getLabelTemplateChoice()).toEqual({ id: 'a4', explicit: true, source: 'device' });
  });
  it('quem já escolheu continua com o modelo', () => {
    localStorage.setItem(LABEL_TEMPLATE_KEY, 't60x40');
    expect(getLabelTemplateChoice()).toEqual({ id: 't60x40', explicit: true, source: 'device' });
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

describe('prioridade: exceção do aparelho > padrão da cozinha > A4', () => {
  it('exceção do aparelho vence o padrão da cozinha', () => {
    expect(resolveLabelTemplate('t60x40', 't100x60')).toEqual({ id: 't60x40', explicit: true, source: 'device' });
  });
  it('sem exceção, vale o padrão da cozinha', () => {
    expect(resolveLabelTemplate(null, 't100x60')).toEqual({ id: 't100x60', explicit: true, source: 'kitchen' });
  });
  it('sem nada (ou valores inválidos), A4 sem escolha', () => {
    expect(resolveLabelTemplate(null, null)).toEqual({ id: 'a4', explicit: false, source: 'none' });
    expect(resolveLabelTemplate('xpto', 'abc')).toEqual({ id: 'a4', explicit: false, source: 'none' });
  });
  it('exceção antiga já gravada continua valendo com padrão da cozinha definido', () => {
    localStorage.setItem(LABEL_TEMPLATE_KEY, 't50x30');
    setKitchenLabelTemplate('t100x60');
    expect(getLabelTemplateChoice()).toEqual({ id: 't50x30', explicit: true, source: 'device' });
  });
  it('padrão da cozinha vale na impressão sem exceção; remover a exceção volta a ele', () => {
    setKitchenLabelTemplate('t100x60');
    expect(loadLabelTemplateId()).toBe('t100x60');
    saveLabelTemplateId('t60x40');
    expect(loadLabelTemplateId()).toBe('t60x40');
    clearLabelTemplateId();
    expect(localStorage.getItem(LABEL_TEMPLATE_KEY)).toBeNull();
    expect(getLabelTemplateChoice().source).toBe('kitchen');
  });
  it('padrão desconhecido do servidor vira nulo', () => {
    setKitchenLabelTemplate('xpto');
    expect(getLabelTemplateChoice().source).toBe('none');
  });
  it('texto da origem', () => {
    expect(LABEL_TEMPLATE_SOURCE_TEXT.kitchen).toBe('Padrão da cozinha');
    expect(LABEL_TEMPLATE_SOURCE_TEXT.device).toBe('Exceção deste aparelho');
    expect(LABEL_TEMPLATE_SOURCE_TEXT.none).toBe('Não escolhido: A4');
  });
});
