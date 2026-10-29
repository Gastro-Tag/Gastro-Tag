import { useState } from 'react';
import { TouchKeyboard, type Capitalize, type KeyboardLayout } from './TouchKeyboard';

interface KeyboardSheetProps {
  title: string;
  hint?: string;
  placeholder?: string;
  initialValue?: string;
  layout?: KeyboardLayout;
  capitalize?: Capitalize;
  maxLength?: number;
  required?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Chamado a cada toque (ex.: filtrar a lista enquanto digita). */
  onLiveChange?: (value: string) => void;
  onCancel: () => void;
  /** Retorne um texto para manter a janela aberta e mostrar o erro. */
  onConfirm: (value: string) => string | void;
}

export function KeyboardSheet({
  title, hint, placeholder, initialValue = '', layout = 'text', capitalize = 'none',
  maxLength = 60, required = true, confirmLabel = 'Confirmar', cancelLabel = 'Cancelar',
  onLiveChange, onCancel, onConfirm,
}: KeyboardSheetProps) {
  const [draft, setDraft] = useState(initialValue);
  const [error, setError] = useState('');

  function update(value: string) {
    setDraft(value);
    setError('');
    onLiveChange?.(value);
  }

  function confirm() {
    const result = onConfirm(draft);
    if (typeof result === 'string' && result) setError(result);
  }

  const blocked = required && draft.trim() === '';

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/55" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full max-w-5xl rounded-t-[32px] bg-slate-100 p-5 pb-6 shadow-2xl">
        <div className="mb-3 px-1">
          <h2 className="text-2xl font-extrabold text-charcoal-800">{title}</h2>
          {hint && <p className="mt-0.5 text-base font-medium text-slate-500">{hint}</p>}
        </div>

        <div className="mb-3 min-h-[72px] break-all rounded-2xl border-2 border-brand-500 bg-white px-5 py-3 text-3xl font-extrabold text-charcoal-800">
          {draft || <span className="font-semibold text-slate-300">{placeholder}</span>}
          <span className="ml-0.5 inline-block h-8 w-0.5 animate-pulse bg-brand-500 align-middle" />
        </div>

        {error && (
          <p className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-base font-bold text-rose-700">
            {error}
          </p>
        )}

        <TouchKeyboard value={draft} onChange={update} layout={layout} capitalize={capitalize} maxLength={maxLength} />

        <div className="mx-auto mt-4 flex w-full max-w-4xl gap-3">
          <button type="button" onClick={onCancel} className="btn btn-outline h-16 flex-1 text-lg">
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={blocked}
            className="btn btn-accent h-16 flex-[2] text-lg font-extrabold"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
