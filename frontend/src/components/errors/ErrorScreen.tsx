import { AlertTriangle } from 'lucide-react';
import { useIdle } from '@/hooks/useIdle';
import { cn } from '@/utils/cn';

export type ErrorArea = 'global' | 'panel' | 'totem';

const TOTEM_IDLE_MS = 60_000; // mesmo tempo do TotemShell

interface ErrorScreenProps {
  area: ErrorArea;
  /** Só para o console; a tela nunca mostra detalhes técnicos. */
  error?: unknown;
}

function homeFor(area: ErrorArea): string {
  return area === 'totem' ? '/totem' : '/';
}

/** Navegação completa: descarta o estado quebrado da memória. */
function goHome(area: ErrorArea) {
  window.location.assign(homeFor(area));
}

function TotemIdleReturn() {
  useIdle(TOTEM_IDLE_MS, () => goHome('totem'));
  return null;
}

/** Tela amigável para erro inesperado de renderização. Sem hooks de router: funciona fora do RouterProvider. */
export function ErrorScreen({ area, error }: ErrorScreenProps) {
  const totem = area === 'totem';
  const fullPage = area === 'global';
  if (error) console.error('Erro inesperado na interface:', error);

  return (
    <main
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center gap-4 px-4 text-center',
        fullPage ? 'min-h-screen' : totem ? 'min-h-full py-12' : 'py-20',
      )}
    >
      {totem && <TotemIdleReturn />}
      <AlertTriangle className={cn('text-rose-500', totem ? 'h-16 w-16' : 'h-12 w-12')} aria-hidden="true" />
      <h1 className={cn('font-extrabold text-charcoal-800', totem ? 'text-3xl' : 'text-2xl')}>
        Algo deu errado
      </h1>
      <p className={cn('max-w-md text-slate-500', totem ? 'text-lg' : 'text-sm')}>
        {totem
          ? 'Não foi possível mostrar esta tela. Toque em Recarregar ou volte ao início; a tela volta sozinha em instantes.'
          : 'Não foi possível mostrar esta tela. Recarregue a página ou volte ao início. Se o problema continuar, avise o administrador.'}
      </p>
      <div className={cn('flex flex-wrap items-center justify-center gap-3', totem && 'w-full max-w-md flex-col')}>
        <button
          type="button"
          className={cn('btn btn-primary', totem && 'h-16 w-full text-xl')}
          onClick={() => window.location.reload()}
        >
          Recarregar
        </button>
        <button
          type="button"
          className={cn('btn btn-outline', totem && 'h-16 w-full text-xl')}
          onClick={() => goHome(area)}
        >
          Voltar ao início
        </button>
      </div>
    </main>
  );
}
