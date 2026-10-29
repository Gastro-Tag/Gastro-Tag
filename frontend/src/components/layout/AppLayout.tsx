import { ReactNode, useState } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Package,
  Tag,
  LogOut,
  Menu,
  X,
  ChefHat,
  Search,
  Bell,
  Sparkles,
  Tablet,
} from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { cn } from '@/utils/cn';

const navItems = [
  { to: '/',         label: 'Dashboard',  icon: LayoutDashboard },
  { to: '/products', label: 'Produtos',   icon: Package         },
  { to: '/labels',   label: 'Etiquetas',  icon: Tag             },
  { to: '/totem',    label: 'Modo Totem', icon: Tablet          },
];

export function AppLayout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  function handleLogout() {
    logout();
    navigate('/login');
  }

  // Get current page name for top bar context
  const getPageInfo = () => {
    if (location.pathname === '/') return { title: 'Dashboard', subtitle: 'Visão geral do controle de alimentos' };
    if (location.pathname.startsWith('/products')) return { title: 'Controle de Produtos', subtitle: 'Estoque, validade e manipulação' };
    if (location.pathname.startsWith('/labels')) return { title: 'Etiquetas & Descarte', subtitle: 'Geração, impressão e rastreabilidade' };
    return { title: 'GastroTag', subtitle: 'Gestão Inteligente de Alimentos' };
  };

  const pageInfo = getPageInfo();
  const todayFormatted = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date());

  const chefName = user?.name ? `Chef ${user.name.split(' ')[0]}` : 'Chef Operador';

  return (
    <div className="flex h-[100dvh] min-h-[100svh] overflow-hidden bg-[#F8F9FA] text-slate-800">

      {/* ── Sidebar ─────────────────────────────────── */}
      <aside className={cn(
        'fixed inset-y-0 left-0 z-40 flex flex-col w-64 bg-white border-r border-slate-200/80 shadow-card',
        'transition-transform duration-200 ease-in-out',
        mobileOpen ? 'translate-x-0' : '-translate-x-full',
        'lg:relative lg:translate-x-0',
      )}>
        {/* Brand / Logo */}
        <div className="flex items-center gap-3 px-5 h-20 border-b border-slate-100">
          <div className="relative w-11 h-11 rounded-2xl bg-slate-50 border border-slate-100 p-1.5 flex items-center justify-center shrink-0 shadow-sm">
            <img
              src="/logo.png"
              alt="GastroTag Logo"
              className="w-full h-full object-contain"
              onError={(e) => {
                // Fallback to Icon if image is loading
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
            <ChefHat className="w-5 h-5 text-brand-600 absolute inset-0 m-auto pointer-events-none -z-10" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-lg font-extrabold tracking-tight text-charcoal-800 flex items-center gap-0.5">
              <span>Gastro</span>
              <span className="text-brand-500">Tag</span>
            </div>
            <div className="text-[11px] font-medium text-slate-400 -mt-0.5 truncate">
              Gestão de Alimentos
            </div>
          </div>
          <button
            className="flex h-9 w-9 items-center justify-center text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 lg:hidden"
            onClick={() => setMobileOpen(false)}
            aria-label="Fechar menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation */}
        <div className="flex-1 px-3.5 py-6 space-y-1.5 overflow-y-auto">
          <div className="px-3 pb-2 text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
            Navegação Principal
          </div>
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) => cn(
                'group flex items-center gap-3.5 px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-150',
                isActive
                  ? 'bg-charcoal-800 text-white shadow-sm'
                  : 'text-slate-600 hover:text-charcoal-900 hover:bg-slate-100/80',
              )}
            >
              {({ isActive }) => (
                <>
                  <Icon className={cn(
                    'w-4 h-4 shrink-0 transition-colors',
                    isActive ? 'text-brand-400' : 'text-slate-400 group-hover:text-charcoal-800'
                  )} />
                  <span className="truncate">{label}</span>
                  {isActive && (
                    <span className="ml-auto w-1.5 h-1.5 rounded-full bg-brand-500" />
                  )}
                </>
              )}
            </NavLink>
          ))}
        </div>

        {/* User Card & Logout */}
        <div className="p-3.5 border-t border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-3 p-2.5 rounded-xl bg-white border border-slate-200/60 shadow-sm mb-2">
            <div className="w-9 h-9 rounded-full bg-charcoal-800 text-brand-400 flex items-center justify-center text-xs font-bold shrink-0 shadow-sm">
              <ChefHat className="w-4 h-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-bold text-charcoal-800 truncate">
                {chefName}
              </div>
              <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">
                {user?.role === 'ADMIN' ? 'Administrador' : 'Operador'}
              </div>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center justify-center gap-2 w-full px-3 py-2 rounded-xl text-xs font-semibold
                       text-slate-500 hover:text-rose-600 hover:bg-rose-50 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sair do sistema</span>
          </button>
        </div>
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 backdrop-blur-xs lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* ── Main Layout ─────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Top Header */}
        <header className="h-16 lg:h-20 bg-white border-b border-slate-200/80 px-4 lg:px-8 flex items-center justify-between gap-4 shrink-0 shadow-xs">
          {/* Mobile menu trigger + Logo on mobile */}
          <div className="flex items-center gap-3 lg:hidden">
            <button
              className="flex h-10 w-10 items-center justify-center text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-100"
              onClick={() => setMobileOpen(true)}
              aria-label="Abrir menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2">
              <img src="/logo.png" alt="Logo" className="w-7 h-7 object-contain" />
              <span className="font-extrabold text-charcoal-800 text-base">Gastro<span className="text-brand-500">Tag</span></span>
            </div>
          </div>

          {/* Desktop Title & Date context */}
          <div className="hidden lg:block min-w-0">
            <h1 className="text-lg font-bold text-charcoal-800 tracking-tight leading-none truncate">
              {pageInfo.title}
            </h1>
            <p className="text-xs text-slate-400 mt-1 capitalize font-medium">
              {todayFormatted} • {pageInfo.subtitle}
            </p>
          </div>

          {/* Right Header items (Search / Quick Profile) */}
          <div className="flex items-center gap-3 ml-auto">
            <div className="hidden md:flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-100 text-slate-600 text-xs font-medium">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>Cozinha Ativa</span>
            </div>

            <div className="flex items-center gap-2.5 pl-2 border-l border-slate-200">
              <div className="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-charcoal-800 font-bold text-xs">
                {user?.name?.charAt(0).toUpperCase() || 'U'}
              </div>
              <div className="hidden sm:block text-left">
                <div className="text-xs font-bold text-charcoal-800 leading-tight">
                  {user?.name || 'Usuário'}
                </div>
                <div className="text-[10px] text-slate-400 font-medium">
                  {user?.email || 'cozinha@gastrotag.com'}
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Page Content scrollable area */}
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
