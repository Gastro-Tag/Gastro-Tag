import React, { createContext, useContext, ReactNode } from 'react';
import { CheckCircle2, AlertCircle, Info, AlertTriangle, X } from 'lucide-react';
import { useToast, Toast, ToastType } from '@/hooks/useToast';
import { cn } from '@/utils/cn';

// ── Context ──────────────────────────────────────────────
interface ToastContextValue {
  toast: (message: string, type?: ToastType) => void;
}
const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

export function useToastContext() {
  return useContext(ToastContext);
}

// ── Provider ─────────────────────────────────────────────
export function ToastProvider({ children }: { children: ReactNode }) {
  const { toasts, toast, dismiss } = useToast();

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {/* Portal */}
      <div className="pointer-events-none fixed inset-x-4 bottom-4 z-[9999] flex flex-col gap-2.5 sm:inset-x-auto sm:bottom-6 sm:right-6">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// ── Item ─────────────────────────────────────────────────
const icons: Record<ToastType, React.ElementType> = {
  success: CheckCircle2,
  error:   AlertCircle,
  warning: AlertTriangle,
  info:    Info,
};

const styles: Record<ToastType, { iconColor: string; border: string }> = {
  success: { iconColor: 'text-emerald-600', border: 'border-emerald-200/80' },
  error:   { iconColor: 'text-rose-600',    border: 'border-rose-200/80' },
  warning: { iconColor: 'text-amber-600',   border: 'border-amber-200/80' },
  info:    { iconColor: 'text-sky-600',     border: 'border-sky-200/80' },
};

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const Icon = icons[toast.type];
  const style = styles[toast.type];

  return (
    <div
      className={cn(
        'pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-2xl shadow-card-lg bg-white border',
        'w-full min-w-0 max-w-sm break-words text-xs font-bold text-charcoal-800 sm:min-w-[280px]',
        style.border,
      )}
    >
      <Icon className={cn('w-4 h-4 shrink-0', style.iconColor)} />
      <span className="flex-1 leading-snug">{toast.message}</span>
      <button
        onClick={() => onDismiss(toast.id)}
        className="text-slate-400 hover:text-charcoal-800 p-1 rounded-lg transition-colors"
        aria-label="Fechar notificação"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
