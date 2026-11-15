import { ReactNode, useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  title:    string;
  onClose:  () => void;
  children: ReactNode;
  /** Largura máxima do painel (classe Tailwind). */
  widthClass?: string;
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Diálogo acessível: foco entra ao abrir, fica preso no painel, Esc fecha e o foco volta ao gatilho. */
export function Modal({ title, onClose, children, widthClass = 'max-w-2xl' }: ModalProps) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const first = panel.current?.querySelector<HTMLElement>(`[data-modal-body] :is(${FOCUSABLE})`) ?? panel.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel.current)?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.stopPropagation(); onCloseRef.current(); return; }
      if (event.key !== 'Tab' || !panel.current) return;
      const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (!panel.current.contains(document.activeElement) || !items.includes(document.activeElement as HTMLElement)) {
        event.preventDefault();
        (event.shiftKey ? lastItem : firstItem).focus();
      } else if (event.shiftKey && document.activeElement === firstItem) { event.preventDefault(); lastItem.focus(); }
      else if (!event.shiftKey && document.activeElement === lastItem) { event.preventDefault(); firstItem.focus(); }
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`flex max-h-[100dvh] w-full ${widthClass} flex-col rounded-t-3xl border border-slate-200/80 bg-white shadow-card-lg outline-none sm:max-h-[92dvh] sm:rounded-3xl`}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4 sm:px-6">
          <h2 id={titleId} className="min-w-0 break-words text-base font-bold text-charcoal-800">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Fechar" className="btn btn-ghost btn-sm h-9 w-9 shrink-0 p-0">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div data-modal-body className="overflow-y-auto overscroll-contain px-5 py-4 sm:px-6 sm:py-5">{children}</div>
      </div>
    </div>
  );
}
