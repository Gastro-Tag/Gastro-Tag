import { useCallback, useEffect, useState } from 'react';
import { labelApi } from '@/services';
import { extractError } from '@/services/api';
import type { DueLabels, DueLabelsMeta } from '@/types';

/** Descarte do dia: etiquetas ativas vencidas, de hoje e de amanhã (grupos pela data da cozinha, no servidor). */
export function useDueLabels(refreshMs = 0) {
  const [data, setData] = useState<DueLabels | null>(null);
  const [meta, setMeta] = useState<DueLabelsMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const { data: body } = await labelApi.due();
      setData(body.data);
      setMeta(body.meta);
      setError('');
    } catch (err) {
      setError(extractError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  useEffect(() => {
    if (!refreshMs) return;
    const id = window.setInterval(() => { void reload(); }, refreshMs);
    return () => window.clearInterval(id);
  }, [refreshMs, reload]);

  return { data, meta, loading, error, reload };
}
