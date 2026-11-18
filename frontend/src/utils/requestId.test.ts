import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ENTRY_TTL_MS, createRequestKeeper } from './requestId';

const KEY = 'gastrotag:requestId:teste';
const payload = { productId: 'p1', lot: 'L1', storageTemperature: 4 };

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.useRealTimers());

describe('createRequestKeeper', () => {
  it('mantém o id para o mesmo pedido e troca quando o formulário muda', () => {
    const keeper = createRequestKeeper();
    const first = keeper.idFor(payload);
    expect(keeper.idFor({ ...payload })).toBe(first);
    expect(keeper.idFor({ ...payload, storageTemperature: 5 })).not.toBe(first);
  });

  it('reset gera id novo para o mesmo pedido', () => {
    const keeper = createRequestKeeper();
    const first = keeper.idFor(payload);
    keeper.reset();
    expect(keeper.idFor(payload)).not.toBe(first);
  });

  it('sobrevive a um reload (novo keeper) com a mesma assinatura', () => {
    const id = createRequestKeeper(KEY).idFor(payload);
    expect(createRequestKeeper(KEY).idFor(payload)).toBe(id);
  });

  it('gera id novo no reload se o formulário mudou', () => {
    const id = createRequestKeeper(KEY).idFor(payload);
    expect(createRequestKeeper(KEY).idFor({ ...payload, lot: 'L2' })).not.toBe(id);
  });

  it('reset limpa a entrada guardada', () => {
    const keeper = createRequestKeeper(KEY);
    const id = keeper.idFor(payload);
    keeper.reset();
    expect(sessionStorage.getItem(KEY)).toBeNull();
    expect(createRequestKeeper(KEY).idFor(payload)).not.toBe(id);
  });

  it('entrada vencida no storage gera id novo e é apagada', () => {
    vi.useFakeTimers();
    const id = createRequestKeeper(KEY).idFor(payload);
    vi.advanceTimersByTime(ENTRY_TTL_MS + 1000);
    expect(createRequestKeeper(KEY).idFor(payload)).not.toBe(id);
  });

  it('entrada dentro do prazo é reaproveitada', () => {
    vi.useFakeTimers();
    const id = createRequestKeeper(KEY).idFor(payload);
    vi.advanceTimersByTime(ENTRY_TTL_MS - 1000);
    expect(createRequestKeeper(KEY).idFor(payload)).toBe(id);
  });

  it('id em memória também vence após o prazo', () => {
    vi.useFakeTimers();
    const keeper = createRequestKeeper(KEY);
    const id = keeper.idFor(payload);
    vi.advanceTimersByTime(ENTRY_TTL_MS + 1000);
    expect(keeper.idFor(payload)).not.toBe(id);
  });

  it('chaves de fluxos diferentes não se misturam', () => {
    const a = createRequestKeeper('gastrotag:requestId:a').idFor(payload);
    expect(createRequestKeeper('gastrotag:requestId:b').idFor(payload)).not.toBe(a);
  });

  it('ignora conteúdo inválido guardado', () => {
    sessionStorage.setItem(KEY, '{lixo');
    expect(createRequestKeeper(KEY).idFor(payload)).toMatch(/^[0-9a-f-]{36}$/);
    sessionStorage.setItem(KEY, JSON.stringify({ signature: 1 }));
    expect(createRequestKeeper(KEY).idFor(payload)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('com storage que falha, volta ao comportamento em memória', () => {
    const broken = {
      getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); }, removeItem() { throw new Error('x'); },
    } as unknown as Storage;
    const keeper = createRequestKeeper(KEY, broken);
    const id = keeper.idFor(payload);
    expect(keeper.idFor(payload)).toBe(id);
    expect(() => keeper.reset()).not.toThrow();
    expect(keeper.idFor(payload)).not.toBe(id);
  });
});
