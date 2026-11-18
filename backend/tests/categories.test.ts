import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CATEGORIES, categoryKey, cleanCategoryInput, mergeWithDefaults, normalizeCategory, pickUsedSpelling, resolveCategory,
} from '../src/domain/categories';

describe('normalizeCategory', () => {
  it('ignores case, accents and spaces at the ends', () => {
    expect(normalizeCategory('  Laticínios ')).toBe('laticinios');
    expect(normalizeCategory('HORTIFRÚTI')).toBe(normalizeCategory('hortifruti'));
  });

  it('keeps inner spaces as they are', () => {
    expect(normalizeCategory('Frios  e embutidos')).not.toBe(normalizeCategory('Frios e embutidos'));
  });
});

describe('cleanCategoryInput', () => {
  it('trims and collapses inner spaces', () => {
    expect(cleanCategoryInput('  Frios   e \t embutidos  ')).toBe('Frios e embutidos');
  });

  it('turns empty, blank, null and undefined into null', () => {
    expect(cleanCategoryInput('')).toBeNull();
    expect(cleanCategoryInput('   ')).toBeNull();
    expect(cleanCategoryInput(null)).toBeNull();
    expect(cleanCategoryInput(undefined)).toBeNull();
  });
});

describe('pickUsedSpelling', () => {
  it('returns the most used equivalent spelling, then alphabetical order', () => {
    const usage = [
      { category: 'laticinios', count: 1 },
      { category: 'Laticínios', count: 3 },
      { category: 'Carnes', count: 5 },
    ];
    expect(pickUsedSpelling('LATICÍNIOS', usage)).toBe('Laticínios');
    expect(pickUsedSpelling('Laticinios', [{ category: 'b', count: 1 }, { category: 'B', count: 1 }])).toBeNull();
    expect(pickUsedSpelling('b', [{ category: 'b', count: 1 }, { category: 'B', count: 1 }]))
      .toBe(['b', 'B'].sort((x, y) => x.localeCompare(y))[0]);
  });

  it('ignores null categories', () => {
    expect(pickUsedSpelling('x', [{ category: null, count: 4 }])).toBeNull();
  });
});

describe('resolveCategory', () => {
  it('prefers the spelling in use over the default list', () => {
    expect(resolveCategory('laticinios', { usage: [{ category: 'LATICÍNIOS', count: 2 }] })).toBe('LATICÍNIOS');
  });

  it('uses the default spelling when nothing equivalent is in use', () => {
    expect(resolveCategory('laticinios', { usage: [] })).toBe('Laticínios');
    expect(resolveCategory('  frios   E EMBUTIDOS ', { usage: [{ category: 'Carnes', count: 1 }] })).toBe('Frios e embutidos');
  });

  it('keeps a new text with collapsed spaces', () => {
    expect(resolveCategory('  Congelados   prontos ', { usage: [] })).toBe('Congelados prontos');
  });

  it('turns empty into null', () => {
    expect(resolveCategory('   ', { usage: [{ category: 'Carnes', count: 1 }], current: 'Carnes' })).toBeNull();
    expect(resolveCategory(null, { usage: [] })).toBeNull();
  });
});

describe('categoryKey', () => {
  it('also collapses inner spaces, unlike normalizeCategory', () => {
    expect(categoryKey(' Frios  e	EMBUTIDOS ')).toBe('frios e embutidos');
    expect(categoryKey('Laticínios')).toBe(normalizeCategory('Laticínios'));
  });
});

describe('resolveCategory precedence', () => {
  const usage = [{ category: 'Laticínios', count: 5 }, { category: 'LATICINIOS', count: 1 }];

  it('on update keeps the current spelling when equivalent, even if another one is more used', () => {
    expect(resolveCategory('Laticínios', { usage, current: 'LATICINIOS' })).toBe('LATICINIOS');
    expect(resolveCategory('Carnes', { usage, current: 'LATICINIOS' })).toBe('Carnes');
  });

  it('prefers the spelling of an active category rule (most recent first) over the most used', () => {
    expect(resolveCategory('laticinios', { usage, ruleCategories: ['LATICINIOS', 'laticínios'] })).toBe('LATICINIOS');
    expect(resolveCategory('laticinios', { usage, ruleCategories: ['Carnes'] })).toBe('Laticínios');
  });

  it('treats inner double spaces as equivalent and keeps the stored spelling', () => {
    expect(resolveCategory('frios e embutidos', { usage: [], ruleCategories: ['Frios  e embutidos'] }))
      .toBe('Frios  e embutidos');
    expect(resolveCategory('Frios e embutidos', { usage: [{ category: 'Frios  e embutidos', count: 1 }] }))
      .toBe('Frios  e embutidos');
    expect(resolveCategory('frios e embutidos', { usage: [], current: 'Frios  e embutidos' })).toBe('Frios  e embutidos');
  });
});

describe('mergeWithDefaults', () => {
  it('without categories in use returns the default list in pt-BR order', () => {
    expect(mergeWithDefaults([])).toEqual([...DEFAULT_CATEGORIES].sort((a, b) => a.localeCompare(b, 'pt-BR')));
  });

  it('joins used and default categories without equivalent duplicates, preferring the most used spelling', () => {
    const merged = mergeWithDefaults([
      { category: 'laticinios', count: 1 },
      { category: 'LATICÍNIOS', count: 2 },
      { category: 'Congelados', count: 1 },
      { category: null, count: 9 },
    ]);
    expect(merged).toContain('LATICÍNIOS');
    expect(merged).not.toContain('Laticínios');
    expect(merged).not.toContain('laticinios');
    expect(merged).toContain('Congelados');
    expect(merged).toContain('Ovos');
    expect(new Set(merged.map(normalizeCategory)).size).toBe(merged.length);
    expect(merged.length).toBe(DEFAULT_CATEGORIES.length + 1);
    expect(merged).toEqual([...merged].sort((a, b) => a.localeCompare(b, 'pt-BR')));
  });

  it('prefers the active rule spelling and merges inner double spaces', () => {
    const merged = mergeWithDefaults(
      [{ category: 'Laticínios', count: 5 }, { category: 'LATICINIOS', count: 1 }, { category: 'Frios  e embutidos', count: 1 }],
      ['LATICINIOS', 'Só em regra'],
    );
    expect(merged.filter((item) => categoryKey(item) === 'laticinios')).toEqual(['LATICINIOS']);
    expect(merged.filter((item) => categoryKey(item) === 'frios e embutidos')).toEqual(['Frios  e embutidos']);
    expect(merged).not.toContain('Só em regra');
    expect(new Set(merged.map(categoryKey)).size).toBe(merged.length);
  });
});
