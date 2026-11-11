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
  /** Como mostrar o texto digitado (ex.: barras em uma data). */
  displayValue?: (value: string) => string;
  /** Chamado a cada toque (ex.: filtrar a lista enquanto digita). */
  onLiveChange?: (value: string) => void;
  onCancel: () => void;
  /** Retorne um texto para manter a janela aberta e mostrar o erro. */
  onConfirm: (value: string) => string | void;
}

export function KeyboardSheet({
  title, hint, placeholder, initialValue = '', layout = 'text', capitalize = 'none',
  maxLength = 60, required = true, confirmLabel = 'Confirmar', cancelLabel = 'Cancelar',
  displayValue, onLiveChange, onCancel, onConfirm,
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
      {/* Altura limitada à tela (dvh) com rolagem interna; em celular deitado vira duas colunas: texto à esquerda, teclado à direita. */}
      <div className="max-h-[100dvh] w-full max-w-5xl overflow-y-auto overscroll-contain rounded-t-3xl bg-slate-100 p-3 pb-4 shadow-2xl sm:rounded-t-[32px] sm:p-5 sm:pb-6 [@media(max-height:500px)]:grid [@media(max-height:500px)]:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] [@media(max-height:500px)]:content-start [@media(max-height:500px)]:gap-x-3 [@media(max-height:500px)]:rounded-none [@media(max-height:500px)]:p-2 [@media(max-height:500px)]:pb-2">
        <div className="mb-2 px-1 sm:mb-3 [@media(max-height:500px)]:col-start-1 [@media(max-height:500px)]:mb-1">
          <h2 className="text-xl font-extrabold text-charcoal-800 sm:text-2xl">{title}</h2>
          {hint && <p className="mt-0.5 text-sm font-medium text-slate-500 sm:text-base">{hint}</p>}
        </div>

        <div className="mb-2 min-h-[56px] break-all rounded-2xl border-2 border-brand-500 bg-white px-4 py-2 text-2xl font-extrabold text-charcoal-800 sm:mb-3 sm:min-h-[72px] sm:px-5 sm:py-3 sm:text-3xl [@media(max-height:500px)]:col-start-1 [@media(max-height:500px)]:mb-1 [@media(max-height:500px)]:min-h-[48px]">
          {draft ? (displayValue?.(draft) ?? draft) : <span className="font-semibold text-slate-300">{placeholder}</span>}
          <span className="ml-0.5 inline-block h-6 w-0.5 sm:h-8 animate-pulse bg-brand-500 align-middle" />
        </div>

        {error && (
          <p role="alert" className="mb-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700 sm:mb-3 sm:px-4 sm:py-2.5 sm:text-base [@media(max-height:500px)]:col-start-1 [@media(max-height:500px)]:mb-1">
            {error}
          </p>
        )}

        <div className="[@media(max-height:500px)]:col-start-2 [@media(max-height:500px)]:row-span-4 [@media(max-height:500px)]:row-start-1">
          <TouchKeyboard value={draft} onChange={update} layout={layout} capitalize={capitalize} maxLength={maxLength} />
        </div>

        <div className="mx-auto mt-3 flex w-full max-w-4xl gap-2 sm:mt-4 sm:gap-3 [@media(max-height:500px)]:col-start-1 [@media(max-height:500px)]:mt-1">
          <button type="button" onClick={onCancel} className="btn btn-outline h-12 flex-1 px-2 text-base leading-tight sm:h-16 sm:text-lg [@media(max-height:500px)]:h-11 [@media(max-height:500px)]:flex-[3]">
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={blocked}
            className="btn btn-accent h-12 flex-[2] px-2 text-base font-extrabold leading-tight sm:h-16 sm:text-lg [@media(max-height:500px)]:h-11 [@media(max-height:500px)]:flex-[4]"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
