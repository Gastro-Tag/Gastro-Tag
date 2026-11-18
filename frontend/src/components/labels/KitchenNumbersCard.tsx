import { useCallback, useEffect, useState } from 'react';
import { Timer } from 'lucide-react';
import { labelApi } from '@/services';
import { extractError } from '@/services/api';
import { LoadError } from '@/components/ui/LoadError';
import { InlineLoader } from '@/components/ui/Spinner';
import { shiftDate, useKitchenInfo } from '@/hooks/useKitchenInfo';
import type { LabelMetrics } from '@/types';
import { formatBR } from '@/utils/date';
import { formatFlowSeconds, percentOf } from '@/utils/flowTime';
import { cn } from '@/utils/cn';

const PERIODS = [7, 14, 30] as const;

/** "Números da cozinha" (ADMIN): tempo do fluxo e origem da temperatura nos últimos 7, 14 ou 30 dias. */
export function KitchenNumbersCard() {
  const kitchen = useKitchenInfo();
  const [days, setDays] = useState<(typeof PERIODS)[number]>(7);
  const [data, setData] = useState<LabelMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tries, setTries] = useState(0);
  // Sete dias é o padrão do servidor (sem datas). Em 14 e 30 dias espera o "hoje" da cozinha; se ele não chegar em 3 s, usa o do aparelho.
  const today = kitchen?.kitchenToday;
  const [kitchenGaveUp, setKitchenGaveUp] = useState(false);
  useEffect(() => {
    if (today) return;
    const timer = window.setTimeout(() => setKitchenGaveUp(true), 3_000);
    return () => window.clearTimeout(timer);
  }, [today]);

  const retry = useCallback(() => setTries((value) => value + 1), []);

  useEffect(() => {
    let active = true;
    let params: { from: string; to: string } | undefined;
    if (days !== 7) {
      const base = today ?? (kitchenGaveUp ? new Date().toLocaleDateString('en-CA') : undefined);
      if (!base) return undefined; // espera o "hoje" da cozinha
      params = { from: shiftDate(base, -(days - 1)), to: base };
    }
    setLoading(true);
    setError('');
    labelApi.metrics(params)
      .then(({ data: body }) => { if (active) setData(body.data); })
      .catch((err) => { if (active) { setData(null); setError(extractError(err)); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [days, today, kitchenGaveUp, tries]);

  const share = data ? percentOf(data.suggestedCount, data.withTemperatureSource) : null;
  const rows = data ? [...data.byDay].reverse() : [];

  return (
    <section className="card p-5 sm:p-6" aria-labelledby="kitchen-numbers-title">
      <div className="mb-4 flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-brand-100 bg-brand-50 text-brand-700">
            <Timer className="h-4 w-4" aria-hidden="true" />
          </div>
          <div>
            <h2 id="kitchen-numbers-title" className="text-sm font-extrabold text-charcoal-800">Números da cozinha</h2>
            {data && <p className="text-xs text-slate-500">Período: {formatBR(data.from)} a {formatBR(data.to)}</p>}
          </div>
        </div>
        <div role="group" aria-label="Período" className="flex gap-1.5">
          {PERIODS.map((value) => (
            <button
              key={value} type="button" aria-pressed={days === value}
              onClick={() => setDays(value)}
              className={cn('btn btn-sm min-h-[44px] flex-1 sm:flex-none', days === value ? 'btn-primary' : 'btn-outline')}
            >
              {value} dias
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <InlineLoader text="Carregando números…" />
      ) : error ? (
        <LoadError title="Não foi possível carregar os números da cozinha." message={error} onRetry={retry} />
      ) : !data || data.total === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500">Nenhuma etiqueta neste período.</p>
      ) : (
        <>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Figure label="Etiquetas" value={String(data.total)} />
            <Figure label="Tempo mediano" value={formatFlowSeconds(data.flowMedianMs)} note={`${data.withFlow} medições`} />
            <Figure
              label="Tempo p90"
              value={data.withFlow < 10 ? 'poucas medições' : formatFlowSeconds(data.flowP90Ms)}
              note="9 de cada 10 levaram até isto"
              small={data.withFlow < 10}
            />
            <Figure
              label="Temperatura sugerida"
              value={share === null ? '—' : `${share}%`}
              note={`${data.suggestedCount} de ${data.withTemperatureSource} etiquetas com origem informada`}
            />
          </dl>
          <p className="mt-3 text-[11px] text-slate-400">
            Medido no totem, do toque no produto até criar a etiqueta (sem o diálogo de impressão). Etiquetas antigas não têm o dado de tempo nem de origem da temperatura.
          </p>
          {(data.discardedFlows ?? 0) > 0 && (
            <p className="mt-1 text-[11px] text-slate-400">{data.discardedFlows} medições acima de 10 min ignoradas.</p>
          )}

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[420px] text-left text-sm">
              <caption className="sr-only">Etiquetas, tempo mediano e origem da temperatura por dia</caption>
              <thead>
                <tr className="border-b border-slate-100 text-xs font-bold uppercase tracking-wider text-slate-400">
                  <th scope="col" className="py-2 pr-3">Dia</th>
                  <th scope="col" className="py-2 pr-3 text-right">Etiquetas</th>
                  <th scope="col" className="py-2 pr-3 text-right">Tempo mediano</th>
                  <th scope="col" className="py-2 pr-3 text-right">Sugerida</th>
                  <th scope="col" className="py-2 text-right">Digitada</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((day) => (
                  <tr key={day.date} className="border-b border-slate-50 last:border-0">
                    <th scope="row" className="py-2 pr-3 font-semibold text-charcoal-800">{formatBR(day.date)}</th>
                    <td className="py-2 pr-3 text-right tabular-nums">{day.total}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatFlowSeconds(day.flowMedianMs)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{day.suggestedCount}</td>
                    <td className="py-2 text-right tabular-nums">{day.typedCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function Figure({ label, value, note, small }: { label: string; value: string; note?: string; small?: boolean }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50/60 p-3">
      <dt className="text-xs font-bold text-slate-500">{label}</dt>
      <dd className={cn('mt-1 font-extrabold tabular-nums text-charcoal-800', small ? 'text-base leading-8 text-slate-500' : 'text-2xl')}>{value}</dd>
      {note && <p className="mt-0.5 text-[11px] text-slate-400">{note}</p>}
    </div>
  );
}
