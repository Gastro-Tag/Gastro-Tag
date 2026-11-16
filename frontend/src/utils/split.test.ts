import { beforeEach, describe, expect, it, vi } from 'vitest';

const registerPrint = vi.fn();
const printLabel = vi.fn();
vi.mock('@/services', () => ({ labelApi: { registerPrint: (id: string) => registerPrint(id) } }));
vi.mock('./printLabel', () => ({ printLabel: (...args: unknown[]) => printLabel(...args) }));

import { printSplitChildren } from './split';

const result = (children: any[]): any => ({ parent: { id: 'p1', shortCode: 'PAI-1' }, children });

beforeEach(() => {
  registerPrint.mockReset().mockResolvedValue(undefined);
  printLabel.mockReset();
});

describe('printSplitChildren', () => {
  it('imprime todas as filhas em um único trabalho, 1 cópia', async () => {
    await printSplitChildren(result([{ id: 'a' }, { id: 'b' }]), 'logo.png');
    expect(printLabel).toHaveBeenCalledTimes(1);
    const [children, logo, copies] = printLabel.mock.calls[0];
    expect(children.map((c: any) => c.id)).toEqual(['a', 'b']);
    expect(logo).toBe('logo.png');
    expect(copies).toBe(1);
  });
  it('preenche parent e fractionedAt quando o servidor não devolve', async () => {
    await printSplitChildren(result([{ id: 'a' }]), null, '2026-11-15');
    const [child] = printLabel.mock.calls[0][0];
    expect(child.parent).toEqual({ id: 'p1', shortCode: 'PAI-1' });
    expect(child.fractionedAt).toBe('2026-11-15');
  });
  it('preserva parent e fractionedAt vindos do servidor', async () => {
    const parent = { id: 'x', shortCode: 'X' };
    await printSplitChildren(result([{ id: 'a', parent, fractionedAt: '2026-11-10' }]), null, '2026-11-15');
    const [child] = printLabel.mock.calls[0][0];
    expect(child.parent).toBe(parent);
    expect(child.fractionedAt).toBe('2026-11-10');
  });
  it('registra a impressão de cada filha e tolera falha de uma', async () => {
    registerPrint.mockRejectedValueOnce(new Error('rede'));
    await expect(printSplitChildren(result([{ id: 'a' }, { id: 'b' }]), null)).resolves.toBeUndefined();
    expect(registerPrint.mock.calls.map((c) => c[0])).toEqual(['a', 'b']);
  });
});
