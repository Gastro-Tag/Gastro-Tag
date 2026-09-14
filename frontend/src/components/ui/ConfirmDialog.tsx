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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-card-lg w-full max-w-md p-6 animate-in zoom-in-95">
        <div className="flex gap-3 items-start mb-3">
          {danger && (
            <div className="w-10 h-10 flex items-center justify-center rounded-full bg-red-100 flex-shrink-0">
              <AlertTriangle className="w-5 h-5 text-red-600" />
            </div>
          )}
          <div>
            <h2 className="text-base font-semibold text-slate-900">{title}</h2>
            <div className="text-sm text-slate-500 mt-1">{body}</div>
          </div>
        </div>
        <div className="flex gap-2 justify-end mt-5">
          <button className="btn-outline" onClick={onCancel}>Cancelar</button>
          <button
            className={cn(danger ? 'btn-danger' : 'btn-primary', 'btn')}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
