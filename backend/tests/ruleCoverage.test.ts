import { describe, expect, it } from 'vitest';
import { hasActiveRuleFor } from '../src/services/labelService';

// Sem banco: o mesmo critério de findActiveRule, aplicado em memória às regras ativas.
const product = { id: 'produto-1', category: 'Laticínios' };

describe('hasActiveRuleFor', () => {
  it('counts a product rule only for its storage type', () => {
    const rules = [{ productId: 'produto-1', category: null, storageType: 'REFRIGERADO' as const }];
    expect(hasActiveRuleFor(rules, product, 'REFRIGERADO')).toBe(true);
    expect(hasActiveRuleFor(rules, product, 'CONGELADO')).toBe(false);
    expect(hasActiveRuleFor(rules, { ...product, id: 'produto-2' }, 'REFRIGERADO')).toBe(false);
  });

  it('counts a category rule with exactly the same category', () => {
    const rules = [{ productId: null, category: 'Laticínios', storageType: 'CONGELADO' as const }];
    expect(hasActiveRuleFor(rules, product, 'CONGELADO')).toBe(true);
    expect(hasActiveRuleFor(rules, product, 'REFRIGERADO')).toBe(false);
  });

  it('does not match a category that differs only in case or spacing', () => {
    const rules = [
      { productId: null, category: 'laticínios', storageType: 'REFRIGERADO' as const },
      { productId: null, category: 'Laticínios ', storageType: 'REFRIGERADO' as const },
    ];
    expect(hasActiveRuleFor(rules, product, 'REFRIGERADO')).toBe(false);
  });

  it('ignores category rules for a product without category', () => {
    const rules = [
      { productId: null, category: null, storageType: 'REFRIGERADO' as const },
      { productId: null, category: '', storageType: 'REFRIGERADO' as const },
    ];
    expect(hasActiveRuleFor(rules, { id: 'produto-1', category: null }, 'REFRIGERADO')).toBe(false);
    expect(hasActiveRuleFor(rules, { id: 'produto-1', category: '' }, 'REFRIGERADO')).toBe(false);
  });

  it('does not take a category rule from another product category as a product rule', () => {
    const rules = [{ productId: 'produto-2', category: null, storageType: 'REFRIGERADO' as const }];
    expect(hasActiveRuleFor(rules, product, 'REFRIGERADO')).toBe(false);
    expect(hasActiveRuleFor([], product, 'REFRIGERADO')).toBe(false);
  });
});
