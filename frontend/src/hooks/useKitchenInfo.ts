import { useEffect, useState } from 'react';
import { authApi } from '@/services';
import type { KitchenInfo } from '@/types';

/** "Hoje" da cozinha e o limite de dias para trás da abertura (GET /auth/me). Nulo enquanto carrega ou se falhar. */
export function useKitchenInfo(): KitchenInfo | null {
  const [info, setInfo] = useState<KitchenInfo | null>(null);

  useEffect(() => {
    let active = true;
    authApi.me()
      .then(({ data }) => {
        // O contrato permite `meta` ao lado de `data`, ou os campos dentro de `data`.
        const source = data.meta ?? data.data;
        if (typeof source?.kitchenToday === 'string' && typeof source.maxBackdateDays === 'number') {
          if (active) setInfo({ kitchenToday: source.kitchenToday, maxBackdateDays: source.maxBackdateDays });
        }
      })
      .catch(() => { /* sem o limite no formulário, o servidor continua validando */ });
    return () => { active = false; };
  }, []);

  return info;
}

/** YYYY-MM-DD menos N dias (calendário UTC). */
export function shiftDate(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
