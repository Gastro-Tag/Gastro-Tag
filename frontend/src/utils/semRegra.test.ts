import { describe, expect, it } from 'vitest';
import { confirmaBloqueio, semRegraResumo, toastBloqueio, usaDiasDoCadastro } from './semRegra';

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

describe('confirmaBloqueio', () => {
  it('conta produtos e combinações', () => {
    expect(confirmaBloqueio({ total: 5, missingCount: 7 })).toBe('5 produtos (7 combinações) ficarão bloqueados até ganharem regra.');
    expect(confirmaBloqueio({ total: 1, missingCount: 1 })).toBe('1 produto (1 combinação) ficará bloqueado até ganhar regra.');
  });
  it('não afirma zero sem dados', () => {
    expect(confirmaBloqueio(null)).toContain('Não foi possível calcular');
  });
  it('avisa quando nada será bloqueado', () => {
    expect(confirmaBloqueio({ total: 0, missingCount: 0 })).toBe('Nenhum produto ficará bloqueado: todos já têm regra validada.');
  });
});

describe('toastBloqueio', () => {
  it('descreve ligado, zero e desligado', () => {
    expect(toastBloqueio(true, 2, 3)).toBe('Exigência ligada. 2 produtos bloqueados (3 combinações) até ganharem regra.');
    expect(toastBloqueio(true, 1, 1)).toContain('até ganhar regra');
    expect(toastBloqueio(true, 0, 0)).toContain('Nenhum produto');
    expect(toastBloqueio(false, 0, 0)).toContain('desligada');
  });
});
