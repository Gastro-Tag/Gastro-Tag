import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { contingencyApi } from '@/services';
import { subscribeApiActivity } from '@/services/api';
import { clearPending, loadPending, markOffline, savePending, takeOutage } from '@/utils/outage';

/**
 * Plano B no totem: mede a queda de rede e avisa o gerente pelo servidor.
 * Só observa: nunca bloqueia nem altera nenhuma chamada, e qualquer falha aqui é silenciosa.
 * Devolve a duração a mostrar no aviso (ms) e a função que o dispensa.
 */
export function useOutageTracker(): { noticeMs: number | null; dismiss: () => void } {
  const [noticeMs, setNoticeMs] = useState<number | null>(null);

  useEffect(() => {
    let sending = false;

    async function send() {
      if (sending) return;
      const durationMs = loadPending(Date.now());
      if (durationMs === null) return;
      sending = true;
      try {
        await contingencyApi.reportOutage(durationMs);
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

    const onOffline = () => markOffline(Date.now());
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', recovered);
    const unsubscribe = subscribeApiActivity((activity) => {
      if (activity === 'network-error') markOffline(Date.now());
      else recovered();
    });
    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', recovered);
      unsubscribe();
    };
  }, []);

  const dismiss = useCallback(() => setNoticeMs(null), []);
  return { noticeMs, dismiss };
}
