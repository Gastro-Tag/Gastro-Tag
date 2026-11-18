import { describe, expect, it } from 'vitest';
import { semRegraResumo, usaDiasDoCadastro } from './semRegra';

describe('semRegraResumo', () => {
  it('usa plural', () => {
    expect(semRegraResumo(5, 7)).toBe('5 produtos, 7 combinações sem regra');
  });
  it('usa singular', () => {
    expect(semRegraResumo(1, 1)).toBe('1 produto, 1 combinação sem regra');
  });
});

describe('usaDiasDoCadastro', () => {
  it('concorda com o número de dias', () => {
    expect(usaDiasDoCadastro(1)).toBe('usa 1 dia do cadastro do produto');
    expect(usaDiasDoCadastro(3)).toBe('usa 3 dias do cadastro do produto');
  });
});
