/**
 * Gesto de toque curto x segurar, sem dependência de React (testável com timers falsos).
 * - soltar antes de `delayMs` chama `onTap`;
 * - segurar `delayMs` chama `onLongPress` e o soltar seguinte não chama `onTap`;
 * - cancelar (dedo saiu do elemento / gesto interrompido) não chama nada.
 * Só `end` dispara o toque, então não há navegação dupla com `click`.
 */
export interface PressGestureOptions {
  delayMs: number;
  onTap: () => void;
  onLongPress: () => void;
}

export function createPressGesture({ delayMs, onTap, onLongPress }: PressGestureOptions) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let active = false;

  const clear = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  return {
    start() {
      clear();
      active = true;
      timer = setTimeout(() => {
        timer = null;
        active = false; // o long-press já foi tratado: o soltar não vira toque
        onLongPress();
      }, delayMs);
    },
    end() {
      if (!active) return;
      active = false;
      clear();
      onTap();
    },
    cancel() {
      active = false;
      clear();
    },
  };
}
