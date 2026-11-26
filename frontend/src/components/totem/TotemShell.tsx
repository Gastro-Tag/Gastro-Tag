import { useEffect, useMemo, useState } from 'react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import { Check, LayoutDashboard, LogOut, ShieldCheck, User, WifiOff, X } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { useTotemStore } from '@/store/totemStore';
import { useIdle } from '@/hooks/useIdle';
import { useOutageTracker } from '@/hooks/useOutageTracker';
import { outageNoticeText } from '@/utils/outage';
import { useKitchenTemplateSync, useLabelTemplate } from '@/hooks/useLabelTemplate';
import { LABEL_TEMPLATES, LABEL_TEMPLATE_NOT_CHOSEN_TEXT, getLabelTemplate } from '@/utils/labelTemplates';
import { cn } from '@/utils/cn';
import { createPressGesture } from '@/utils/pressGesture';
import { AdminUnlockDialog } from './AdminUnlockDialog';
import { OperatorSheet } from './OperatorSheet';

const IDLE_MS = 60_000;        // volta ao início após 60 s sem toque
const LONG_PRESS_MS = 1_500;   // segurar a logo pede a senha do administrador; toque curto volta ao início

/** Protege as rotas do totem: exige sessão, mas não usa o layout administrativo. */
export function TotemRoute() {
  const { user, accessToken } = useAuthStore();
  if (!accessToken || !user) return <Navigate to="/totem/login" replace />;
  return <TotemShell />;
}

function TotemShell() {
  useKitchenTemplateSync(); // padrão da cozinha também na reimpressão do início
  const { noticeMs, dismiss: dismissOutage } = useOutageTracker(); // plano B: só observa a rede
  const navigate = useNavigate();
  const location = useLocation();
  const logout = useAuthStore((state) => state.logout);
  const { operator, handlerToken, openOperatorSheet, syncOperator } = useTotemStore();
  const [adminMenu, setAdminMenu] = useState<'locked' | 'unlocked' | null>(null);
  const [now, setNow] = useState(() => new Date());

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

  // Toque curto na logo volta ao início; segurar pede a senha do administrador.
  const pathname = location.pathname;
  const logoGesture = useMemo(
    () => createPressGesture({
      delayMs: LONG_PRESS_MS,
      onTap: () => { if (pathname !== '/totem') navigate('/totem'); },
      onLongPress: () => setAdminMenu('locked'),
    }),
    [pathname, navigate],
  );
  useEffect(() => () => logoGesture.cancel(), [logoGesture]);

  const clock = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(now);
  const date = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(now);

  return (
    <div className="totem-root flex h-[100dvh] flex-col bg-[#F3F4F6] text-charcoal-800">
      <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-3 shadow-sm sm:h-20 sm:gap-4 sm:px-5 [@media(max-height:500px)]:h-14">
        <div
          role="button"
          tabIndex={0}
          aria-label="Voltar ao início do totem (segure para opções do administrador)"
          className="flex shrink-0 cursor-pointer touch-manipulation select-none items-center gap-2 rounded-xl sm:gap-3"
          onPointerDown={logoGesture.start}
          onPointerUp={logoGesture.end}
          onPointerLeave={logoGesture.cancel}
          onPointerCancel={logoGesture.cancel}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              if (!event.repeat && pathname !== '/totem') navigate('/totem');
            }
          }}
        >
          <img src="/logo-icon.png" alt="" className="h-10 w-10 object-contain sm:h-12 sm:w-12" draggable={false} />
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
          {operator && handlerToken
            ? <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-600 sm:h-6 sm:w-6" aria-label="Operador confirmado por PIN" />
            : <User className="h-5 w-5 shrink-0 sm:h-6 sm:w-6" />}
          <span className="truncate">{operator || 'Informar responsável'}</span>
        </button>
      </header>

      {noticeMs !== null && (
        <div role="status" className="flex shrink-0 items-start gap-3 border-b-2 border-amber-300 bg-amber-100 px-4 py-3 text-amber-950">
          <WifiOff className="mt-1 h-7 w-7 shrink-0 text-amber-700" aria-hidden="true" />
          <p className="min-w-0 flex-1 text-lg font-bold leading-snug sm:text-xl">{outageNoticeText(noticeMs)}</p>
          <button
            type="button"
            onClick={dismissOutage}
            aria-label="Dispensar aviso"
            className="flex h-12 w-12 shrink-0 touch-manipulation items-center justify-center rounded-xl bg-white/70 active:scale-95"
          >
            <X className="h-6 w-6" aria-hidden="true" />
          </button>
        </div>
      )}

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
              <LabelTemplateChooser />
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

/** Modelo de etiqueta deste aparelho (a impressora fica ligada a ele). Só aparece no menu do administrador. */
function LabelTemplateChooser() {
  const { templateId, explicit, source, choose, useKitchenDefault } = useLabelTemplate();
  return (
    <div role="radiogroup" aria-label="Modelo da etiqueta" className="space-y-2 rounded-2xl border-2 border-slate-200 p-3">
      <p className="text-base font-extrabold">Modelo da etiqueta</p>
      {!explicit && <p role="status" className="text-sm font-bold text-amber-800">{LABEL_TEMPLATE_NOT_CHOSEN_TEXT}</p>}
      {source === 'kitchen' && <p role="status" className="text-sm font-bold text-slate-600">Valendo: {getLabelTemplate(templateId).name} (padrão da cozinha).</p>}
      <button
        type="button"
        role="radio"
        aria-checked={source !== 'device'}
        onClick={useKitchenDefault}
        className={cn(
          'flex min-h-[3.5rem] w-full touch-manipulation items-center gap-3 rounded-xl border-2 px-3 py-2 text-left text-base font-bold active:scale-[0.99]',
          source !== 'device' ? 'border-brand-500 bg-orange-50' : 'border-slate-200 bg-white',
        )}
      >
        <span className="min-w-0 flex-1">Padrão da cozinha</span>
        {source !== 'device' && <Check className="h-5 w-5 shrink-0 text-brand-600" aria-hidden="true" />}
      </button>
      {LABEL_TEMPLATES.map((template) => {
        const selected = source === 'device' && template.id === templateId;
        return (
          <button
            key={template.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => choose(template.id)}
            className={cn(
              'flex min-h-[3.5rem] w-full touch-manipulation items-center gap-3 rounded-xl border-2 px-3 py-2 text-left text-base font-bold active:scale-[0.99]',
              selected ? 'border-brand-500 bg-orange-50' : 'border-slate-200 bg-white',
            )}
          >
            <span className="min-w-0 flex-1">{template.name}</span>
            {selected && <Check className="h-5 w-5 shrink-0 text-brand-600" aria-hidden="true" />}
          </button>
        );
      })}
      <p className="text-sm text-slate-500">Escolher um modelo é uma exceção que vale só para este aparelho. Na impressora, use o mesmo tamanho de papel.</p>
    </div>
  );
}
