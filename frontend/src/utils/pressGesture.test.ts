import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPressGesture } from './pressGesture';

describe('createPressGesture', () => {
  const onTap = vi.fn();
  const onLongPress = vi.fn();
  const make = () => createPressGesture({ delayMs: 1500, onTap, onLongPress });

  beforeEach(() => {
    vi.useFakeTimers();
    onTap.mockClear();
    onLongPress.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it('toque curto chama onTap e não o long-press', () => {
    const g = make();
    g.start();
    vi.advanceTimersByTime(300);
    g.end();
    vi.advanceTimersByTime(5000);
    expect(onTap).toHaveBeenCalledTimes(1);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('segurar dispara o long-press e soltar depois não chama onTap', () => {
    const g = make();
    g.start();
    vi.advanceTimersByTime(1500);
    expect(onLongPress).toHaveBeenCalledTimes(1);
    g.end();
    expect(onTap).not.toHaveBeenCalled();
  });

  it('cancelar (dedo saiu) não chama nada, nem depois do tempo', () => {
    const g = make();
    g.start();
    vi.advanceTimersByTime(500);
    g.cancel();
    vi.advanceTimersByTime(5000);
    g.end();
    expect(onTap).not.toHaveBeenCalled();
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('soltar sem ter começado não faz nada', () => {
    make().end();
    expect(onTap).not.toHaveBeenCalled();
  });

  it('um novo gesto depois de um long-press volta a funcionar', () => {
    const g = make();
    g.start();
    vi.advanceTimersByTime(1500);
    g.end();
    g.start();
    g.end();
    expect(onLongPress).toHaveBeenCalledTimes(1);
    expect(onTap).toHaveBeenCalledTimes(1);
  });
});
