import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { contingencyApi } from '@/services';
import { subscribeApiActivity } from '@/services/api';
import { clearPending, loadPendingOutage, markOffline, savePending, takeOutage } from '@/utils/outage';

/** Toque até 60 s antes da falha conta como uso do totem durante a queda. */
const RECENT_USE_MS = 60_000;

/**
 * Plano B no totem: mede a queda de rede e avisa o gerente pelo servidor.
 * Só observa: nunca bloqueia nem altera nenhuma chamada, e qualquer falha aqui é silenciosa.
 * Devolve a duração a mostrar no aviso (ms) e a função que o dispensa.
 */
export function useOutageTracker(): { noticeMs: number | null; dismiss: () => void } {
  const [noticeMs, setNoticeMs] = useState<number | null>(null);

  useEffect(() => {
    let sending = false;
    let lastInteraction = 0;
    const onInteraction = () => { lastInteraction = Date.now(); };
    const usedRecently = () => Date.now() - lastInteraction <= RECENT_USE_MS;

    async function send() {
      if (sending) return;
      const pending = loadPendingOutage(Date.now());
      if (pending === null) return;
      sending = true;
      try {
        await contingencyApi.reportOutage(pending.durationMs, pending.endedAgoMs);
        clearPending();
      } catch (err) {
        // Rede, 5xx, 401 (a renovação da sessão cuida) e 429 tentam de novo na próxima resposta de sucesso;
        // outro 4xx não vai mudar e descartar evita repetir para sempre.
        const status = axios.isAxiosError(err) ? err.response?.status : undefined;
        if (status && status >= 400 && status < 500 && status !== 401 && status !== 408 && status !== 429) clearPending();
      } finally {
        sending = false;
      }
    }

    function recovered() {
      const now = Date.now();
      const durationMs = takeOutage(now);
      if (durationMs !== null) {
        savePending(durationMs, now); // fica guardada até o POST dar certo
        setNoticeMs(durationMs);
      }
      void send();
    }

    const onOffline = () => markOffline(Date.now(), usedRecently());
    window.addEventListener('offline', onOffline);
    window.addEventListener('pointerdown', onInteraction, { capture: true, passive: true });
    window.addEventListener('keydown', onInteraction, { capture: true, passive: true });
    window.addEventListener('online', recovered);
    const unsubscribe = subscribeApiActivity((activity) => {
      if (activity === 'network-error') markOffline(Date.now(), usedRecently());
      else recovered();
    });
    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', recovered);
      window.removeEventListener('pointerdown', onInteraction, { capture: true });
      window.removeEventListener('keydown', onInteraction, { capture: true });
      unsubscribe();
    };
  }, []);

  const dismiss = useCallback(() => setNoticeMs(null), []);
  return { noticeMs, dismiss };
}
