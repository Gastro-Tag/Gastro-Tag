import React, { createContext, useContext, ReactNode } from 'react';
import { CheckCircle, AlertCircle, Info, AlertTriangle, X } from 'lucide-react';
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
      <div className="pointer-events-none fixed inset-x-4 bottom-4 z-[9999] flex flex-col gap-2 sm:inset-x-auto sm:bottom-6 sm:right-6">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// ── Item ─────────────────────────────────────────────────
const icons: Record<ToastType, React.ElementType> = {
  success: CheckCircle,
  error:   AlertCircle,
  warning: AlertTriangle,
  info:    Info,
};

const styles: Record<ToastType, string> = {
  success: 'bg-brand-700 text-white',
  error:   'bg-red-600 text-white',
  warning: 'bg-amber-500 text-white',
  info:    'bg-slate-800 text-white',
};

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const Icon = icons[toast.type];
  return (
    <div
      className={cn(
        'pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-lg shadow-card-lg',
        'w-full min-w-0 max-w-sm break-words text-sm font-medium sm:min-w-[260px]',
        styles[toast.type],
      )}
    >
      <Icon className="w-4 h-4 flex-shrink-0" />
      <span className="flex-1">{toast.message}</span>
      <button onClick={() => onDismiss(toast.id)} className="opacity-75 hover:opacity-100">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
