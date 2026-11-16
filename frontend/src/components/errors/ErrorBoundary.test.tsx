// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Boom(): never {
  throw new Error('falha de teste');
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('ErrorBoundary', () => {
  it('renderiza os filhos quando não há erro', () => {
    act(() => root.render(<ErrorBoundary area="panel"><p>tudo certo</p></ErrorBoundary>));
    expect(container.textContent).toContain('tudo certo');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('mostra a tela amigável em pt-BR sem vazar o detalhe técnico', () => {
    act(() => root.render(<ErrorBoundary area="panel"><Boom /></ErrorBoundary>));
    const text = container.textContent ?? '';
    expect(text).toContain('Algo deu errado');
    expect(text).toContain('Recarregar');
    expect(text).toContain('Voltar ao início');
    expect(text).not.toContain('falha de teste');
  });

  it('no totem volta sozinho para /totem após a inatividade', () => {
    vi.useFakeTimers();
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...original, assign, reload: vi.fn() } });
    try {
      act(() => root.render(<ErrorBoundary area="totem"><Boom /></ErrorBoundary>));
      expect(assign).not.toHaveBeenCalled();
      act(() => { vi.advanceTimersByTime(60_000); });
      expect(assign).toHaveBeenCalledWith('/totem');
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }
  });
});
