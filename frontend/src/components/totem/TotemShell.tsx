import { useEffect, useRef, useState } from 'react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, LogOut, User } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { useTotemStore } from '@/store/totemStore';
import { useIdle } from '@/hooks/useIdle';
import { cn } from '@/utils/cn';
import { AdminUnlockDialog } from './AdminUnlockDialog';
import { OperatorSheet } from './OperatorSheet';

const IDLE_MS = 60_000;        // volta ao início após 60 s sem toque
const LONG_PRESS_MS = 1_500;   // segurar o logo pede a senha do administrador

/** Protege as rotas do totem: exige sessão, mas não usa o layout administrativo. */
export function TotemRoute() {
  const { user, accessToken } = useAuthStore();
  if (!accessToken || !user) return <Navigate to="/totem/login" replace />;
  return <TotemShell />;
}

function TotemShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const logout = useAuthStore((state) => state.logout);
  const { operator, openOperatorSheet, syncOperator } = useTotemStore();
  const [adminMenu, setAdminMenu] = useState<'locked' | 'unlocked' | null>(null);
  const [now, setNow] = useState(() => new Date());
  const pressTimer = useRef(0);

  // Tela de totem: sem zoom por gesto, sem seleção de texto, sem menu de contexto.
  useEffect(() => {
    const meta = document.querySelector('meta[name="viewport"]');
    const previous = meta?.getAttribute('content') ?? null;
    meta?.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');
    document.body.classList.add('totem-mode');
    const blockMenu = (event: Event) => event.preventDefault();
    window.addEventListener('contextmenu', blockMenu);
    return () => {
      if (meta && previous !== null) meta.setAttribute('content', previous);
      document.body.classList.remove('totem-mode');
      window.removeEventListener('contextmenu', blockMenu);
    };
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(new Date());
      syncOperator();
    }, 15_000);
    return () => window.clearInterval(id);
  }, [syncOperator]);

  useIdle(IDLE_MS, () => {
    setAdminMenu(null); // o menu destravado nunca fica aberto em um totem sem ninguém
    window.dispatchEvent(new Event('totem:idle'));
    if (location.pathname !== '/totem') navigate('/totem', { replace: true });
  });

  const startPress = () => {
    window.clearTimeout(pressTimer.current);
    pressTimer.current = window.setTimeout(() => setAdminMenu('locked'), LONG_PRESS_MS);
  };
  const cancelPress = () => window.clearTimeout(pressTimer.current);

  const clock = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(now);
  const date = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(now);

  return (
    <div className="totem-root flex h-[100dvh] flex-col bg-[#F3F4F6] text-charcoal-800">
      <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-3 shadow-sm sm:h-20 sm:gap-4 sm:px-5 [@media(max-height:500px)]:h-14">
        <div
          className="flex shrink-0 select-none items-center gap-2 sm:gap-3"
          onPointerDown={startPress}
          onPointerUp={cancelPress}
          onPointerLeave={cancelPress}
          onPointerCancel={cancelPress}
        >
          <img src="/logo.png" alt="GastroTag" className="h-10 w-10 object-contain sm:h-12 sm:w-12" draggable={false} />
          <div className="leading-none">
            <div className="text-xl font-extrabold tracking-tight sm:text-2xl">
              Gastro<span className="text-brand-500">Tag</span>
            </div>
            <div className="mt-1 hidden text-[11px] font-bold uppercase tracking-widest text-slate-400 min-[400px]:block">Totem de etiquetas</div>
          </div>
        </div>

        <div className="hidden text-center md:block">
          <div className="text-3xl font-extrabold tabular-nums leading-none">{clock}</div>
          <div className="mt-1 text-sm font-medium capitalize text-slate-400">{date}</div>
        </div>

        <button
          type="button"
          onClick={openOperatorSheet}
          className={cn(
            'flex h-12 min-w-0 max-w-[55%] touch-manipulation items-center gap-2 rounded-2xl border-2 px-3 text-base font-bold active:scale-95 sm:h-14 sm:max-w-[45%] sm:gap-3 sm:px-5 sm:text-lg',
            operator
              ? 'border-slate-200 bg-slate-50 text-charcoal-800'
              : 'animate-pulse border-brand-500 bg-brand-50 text-brand-700',
          )}
        >
          <User className="h-5 w-5 shrink-0 sm:h-6 sm:w-6" />
          <span className="truncate">{operator || 'Informar responsável'}</span>
        </button>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <Outlet />
      </main>

      <OperatorSheet />

      {adminMenu === 'locked' && (
        <AdminUnlockDialog onUnlock={() => setAdminMenu('unlocked')} onCancel={() => setAdminMenu(null)} />
      )}

      {adminMenu === 'unlocked' && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-3 sm:p-6" role="dialog" aria-modal="true">
          <div className="max-h-full w-full max-w-md overflow-y-auto rounded-3xl bg-white p-4 shadow-2xl sm:p-6">
            <h2 className="text-2xl font-extrabold">Opções do totem</h2>
            <p className="mb-5 mt-1 text-base text-slate-500">Área do administrador.</p>
            <div className="flex flex-col gap-3">
              <button
                type="button"
                className="btn btn-primary h-14 text-lg sm:h-16"
                onClick={() => { setAdminMenu(null); navigate('/'); }}
              >
                <LayoutDashboard className="h-5 w-5" /> Abrir painel administrativo
              </button>
              <button
                type="button"
                className="btn btn-outline h-14 text-lg text-rose-600 sm:h-16"
                onClick={() => { logout(); navigate('/totem/login', { replace: true }); }}
              >
                <LogOut className="h-5 w-5" /> Encerrar sessão do totem
              </button>
              <button type="button" className="btn btn-ghost h-14 text-lg sm:h-16" onClick={() => setAdminMenu(null)}>
                Voltar ao totem
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
