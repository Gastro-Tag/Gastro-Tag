import { describe, expect, it } from 'vitest';
import { canConfirmPseudonymize, exportFilename } from './titular';

describe('canConfirmPseudonymize', () => {
  it('exige o nome exato, ignorando espaços nas pontas', () => {
    expect(canConfirmPseudonymize('Maria Souza', 'Maria Souza')).toBe(true);
    expect(canConfirmPseudonymize('  Maria Souza ', 'Maria Souza')).toBe(true);
    expect(canConfirmPseudonymize('Maria Souza', ' Maria Souza  ')).toBe(true);
  });
  it('não libera com nome diferente, parcial ou vazio', () => {
    expect(canConfirmPseudonymize('', 'Maria Souza')).toBe(false);
    expect(canConfirmPseudonymize('Maria', 'Maria Souza')).toBe(false);
    expect(canConfirmPseudonymize('maria souza', 'Maria Souza')).toBe(false);
    expect(canConfirmPseudonymize('Maria  Souza', 'Maria Souza')).toBe(false);
  });
  it('não libera quando o nome esperado é vazio', () => {
    expect(canConfirmPseudonymize('', '')).toBe(false);
    expect(canConfirmPseudonymize('  ', '  ')).toBe(false);
  });
});

describe('exportFilename', () => {
  const id = '1234abcd-0000-4000-8000-000000000000';
  it('usa o nome do cabeçalho', () => {
    expect(exportFilename('attachment; filename="titular-1234abcd.json"', id)).toBe('titular-1234abcd.json');
    expect(exportFilename('attachment; filename=outro.json', id)).toBe('outro.json');
  });
  it('cai no nome padrão sem cabeçalho', () => {
    expect(exportFilename(undefined, id)).toBe('titular-1234abcd.json');
    expect(exportFilename('', id)).toBe('titular-1234abcd.json');
    expect(exportFilename('attachment', id)).toBe('titular-1234abcd.json');
  });
});
