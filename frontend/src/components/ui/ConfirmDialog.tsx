import { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/utils/cn';

interface ConfirmDialogProps {
  open:      boolean;
  title:     string;
  body:      ReactNode;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel:  () => void;
  danger?:   boolean;
}

export function ConfirmDialog({
  open, title, body, confirmLabel = 'Confirmar',
  onConfirm, onCancel, danger = false,
}: ConfirmDialogProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-card-lg border border-slate-200/80">
        <div className="flex gap-4 items-start mb-4">
          {danger && (
            <div className="w-11 h-11 flex items-center justify-center rounded-2xl bg-rose-50 border border-rose-100 shrink-0 text-rose-600">
              <AlertTriangle className="w-5 h-5" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold text-charcoal-800">{title}</h2>
            <div className="text-xs text-slate-500 mt-1 leading-relaxed">{body}</div>
          </div>
        </div>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button className="btn btn-outline w-full sm:w-auto text-xs" onClick={onCancel}>
            Cancelar
          </button>
          <button
            className={cn(danger ? 'btn btn-danger' : 'btn btn-primary', 'w-full sm:w-auto text-xs')}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
