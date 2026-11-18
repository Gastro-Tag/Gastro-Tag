import { describe, expect, it } from 'vitest';
import { loginUrl, safeNext } from './redirect';

describe('safeNext', () => {
  it('aceita caminho interno do painel, com busca', () => {
    expect(safeNext('/rules')).toBe('/rules');
    expect(safeNext('/labels?status=ATIVA')).toBe('/labels?status=ATIVA');
  });

  it('recusa outro site, login, totem e valores estranhos', () => {
    for (const value of ['//evil.com', '/\\evil.com', 'https://evil.com', 'rules', '/login', '/login?next=/x', '/totem', '', null, undefined, 1]) {
      expect(safeNext(value)).toBe('/');
    }
  });
});

describe('loginUrl', () => {
  it('guarda a página atual', () => {
    expect(loginUrl('/rules', '?tab=sem-regra')).toBe('/login?next=%2Frules%3Ftab%3Dsem-regra');
  });

  it('sem destino útil vai só para o login', () => {
    expect(loginUrl('/')).toBe('/login');
    expect(loginUrl('/login')).toBe('/login');
  });
});
