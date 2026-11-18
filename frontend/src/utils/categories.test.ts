import { describe, expect, it } from 'vitest';
import { buildCategoryOptions, findSimilarCategory, isSameCategory, normalizeCategory } from './categories';

const options = ['Carnes', 'Laticínios', 'Molhos', 'Hortifrúti'];

describe('normalizeCategory', () => {
  it('ignora caixa, acentos e espaços', () => {
    expect(normalizeCategory('  LATICÍNIOS  ')).toBe('laticinios');
    expect(normalizeCategory('Hortifrúti   frescos')).toBe('hortifruti frescos');
    expect(normalizeCategory('   ')).toBe('');
  });
});

describe('isSameCategory', () => {
  it('compara de forma equivalente', () => {
    expect(isSameCategory('laticinios', 'Laticínios')).toBe(true);
    expect(isSameCategory('Carne', 'Carnes')).toBe(false);
  });
});

describe('buildCategoryOptions', () => {
  it('mantém a lista quando a categoria atual já está nela ou é vazia', () => {
    expect(buildCategoryOptions(['A', 'B'], 'A')).toEqual(['A', 'B']);
    expect(buildCategoryOptions(['A', 'B'], '')).toEqual(['A', 'B']);
  });

  it('acrescenta a categoria atual com a grafia exata, mesmo se equivalente a outra', () => {
    expect(buildCategoryOptions(['Laticínios', 'Molhos'], 'laticinios'))
      .toEqual(['laticinios', 'Laticínios', 'Molhos']);
  });

  it('não acrescenta o valor interno de "Outra…"', () => {
    expect(buildCategoryOptions(['A'], '__outra__')).toEqual(['A']);
  });
});

describe('findSimilarCategory', () => {
  it('acha equivalente ignorando caixa e acentos e devolve a grafia da lista', () => {
    expect(findSimilarCategory('laticinios', options)).toBe('Laticínios');
    expect(findSimilarCategory(' MOLHOS ', options)).toBe('Molhos');
  });

  it('acha singular/plural simples', () => {
    expect(findSimilarCategory('Carne', options)).toBe('Carnes');
    expect(findSimilarCategory('Molho', options)).toBe('Molhos');
  });

  it('acha erro de digitação pequeno', () => {
    expect(findSimilarCategory('Latcínios', options)).toBe('Laticínios');
    expect(findSimilarCategory('Hortifruti', options)).toBe('Hortifrúti');
  });

  it('não sugere para categorias realmente diferentes', () => {
    expect(findSimilarCategory('Bebidas', options)).toBeNull();
    expect(findSimilarCategory('Massas', options)).toBeNull();
  });

  it('não sugere para texto vazio ou lista vazia', () => {
    expect(findSimilarCategory('   ', options)).toBeNull();
    expect(findSimilarCategory('Carnes', [])).toBeNull();
  });
});
