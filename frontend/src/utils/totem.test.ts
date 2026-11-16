import { beforeEach, describe, expect, it } from 'vitest';
import {
  cleanName, clearOperator, getHandlerToken, getOperatorSession, rememberVerifiedOperator, dateDraft, formatDateDraft, getOperator, getRecentOperators,
  normalizeText, parseDateDraft, rememberOperator,
} from './totem';

const HOUR = 60 * 60 * 1000;

beforeEach(() => localStorage.clear());

describe('cleanName', () => {
  it('colapsa espaços e apara as pontas', () => {
    expect(cleanName('  Maria   da  Silva ')).toBe('Maria da Silva');
  });
  it('limita a 100 caracteres', () => {
    expect(cleanName('a'.repeat(150))).toHaveLength(100);
  });
});

describe('normalizeText', () => {
  it('remove acentos, minúsculas e apara', () => {
    expect(normalizeText('  FRANGO Açaí Pão ')).toBe('frango acai pao');
  });
});

describe('operador do turno', () => {
  it('vazio quando nada foi salvo', () => {
    expect(getOperator()).toBe('');
  });
  it('mantém o operador dentro de 10 h', () => {
    rememberOperator('Ana', 1_000);
    expect(getOperator(1_000 + 10 * HOUR)).toBe('Ana');
  });
  it('expira após 10 h', () => {
    rememberOperator('Ana', 1_000);
    expect(getOperator(1_000 + 10 * HOUR + 1)).toBe('');
  });
  it('ignora nome vazio', () => {
    rememberOperator('   ', 1_000);
    expect(getOperator(1_000)).toBe('');
    expect(getRecentOperators()).toEqual([]);
  });
  it('tolera JSON corrompido no localStorage', () => {
    localStorage.setItem('gastrotag:totem:operator', '{quebrado');
    expect(getOperator()).toBe('');
  });
});

describe('operadores recentes', () => {
  it('põe o mais novo na frente e remove duplicata sem diferenciar caixa', () => {
    rememberOperator('Ana');
    rememberOperator('Bia');
    rememberOperator('ana');
    expect(getRecentOperators()).toEqual(['ana', 'Bia']);
  });
  it('guarda no máximo 8', () => {
    for (let i = 1; i <= 10; i++) rememberOperator(`Op${i}`);
    const list = getRecentOperators();
    expect(list).toHaveLength(8);
    expect(list[0]).toBe('Op10');
  });
});

describe('datas digitadas', () => {
  it('formatDateDraft formata parcial e completo', () => {
    expect(formatDateDraft('25')).toBe('25');
    expect(formatDateDraft('2512')).toBe('25/12');
    expect(formatDateDraft('25122026')).toBe('25/12/2026');
    expect(formatDateDraft('')).toBe('');
  });
  it('parseDateDraft aceita ano de 4 e 2 dígitos', () => {
    expect(parseDateDraft('25122026')).toBe('2026-12-25');
    expect(parseDateDraft('251226')).toBe('2026-12-25');
  });
  it('parseDateDraft rejeita datas inexistentes e formatos inválidos', () => {
    expect(parseDateDraft('31022026')).toBeNull();
    expect(parseDateDraft('00012026')).toBeNull();
    expect(parseDateDraft('2512')).toBeNull();
    expect(parseDateDraft('abcdefgh')).toBeNull();
  });
  it('parseDateDraft aceita 29/02 em ano bissexto apenas', () => {
    expect(parseDateDraft('29022028')).toBe('2028-02-29');
    expect(parseDateDraft('29022027')).toBeNull();
  });
  it('dateDraft inverte ISO para ddmmaaaa', () => {
    expect(dateDraft('2026-12-25')).toBe('25122026');
    expect(parseDateDraft(dateDraft('2026-01-05'))).toBe('2026-01-05');
  });
});

describe('operador com PIN', () => {
  const op = { id: 'u1', name: ' Carla  Dias ' };
  const T0 = 1_000_000;

  it('guarda sessão com id, nome limpo e token', () => {
    rememberVerifiedOperator(op, 'tok', new Date(T0 + 5 * HOUR).toISOString(), T0);
    expect(getOperatorSession(T0)).toMatchObject({ id: 'u1', name: 'Carla Dias', handlerToken: 'tok' });
    expect(getHandlerToken(T0)).toBe('tok');
    expect(getOperator(T0)).toBe('Carla Dias');
  });
  it('expira no menor entre 10 h e expiresAt (expiresAt antes)', () => {
    rememberVerifiedOperator(op, 'tok', new Date(T0 + 2 * HOUR).toISOString(), T0);
    expect(getHandlerToken(T0 + 2 * HOUR - 1)).toBe('tok');
    expect(getOperatorSession(T0 + 2 * HOUR)).toBeNull();
    expect(getHandlerToken(T0 + 2 * HOUR)).toBe('');
  });
  it('expira no menor entre 10 h e expiresAt (10 h antes)', () => {
    rememberVerifiedOperator(op, 'tok', new Date(T0 + 20 * HOUR).toISOString(), T0);
    expect(getOperatorSession(T0 + 10 * HOUR - 1)).not.toBeNull();
    expect(getOperatorSession(T0 + 10 * HOUR + 1)).toBeNull();
  });
  it('expiresAt inválido cai para 10 h', () => {
    rememberVerifiedOperator(op, 'tok', 'lixo', T0);
    expect(getOperatorSession(T0 + 10 * HOUR - 1)?.handlerToken).toBe('tok');
    expect(getOperatorSession(T0 + 10 * HOUR + 1)).toBeNull();
  });
  it('rememberOperator (nome digitado) apaga o token anterior', () => {
    rememberVerifiedOperator(op, 'tok', new Date(T0 + 5 * HOUR).toISOString(), T0);
    rememberOperator('Beto', T0);
    expect(getHandlerToken(T0)).toBe('');
    expect(getOperatorSession(T0)).toMatchObject({ name: 'Beto' });
    expect(getOperatorSession(T0)?.id).toBeUndefined();
  });
  it('clearOperator limpa o operador e o token', () => {
    rememberVerifiedOperator(op, 'tok', new Date(T0 + 5 * HOUR).toISOString(), T0);
    clearOperator();
    expect(getOperatorSession(T0)).toBeNull();
    expect(getOperator(T0)).toBe('');
    expect(getHandlerToken(T0)).toBe('');
  });
});
