import { useEffect, useState } from 'react';
import { authApi, equipmentApi } from '@/services';
import { countMissingToday } from '@/utils/equipment';

export interface EquipmentSummary {
  /** Registro de temperatura ligado na cozinha. Falha ao ler = false (o botão some). */
  enabled: boolean;
  /** Equipamentos sem leitura hoje; null se ainda não carregou ou a lista falhou. */
  missing: number | null;
}

/** Atalho "Temperaturas" do totem: lê o interruptor em GET /auth/me e, ligado, a contagem de GET /equipment/today. */
export function useEquipmentSummary(refreshMs = 0): EquipmentSummary {
  const [state, setState] = useState<EquipmentSummary>({ enabled: false, missing: null });

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const { data } = await authApi.me();
        const source = data.meta ?? data.data;
        if (source?.equipmentTemperatureEnabled !== true) {
          if (active) setState({ enabled: false, missing: null });
          return;
        }
        if (active) setState((prev) => ({ enabled: true, missing: prev.missing }));
        try {
          const { data: today } = await equipmentApi.today();
          if (active) setState({ enabled: true, missing: countMissingToday(today.data) });
        } catch {
          if (active) setState((prev) => ({ enabled: true, missing: prev.missing }));
        }
      } catch {
        if (active) setState({ enabled: false, missing: null });
      }
    }
    void load();
    if (!refreshMs) return () => { active = false; };
    const id = window.setInterval(() => { void load(); }, refreshMs);
    return () => { active = false; window.clearInterval(id); };
  }, [refreshMs]);

  return state;
}
