import { describe, expect, it } from 'vitest';
import type { Label } from '@/types';
import { compactLabel, fullLabel } from './printLabel';
import { getLabelTemplate } from './labelTemplates';

const base = {
  id: '1', shortCode: 'AB12CD', productId: 'p', userId: 'u', lot: 'L1', openedAt: '2026-11-17',
  discardAt: '2026-11-20', storageType: 'REFRIGERADO', storageTemp: '4,0 °C', productName: 'Queijo <b>x</b>',
  productBrand: 'Marca', responsibleName: 'Maria', shelfLifeDays: 3, ruleId: 'r1', ruleSource: 'Bula',
  rule: { id: 'r1', shelfLifeDays: 3, source: 'Bula', sourceType: 'FABRICANTE' },
  originalExpiryDate: '2026-12-31', printCount: 0, createdAt: '2026-11-17', status: 'ATIVA',
} as unknown as Label;
const noRule = { ...base, ruleId: null, rule: null } as unknown as Label;
const noExpiry = { ...base, originalExpiryDate: undefined } as Label;

const t = (id: string) => getLabelTemplate(id);

describe('validade do fabricante (item 19)', () => {
  it('aparece em todos os modelos quando existe', () => {
    expect(fullLabel(base, '/logo.png')).toContain('31/12/2026');
    expect(compactLabel(base, t('t100x60'), '/logo.png')).toContain('31/12/2026');
    expect(compactLabel(base, t('t60x40'), '/logo.png')).toContain('Val. fab.');
    expect(compactLabel(base, t('t50x30'), '/logo.png')).toContain('31/12/2026');
  });
  it('é omitida quando não existe', () => {
    expect(fullLabel(noExpiry, '/logo.png')).not.toContain('Val. fab');
    for (const id of ['t100x60', 't60x40', 't50x30']) {
      expect(compactLabel(noExpiry, t(id), '/logo.png')).not.toContain('Val. fab');
    }
  });
});

describe('prazo e regra nos modelos pequenos (item 25)', () => {
  it('60x40 mostra prazo e tipo da fonte, não o texto livre', () => {
    const html = compactLabel(base, t('t60x40'), '/logo.png');
    expect(html).toContain('3 dias · Fabricante');
    expect(html).not.toContain('Bula');
  });
  it('60x40 sem regra avisa SEM REGRA VALIDADA; 50x30 avisa S/ REGRA', () => {
    expect(compactLabel(noRule, t('t60x40'), '/logo.png')).toContain('SEM REGRA VALIDADA');
    expect(compactLabel(noRule, t('t50x30'), '/logo.png')).toContain('S/ REGRA');
  });
  it('50x30 com regra não mostra aviso nem prazo', () => {
    const html = compactLabel(base, t('t50x30'), '/logo.png');
    expect(html).not.toContain('S/ REGRA');
    expect(html).not.toContain('dias');
  });
});

describe('data de descarte e escape', () => {
  it('a data não depende da escala automática nos modelos pequenos', () => {
    const html = compactLabel(base, t('t60x40'), '/logo.png', { scale: 0.5 });
    expect(html).toContain('<strong>20/11/2026</strong>');
    expect(html).toContain('--pt-scale:0.5');
  });
  it('escapa HTML vindo do usuário', () => {
    for (const id of ['t100x60', 't60x40', 't50x30']) {
      const html = compactLabel(base, t(id), '/logo.png');
      expect(html).not.toContain('<b>x</b>');
      expect(html).toContain('&lt;b&gt;');
    }
  });
});

describe('50x30: armazenamento e validade do fabricante na mesma linha', () => {
  it('mostra Refrig. com a temperatura e a validade, sem células largas', () => {
    const html = compactLabel(base, t('t50x30'), '/logo.png');
    expect(html).toContain('Refrig. 4,0 °C');
    expect(html).toContain('<dt>Val.</dt><dd>31/12/2026</dd>');
    expect(html).not.toContain('pt-wide');
  });
  it('sem armazenamento (último recurso) a validade continua', () => {
    const html = compactLabel(base, t('t50x30'), '/logo.png', { storage: false });
    expect(html).not.toContain('Refrig.');
    expect(html).toContain('31/12/2026');
  });
});

describe('piso da data de descarte', () => {
  it('passa o fator da data ao CSS, separado da escala dos demais textos', () => {
    const html = compactLabel(base, t('t60x40'), '/logo.png', { scale: 0.5, dateScale: 0.8 });
    expect(html).toContain('--pt-scale:0.5;--pt-ds:0.8');
  });
  it('60x40 com lote longo põe o lote em linha própria', () => {
    const html = compactLabel({ ...base, lot: 'LOTE-2026-0915-ABC' } as Label, t('t60x40'), '/logo.png');
    expect(html).toMatch(/<div class="pt-wide"><dt>Lote<\/dt>/);
  });
});
