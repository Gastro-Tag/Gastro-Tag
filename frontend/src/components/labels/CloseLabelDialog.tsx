import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { labelApi } from '@/services';
import { extractError } from '@/services/api';
import type { CloseLabelResult, DiscardReason, Label, LabelChild, LabelOutcome } from '@/types';
import { formatBR } from '@/utils/date';
import { OUTCOME_LABEL, REASON_LABEL, REASON_OPTIONS } from '@/utils/labelStatus';
import { cn } from '@/utils/cn';

interface Props {
  label: Label;
  isAdmin: boolean;
  onClose: () => void;
  onClosed: (result: CloseLabelResult) => void;
  /** Destino já marcado ao abrir (ex.: "Descartei" no descarte do dia). O usuário só confirma. */
  initialOutcome?: LabelOutcome;
  /** Motivo já marcado ao abrir; só vale com destino Descartado. */
  initialReason?: DiscardReason;
}

const OUTCOME_HELP: Record<LabelOutcome, string> = {
  USADO: 'O produto foi consumido ou usado na produção.',
  DESCARTADO: 'O produto foi jogado fora. Informe o motivo.',
  CANCELADO: 'A etiqueta foi gerada por engano. Só administradores.',
};

export function CloseLabelDialog({ label, isAdmin, onClose, onClosed, initialOutcome = 'USADO', initialReason }: Props) {
  const [outcome, setOutcome] = useState<LabelOutcome>(initialOutcome);
  const [reason, setReason] = useState<DiscardReason | ''>(initialOutcome === 'DESCARTADO' ? (initialReason ?? '') : '');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [children, setChildren] = useState<Pick<LabelChild, 'id' | 'shortCode' | 'discardAt'>[]>([]);
  const [moreChildren, setMoreChildren] = useState(false);

  // Filhas ainda ativas: o aviso aparece antes de confirmar. Elas não são encerradas junto.
  useEffect(() => {
    let active = true;
    labelApi.list({ parentLabelId: label.id, status: 'ATIVA', limit: 50 })
      .then(({ data }) => { if (active) { setChildren(data.data); setMoreChildren(data.meta.total > data.data.length); } })
      .catch(() => { /* o servidor devolve meta.activeChildren ao encerrar */ });
    return () => { active = false; };
  }, [label.id]);

  const outcomes: LabelOutcome[] = isAdmin ? ['USADO', 'DESCARTADO', 'CANCELADO'] : ['USADO', 'DESCARTADO'];
  const needsReason = outcome === 'DESCARTADO';
  const needsNote = needsReason && reason === 'OUTRO';
  const noteOk = !needsNote || note.trim().length >= 3;
  const canSubmit = !submitting && (!needsReason || reason !== '') && noteOk;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError('');
    try {
      const { data } = await labelApi.close(label.id, {
        outcome,
        discardReason: needsReason && reason ? reason : undefined,
        note: note.trim() || undefined,
      });
      onClosed(data);
    } catch (err) {
      setError(extractError(err));
      setSubmitting(false);
    }
  }

  return (
    <Modal title={`Encerrar etiqueta ${label.shortCode}`} onClose={onClose} widthClass="max-w-lg" busy={submitting}>
      <form
        className="space-y-4"
        onSubmit={(event) => { event.preventDefault(); void submit(); }}
      >
        <p className="text-sm text-slate-500">
          {label.productName ?? label.product?.name} · Descarte previsto {formatBR(label.discardAt)}. Esta ação não pode ser desfeita.
        </p>

        <fieldset>
          <legend className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">Destino</legend>
          <div className="space-y-2">
            {outcomes.map((item) => (
              <label
                key={item}
                className={cn(
                  'flex min-h-[48px] cursor-pointer items-start gap-3 rounded-xl border-2 p-3',
                  outcome === item ? 'border-brand-500 bg-orange-50/50' : 'border-slate-200 bg-white',
                )}
              >
                <input
                  type="radio" name="outcome" className="mt-1 h-4 w-4 accent-brand-600"
                  checked={outcome === item}
                  onChange={() => { setOutcome(item); setError(''); }}
                />
                <span>
                  <span className="block text-sm font-bold text-charcoal-800">{OUTCOME_LABEL[item]}</span>
                  <span className="block text-xs text-slate-500">{OUTCOME_HELP[item]}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {needsReason && (
          <div>
            <label htmlFor="close-reason" className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-400">
              Motivo do descarte
            </label>
            <select
              id="close-reason" className="input min-h-[44px]" required
              value={reason} onChange={(e) => setReason(e.target.value as DiscardReason | '')}
            >
              <option value="">Selecione o motivo…</option>
              {REASON_OPTIONS.map((item) => <option key={item} value={item}>{REASON_LABEL[item]}</option>)}
            </select>
          </div>
        )}

        {(needsReason || outcome === 'CANCELADO' || outcome === 'USADO') && (
          <div>
            <label htmlFor="close-note" className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-400">
              Observação {needsNote ? '(obrigatória)' : '(opcional)'}
            </label>
            <textarea
              id="close-note" className="input min-h-[72px]" maxLength={300} rows={2}
              value={note} onChange={(e) => setNote(e.target.value)}
              aria-invalid={needsNote && !noteOk}
              placeholder={needsNote ? 'Descreva o motivo (mínimo 3 caracteres)' : 'Ex.: usado no almoço'}
            />
          </div>
        )}

        {children.length > 0 && (
          <div role="alert" className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <span>
              Esta etiqueta tem filhas ainda ativas: {children.map((child) => `${child.shortCode} (descarte ${formatBR(child.discardAt)})`).join(', ')}.
              {moreChildren && ' Há mais filhas ativas além das listadas.'}
              {' '}Elas continuam ativas e precisam ser encerradas separadamente.
            </span>
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700">{error}</p>
        )}

        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={submitting}>Cancelar</button>
          <button type="submit" className={outcome === 'USADO' ? 'btn btn-primary' : 'btn btn-danger'} disabled={!canSubmit}>
            {submitting && <Spinner size="sm" className="text-white" />}
            {outcome === 'USADO' ? 'Marcar como usado' : outcome === 'DESCARTADO' ? 'Confirmar descarte' : 'Cancelar etiqueta'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
