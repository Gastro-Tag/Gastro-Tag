import { AlertTriangle } from 'lucide-react';

interface LoadErrorProps {
  title: string;
  message?: string;
  onRetry: () => void;
}

/** Falha ao carregar dados (rede, servidor): mensagem + "Tentar de novo". */
export function LoadError({ title, message, onRetry }: LoadErrorProps) {
  return (
    <div role="alert" className="card flex flex-col items-center gap-3 p-8 text-center">
      <AlertTriangle className="h-8 w-8 text-rose-500" aria-hidden="true" />
      <p className="font-semibold text-rose-600">{title}</p>
      {message && <p className="max-w-md text-sm text-slate-500">{message}</p>}
      <button type="button" className="btn btn-primary" onClick={onRetry}>Tentar de novo</button>
    </div>
  );
}
