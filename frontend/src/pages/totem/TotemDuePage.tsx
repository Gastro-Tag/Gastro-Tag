import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  AlertTriangle, ArrowLeft, CheckCircle2, PartyPopper, RefreshCw, ShieldCheck, Trash2, User, X,
} from 'lucide-react';
import { labelApi } from '@/services';
import { extractError } from '@/services/api';
import type { DiscardReason, Label, LabelOutcome } from '@/types';
import { Spinner } from '@/components/ui/Spinner';
import { Centered } from '@/pages/totem/TotemLabelPage';
import { useDueLabels } from '@/hooks/useDueLabels';
import { useTotemStore } from '@/store/totemStore';
import { daysBetween, formatBR } from '@/utils/date';
import { isHandlerInvalid } from '@/utils/handler';
import { REASON_LABEL } from '@/utils/labelStatus';
import { STORAGE_LABEL, getHandlerToken, getOperator } from '@/utils/totem';
import { cn } from '@/utils/cn';

type Notice = { text: string; tone: 'ok' | 'error' | 'warn' };
type Pending = { label: Label; outcome: LabelOutcome };

const REASON: DiscardReason = 'PRAZO_VENCIDO';

/** "Para descartar": etiquetas ativas vencidas e que vencem hoje, com destino em dois toques. */
export function TotemDuePage() {
  const navigate = useNavigate();
  const { operator, handlerToken, openOperatorSheet, syncOperator, invalidateOperator } = useTotemStore();
  const { data, meta, loading, error, reload } = useDueLabels();
  const [pending, setPending] = useState<Pending | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmError, setConfirmError] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);
  const lock = useRef(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 6_000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // Confirmação: foco inicial no botão principal, Esc fecha e Tab fica preso no painel.
  const isPending = pending !== null;
  useEffect(() => {
    if (!isPending) return;
    const previous = document.activeElement as HTMLElement | null;
    confirmRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (!lock.current) setPending(null);
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled])'));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement as HTMLElement | null;
      if (!current || !items.includes(current)) { event.preventDefault(); first.focus(); }
      else if (event.shiftKey && current === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && current === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previous?.focus?.(); };
  }, [isPending]);

  function ask(label: Label, outcome: LabelOutcome) {
    // O responsável do turno entra no registro: sem ele, pede antes de confirmar.
    if (!getOperator()) { syncOperator(); openOperatorSheet(); return; }
    setConfirmError('');
    setPending({ label, outcome });
  }

  async function confirm() {
    if (lock.current || !pending) return;
    const responsible = getOperator();
    if (!responsible) { syncOperator(); openOperatorSheet(); setPending(null); return; }
    lock.current = true;
    setSubmitting(true);
    setConfirmError('');
    const { label, outcome } = pending;
    try {
      // Com PIN confirmado, o servidor usa o nome do operador do token; sem ele, o nome do turno.
      const token = getHandlerToken();
      const { data: result } = await labelApi.close(label.id, {
        outcome,
        discardReason: outcome === 'DESCARTADO' ? REASON : undefined,
        ...(token ? { handlerToken: token } : { responsibleName: responsible }),
      });
      setPending(null);
      const children = result.meta?.activeChildren ?? [];
      setNotice(children.length > 0
        ? { tone: 'warn', text: `${label.shortCode} encerrada. As filhas ${children.map((child) => child.shortCode).join(', ')} continuam ativas e precisam ser encerradas.` }
        : { tone: 'ok', text: `${label.shortCode} registrada como ${outcome === 'USADO' ? 'usada' : 'descartada'}.` });
      await reload();
    } catch (err) {
      if (isHandlerInvalid(err)) {
        invalidateOperator(); // limpa o operador e pede o PIN de novo
        setPending(null);
        setNotice({ tone: 'error', text: extractError(err) });
      } else {
        setConfirmError(extractError(err));
        void reload(); // 409: a etiqueta pode já ter sido encerrada em outro aparelho
      }
    } finally {
      lock.current = false;
      setSubmitting(false);
    }
  }

  const header = (
    <div className="flex items-start gap-3 sm:gap-4">
      <button
        type="button" aria-label="Voltar" onClick={() => navigate('/totem')}
        className="flex h-14 w-14 shrink-0 touch-manipulation items-center justify-center rounded-2xl border-2 border-slate-200 bg-white active:scale-95 sm:h-20 sm:w-20"
      >
        <ArrowLeft className="h-7 w-7 sm:h-9 sm:w-9" />
      </button>
      <div className="min-w-0 flex-1 pt-0.5 sm:pt-1">
        <h1 className="break-words text-2xl font-extrabold leading-tight sm:text-4xl">Para descartar</h1>
        <p className="mt-1 break-words text-base font-medium text-slate-500 sm:text-xl">
          Etiquetas vencidas e que vencem hoje{meta ? ` · ${formatBR(meta.kitchenToday)}` : ''}
        </p>
      </div>
      <button
        type="button" aria-label="Atualizar lista" onClick={() => void reload()}
        className="flex h-14 w-14 shrink-0 touch-manipulation items-center justify-center rounded-2xl border-2 border-slate-200 bg-white active:scale-95 sm:h-20 sm:w-20"
      >
        <RefreshCw className={cn('h-6 w-6 sm:h-8 sm:w-8', loading && 'animate-spin')} />
      </button>
    </div>
  );

  if (!data || !meta) {
    if (error) {
      return (
        <Centered>
          <AlertTriangle className="h-16 w-16 text-rose-500" />
          <h1 className="text-2xl font-extrabold sm:text-3xl">Não foi possível carregar</h1>
          <p className="max-w-md text-lg text-slate-500 sm:text-xl">{error}</p>
          <div className="flex w-full max-w-md gap-3">
            <button type="button" className="btn btn-outline h-16 flex-1 text-lg font-extrabold" onClick={() => void reload()}>Tentar de novo</button>
            <button type="button" className="btn btn-primary h-16 flex-1 text-lg font-extrabold" onClick={() => navigate('/totem', { replace: true })}>Início</button>
          </div>
        </Centered>
      );
    }
    return <div className="flex h-full min-h-[50vh] items-center justify-center"><Spinner size="lg" /></div>;
  }

  const toDiscard = [...data.expired.map((label) => ({ label, expired: true })), ...data.today.map((label) => ({ label, expired: false }))];
  const hiddenCount = meta.counts.expired + meta.counts.today - toDiscard.length;

  return (
    <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col gap-3 p-3 sm:gap-5 sm:p-5">
      {header}

      {notice && (
        <div
          role="status"
          className={cn(
            'flex items-start gap-3 rounded-2xl border-2 p-3 text-base font-bold sm:p-4 sm:text-lg',
            notice.tone === 'ok' && 'border-emerald-300 bg-emerald-50 text-emerald-800',
            notice.tone === 'warn' && 'border-amber-300 bg-amber-50 text-amber-900',
            notice.tone === 'error' && 'border-rose-300 bg-rose-50 text-rose-800',
          )}
        >
          {notice.tone === 'ok' ? <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0" /> : <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0" />}
          <span className="min-w-0 flex-1 break-words">{notice.text}</span>
          <button type="button" aria-label="Fechar aviso" onClick={() => setNotice(null)} className="p-1"><X className="h-6 w-6" /></button>
        </div>
      )}

      {error && (
        <div role="alert" className="flex items-start gap-3 rounded-2xl border-2 border-rose-300 bg-rose-50 p-3 text-base font-bold text-rose-800 sm:p-4">
          <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0" />
          <span className="min-w-0 flex-1 break-words">Não foi possível atualizar a lista: {error}</span>
        </div>
      )}

      {toDiscard.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-3xl border border-slate-200 bg-white px-5 py-10 text-center sm:py-14">
          <PartyPopper className="h-14 w-14 text-emerald-500" />
          <h2 className="text-2xl font-extrabold">Nada para descartar agora</h2>
          <p className="max-w-md text-lg text-slate-500">Nenhuma etiqueta ativa vencida ou com vencimento hoje.</p>
        </div>
      ) : (
        <section aria-label="Etiquetas para descartar" className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-2">
          {toDiscard.map(({ label, expired }) => (
            <DueCard
              key={label.id} label={label} expired={expired} kitchenToday={meta.kitchenToday}
              onDiscard={() => ask(label, 'DESCARTADO')} onUsed={() => ask(label, 'USADO')}
            />
          ))}
        </section>
      )}

      {hiddenCount > 0 && (
        <p role="alert" className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-3 text-base font-semibold text-amber-900">
          Há mais {hiddenCount} etiquetas além das mostradas. Resolva estas e atualize a lista.
        </p>
      )}

      {data.tomorrow.length > 0 && (
        <section aria-label="Vencem amanhã" className="rounded-3xl border-2 border-slate-200 bg-white p-4 sm:p-5">
          <h2 className="text-lg font-extrabold text-slate-600 sm:text-xl">Vencem amanhã ({meta.counts.tomorrow})</h2>
          <p className="mb-2 text-base font-medium text-slate-400">Só para conferência: ainda não precisam ser descartadas.</p>
          <ul className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
            {data.tomorrow.map((label) => (
              <li key={label.id} className="flex min-w-0 items-baseline gap-2 text-base font-semibold sm:text-lg">
                <span className="truncate">{label.productName ?? label.product?.name ?? '—'}</span>
                <span className="shrink-0 font-mono text-sm font-bold text-slate-400">{label.shortCode}</span>
              </li>
            ))}
          </ul>
          {meta.counts.tomorrow > data.tomorrow.length && (
            <p className="mt-2 text-base font-semibold text-slate-400">Mostrando {data.tomorrow.length} de {meta.counts.tomorrow}.</p>
          )}
        </section>
      )}

      {pending && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/55" role="dialog" aria-modal="true" aria-label="Confirmar destino da etiqueta">
          <div ref={dialogRef} className="max-h-[100dvh] w-full max-w-3xl overflow-y-auto overscroll-contain rounded-t-3xl bg-slate-100 p-4 pb-5 shadow-2xl sm:rounded-t-[32px] sm:p-6 sm:pb-8 [@media(max-height:500px)]:rounded-none">
            <h2 className="text-2xl font-extrabold text-charcoal-800 sm:text-3xl">
              {pending.outcome === 'DESCARTADO' ? 'Confirmar descarte?' : 'Marcar como usada?'}
            </h2>
            <div className="mt-3 rounded-2xl border-2 border-slate-200 bg-white p-4">
              <div className="break-words text-xl font-extrabold sm:text-2xl">{pending.label.productName ?? pending.label.product?.name ?? '—'}</div>
              <div className="mt-1 break-words text-base font-medium text-slate-500 sm:text-lg">
                <span className="font-mono font-bold text-charcoal-800">{pending.label.shortCode}</span> · Lote {pending.label.lot} · Descarte previsto {formatBR(pending.label.discardAt)}
              </div>
              {pending.outcome === 'DESCARTADO' && (
                <div className="mt-2 text-base font-bold text-slate-600 sm:text-lg">Motivo: {REASON_LABEL[REASON]}</div>
              )}
              <div className="mt-2 flex items-center gap-2 text-base font-bold text-slate-600 sm:text-lg">
                {handlerToken ? <ShieldCheck className="h-5 w-5 text-emerald-600" /> : <User className="h-5 w-5 text-slate-400" />}
                Responsável: {operator}
              </div>
            </div>
            <p className="mt-2 text-base font-semibold text-slate-500">Não dá para desfazer depois.</p>

            {confirmError && (
              <div role="alert" className="mt-3 flex items-start gap-3 rounded-2xl border-2 border-rose-300 bg-rose-50 p-3 text-base font-bold text-rose-800 sm:p-4">
                <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0" />
                <span className="min-w-0 break-words">{confirmError}</span>
              </div>
            )}

            <div className="mt-4 flex gap-3">
              <button
                type="button" disabled={submitting} onClick={() => setPending(null)}
                className="btn btn-outline h-16 flex-1 text-lg font-extrabold sm:h-20 sm:text-xl"
              >
                Voltar
              </button>
              <button
                ref={confirmRef} type="button" disabled={submitting} onClick={() => void confirm()}
                className={cn('btn h-16 flex-[2] gap-2 text-lg font-extrabold sm:h-20 sm:text-xl', pending.outcome === 'DESCARTADO' ? 'btn-danger' : 'btn-accent')}
              >
                {submitting ? <Spinner size="sm" className="text-white" /> : pending.outcome === 'DESCARTADO' ? <Trash2 className="h-6 w-6" /> : <CheckCircle2 className="h-6 w-6" />}
                {pending.outcome === 'DESCARTADO' ? 'Confirmar descarte' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DueCard({ label, expired, kitchenToday, onDiscard, onUsed }: {
  label: Label; expired: boolean; kitchenToday: string; onDiscard: () => void; onUsed: () => void;
}) {
  const days = daysBetween(label.discardAt, kitchenToday);
  return (
    <div className={cn(
      'flex min-w-0 flex-col gap-3 rounded-3xl border-4 bg-white p-4 shadow-card sm:p-5',
      expired ? 'border-rose-300 bg-rose-50/60' : 'border-amber-300',
    )}>
      <div className="min-w-0">
        <div className="line-clamp-3 break-words text-xl font-extrabold leading-tight sm:text-2xl">{label.productName ?? label.product?.name ?? '—'}</div>
        <div className="mt-1 break-words text-base font-medium text-slate-500 sm:text-lg">
          <span className="font-mono font-bold text-charcoal-800">{label.shortCode}</span> · Lote {label.lot} · {STORAGE_LABEL[label.storageType]}
        </div>
        <div className={cn('mt-2 inline-block rounded-full px-3 py-1 text-base font-extrabold', expired ? 'bg-rose-600 text-white' : 'bg-amber-100 text-amber-900')}>
          {expired
            ? `Venceu em ${formatBR(label.discardAt)}${days > 0 ? ` · há ${days} ${days === 1 ? 'dia' : 'dias'}` : ''}`
            : 'Vence hoje'}
        </div>
      </div>
      <div className={cn('mt-auto grid gap-2 sm:gap-3', expired ? 'grid-cols-1' : 'grid-cols-2')}>
        <button type="button" onClick={onDiscard} className="btn btn-danger h-16 gap-2 text-lg font-extrabold sm:h-20 sm:text-xl">
          <Trash2 className="h-6 w-6" /> Descartei
        </button>
        {!expired && (
          <button type="button" onClick={onUsed} className="btn btn-outline h-16 text-lg font-extrabold sm:h-20 sm:text-xl">
            Usei
          </button>
        )}
      </div>
    </div>
  );
}
