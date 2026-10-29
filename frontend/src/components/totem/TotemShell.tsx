import { useEffect, useRef, useState } from 'react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, LogOut, User } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { useTotemStore } from '@/store/totemStore';
import { useIdle } from '@/hooks/useIdle';
import { cn } from '@/utils/cn';
import { OperatorSheet } from './OperatorSheet';

const IDLE_MS = 60_000;        // volta ao início após 60 s sem toque
const LONG_PRESS_MS = 1_500;   // segurar o logo abre o menu do administrador

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
  const { operator, openOperatorSheet } = useTotemStore();
  const [menuOpen, setMenuOpen] = useState(false);
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
    const id = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(id);
  }, []);

  useIdle(IDLE_MS, () => {
    window.dispatchEvent(new Event('totem:idle'));
    if (location.pathname !== '/totem') navigate('/totem', { replace: true });
  });

  const startPress = () => {
    window.clearTimeout(pressTimer.current);
    pressTimer.current = window.setTimeout(() => setMenuOpen(true), LONG_PRESS_MS);
  };
  const cancelPress = () => window.clearTimeout(pressTimer.current);

  const clock = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(now);
  const date = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(now);

  return (
    <div className="totem-root flex h-[100dvh] flex-col bg-[#F3F4F6] text-charcoal-800">
      <header className="flex h-20 shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white px-5 shadow-sm">
        <div
          className="flex select-none items-center gap-3"
          onPointerDown={startPress}
          onPointerUp={cancelPress}
          onPointerLeave={cancelPress}
          onPointerCancel={cancelPress}
        >
          <img src="/logo.png" alt="GastroTag" className="h-12 w-12 object-contain" draggable={false} />
          <div className="leading-none">
            <div className="text-2xl font-extrabold tracking-tight">
              Gastro<span className="text-brand-500">Tag</span>
            </div>
            <div className="mt-1 text-[11px] font-bold uppercase tracking-widest text-slate-400">Totem de etiquetas</div>
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
            'flex h-14 max-w-[45%] touch-manipulation items-center gap-3 rounded-2xl border-2 px-5 text-lg font-bold active:scale-95',
            operator
              ? 'border-slate-200 bg-slate-50 text-charcoal-800'
              : 'animate-pulse border-brand-500 bg-brand-50 text-brand-700',
          )}
        >
          <User className="h-6 w-6 shrink-0" />
          <span className="truncate">{operator || 'Informar responsável'}</span>
        </button>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <Outlet />
      </main>

      <OperatorSheet />

      {menuOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-6" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
            <h2 className="text-2xl font-extrabold">Opções do totem</h2>
            <p className="mb-5 mt-1 text-base text-slate-500">Área do administrador.</p>
            <div className="flex flex-col gap-3">
              <button
                type="button"
                className="btn btn-primary h-16 text-lg"
                onClick={() => { setMenuOpen(false); navigate('/'); }}
              >
                <LayoutDashboard className="h-5 w-5" /> Abrir painel administrativo
              </button>
              <button
                type="button"
                className="btn btn-outline h-16 text-lg text-rose-600"
                onClick={() => { logout(); navigate('/totem/login', { replace: true }); }}
              >
                <LogOut className="h-5 w-5" /> Encerrar sessão do totem
              </button>
              <button type="button" className="btn btn-ghost h-16 text-lg" onClick={() => setMenuOpen(false)}>
                Voltar ao totem
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
