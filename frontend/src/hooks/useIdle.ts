import { useEffect, useRef } from 'react';

const EVENTS: (keyof WindowEventMap)[] = ['pointerdown', 'keydown', 'touchstart'];

/** Dispara onIdle após `ms` sem nenhum toque/tecla. */
export function useIdle(ms: number, onIdle: () => void): void {
  const callback = useRef(onIdle);
  callback.current = onIdle;

  useEffect(() => {
    let timer = 0;
    const fire = () => callback.current();
    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(fire, ms);
    };

    reset();
    EVENTS.forEach((name) => window.addEventListener(name, reset, { passive: true }));
    return () => {
      window.clearTimeout(timer);
      EVENTS.forEach((name) => window.removeEventListener(name, reset));
    };
  }, [ms]);
}
