import { useState } from 'react';
import { useNavigate } from 'react-router';
import { AlarmClock, AlertTriangle, ArrowUpRight, CheckCircle2, RefreshCw, Trash2 } from 'lucide-react';
import { CloseLabelDialog } from '@/components/labels/CloseLabelDialog';
import { InlineLoader } from '@/components/ui/Spinner';
import { useToastContext } from '@/components/ui/Toast';
import { useDueLabels } from '@/hooks/useDueLabels';
import { useAuthStore } from '@/store/authStore';
import type { CloseLabelResult, DiscardReason, Label, LabelOutcome } from '@/types';
import { formatBR } from '@/utils/date';
import { cn } from '@/utils/cn';

const SHOWN = 5;

type Group = 'expired' | 'today' | 'tomorrow';

const GROUPS: { key: Group; title: string; tone: string; badge: string; link: string; linkText: string }[] = [
  { key: 'expired', title: 'Vencidas', tone: 'border-rose-200 bg-rose-50/50', badge: 'bg-rose-600 text-white', link: '/labels?status=ATIVA&due=expired', linkText: 'Ver no histórico' },
  { key: 'today', title: 'Vencem hoje', tone: 'border-amber-200 bg-amber-50/50', badge: 'bg-amber-500 text-white', link: '/labels?status=ATIVA&due=today', linkText: 'Ver no histórico' },
  { key: 'tomorrow', title: 'Vencem amanhã', tone: 'border-slate-200 bg-slate-50', badge: 'bg-slate-500 text-white', link: '/labels?status=ATIVA&due=upcoming', linkText: 'Ver próximas' },
];

type Closing = { label: Label; outcome: LabelOutcome; reason?: DiscardReason };

/** Bloco "Descarte do dia" do painel: etiquetas ativas vencidas, de hoje e de amanhã. */
export function DueTodayPanel() {
  const navigate = useNavigate();
  const { toast } = useToastContext();
  const isAdmin = useAuthStore((state) => state.user?.role) === 'ADMIN';
  const { data, meta, loading, error, reload } = useDueLabels();
  const [closing, setClosing] = useState<Closing | null>(null);

  function handleClosed(result: CloseLabelResult) {
    setClosing(null);
    toast(`Etiqueta ${result.data.shortCode} encerrada.`, 'success');
    const children = result.meta?.activeChildren ?? [];
    if (children.length > 0) {
      toast(`Atenção: as filhas ${children.map((child) => child.shortCode).join(', ')} continuam ativas e precisam ser encerradas separadamente.`, 'warning');
    }
    void reload();
  }

  return (
    <section className="card p-5 sm:p-6" aria-labelledby="due-today-title">
      <div className="mb-4 flex items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-rose-100 bg-rose-50 text-rose-600">
            <AlarmClock className="h-4 w-4" />
          </div>
          <div>
            <h3 id="due-today-title" className="text-base font-bold text-charcoal-800">Descarte do dia</h3>
            <p className="text-xs text-slate-400">
              Etiquetas ativas pela data da cozinha{meta ? ` (${formatBR(meta.kitchenToday)})` : ''}.
            </p>
          </div>
        </div>
        <button type="button" className="btn btn-outline btn-sm gap-1.5" onClick={() => void reload()} aria-label="Atualizar descarte do dia">
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          <span className="hidden sm:inline">Atualizar</span>
        </button>
      </div>

      {loading && !data ? (
        <InlineLoader text="Carregando descarte do dia…" />
      ) : error && !data ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1">{error}</span>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => void reload()}>Tentar de novo</button>
        </div>
      ) : data && meta ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {GROUPS.map((group) => {
            const items = data[group.key];
            const total = meta.counts[group.key];
            return (
              <div key={group.key} className={cn('flex flex-col rounded-2xl border p-3.5', group.tone)}>
                <div className="mb-2.5 flex items-center justify-between gap-2">
                  <h4 className="text-sm font-bold text-charcoal-800">{group.title}</h4>
                  <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-extrabold', group.badge)} aria-label={`${total} etiquetas`}>{total}</span>
                </div>

                {items.length === 0 ? (
                  <p className="flex items-center gap-1.5 py-3 text-xs font-medium text-slate-500">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" /> Nada por aqui.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {items.slice(0, SHOWN).map((label) => (
                      <li key={label.id} className="rounded-xl border border-slate-200 bg-white p-2.5">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-bold text-charcoal-800">{label.productName ?? label.product?.name ?? '—'}</div>
                          <div className="text-xs text-slate-500">
                            <span className="font-mono font-bold">{label.shortCode}</span> · Lote {label.lot} · Descarte {formatBR(label.discardAt)}
                          </div>
                        </div>
                        {group.key !== 'tomorrow' && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            <button
                              type="button" className="btn btn-danger btn-sm gap-1.5"
                              onClick={() => setClosing({ label, outcome: 'DESCARTADO', reason: 'PRAZO_VENCIDO' })}
                            >
                              <Trash2 className="h-3.5 w-3.5" /> Descartei
                            </button>
                            {group.key === 'today' && (
                              <button type="button" className="btn btn-outline btn-sm" onClick={() => setClosing({ label, outcome: 'USADO' })}>
                                Usei
                              </button>
                            )}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                {total > SHOWN && <p className="mt-2 text-xs font-semibold text-slate-500">Mostrando {SHOWN} de {total}.</p>}
                {total > 0 && (
                  <button
                    type="button" onClick={() => navigate(group.link)}
                    className="mt-2 inline-flex items-center gap-1 self-start text-xs font-bold text-brand-600 hover:text-brand-700"
                  >
                    {group.linkText} <ArrowUpRight className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : null}

      {error && data && (
        <p role="alert" className="mt-3 text-xs font-semibold text-rose-700">Não foi possível atualizar agora: {error}</p>
      )}

      {closing && (
        <CloseLabelDialog
          label={closing.label}
          isAdmin={isAdmin}
          initialOutcome={closing.outcome}
          initialReason={closing.reason}
          onClose={() => setClosing(null)}
          onClosed={handleClosed}
        />
      )}
    </section>
  );
}
