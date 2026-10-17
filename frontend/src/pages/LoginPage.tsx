import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, Mail, ArrowRight, ShieldCheck } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { Spinner } from '@/components/ui/Spinner';

export function LoginPage() {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const { login, isLoading, error, clearError } = useAuthStore();
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    clearError();
    try {
      await login(email, password);
      navigate('/');
    } catch { /* error shown from store */ }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#F8F9FA] px-4 py-12 relative overflow-hidden">
      {/* Decorative background glows */}
      <div className="absolute top-0 -left-40 w-96 h-96 bg-brand-100/40 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 -right-40 w-96 h-96 bg-amber-100/40 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-md relative z-10">
        {/* Brand Header */}
        <div className="flex flex-col items-center mb-8 text-center">
          <div className="w-20 h-20 rounded-3xl bg-white border border-slate-200/80 p-3 shadow-card-hover mb-4 flex items-center justify-center">
            <img src="/logo.png" alt="GastroTag" className="w-full h-full object-contain" />
          </div>
          <h1 className="text-3xl font-extrabold text-charcoal-800 tracking-tight flex items-center gap-1">
            <span>Gastro</span>
            <span className="text-brand-500">Tag</span>
          </h1>
          <p className="text-slate-500 text-sm mt-1 max-w-xs font-medium">
            Controle sanitário, cálculo de validade e rotulagem para cozinhas profissionais
          </p>
        </div>

        {/* Login Form Card */}
        <div className="bg-white rounded-3xl p-8 border border-slate-200/80 shadow-card-lg">
          <div className="mb-6">
            <h2 className="text-xl font-bold text-charcoal-800">Acesse sua conta</h2>
            <p className="text-xs text-slate-400 mt-0.5">Informe suas credenciais para continuar</p>
          </div>

          {error && (
            <div className="mb-5 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl px-4 py-3 text-sm flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                E-mail
              </label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input pl-10"
                  placeholder="operador@cozinha.com"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                Senha de acesso
              </label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input pl-10"
                  placeholder="••••••••"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="btn btn-primary w-full py-3.5 rounded-xl font-bold text-sm tracking-wide mt-2 flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <Spinner size="sm" className="text-white" />
              ) : (
                <>
                  <span>Entrar no sistema</span>
                  <ArrowRight className="w-4 h-4 text-brand-400" />
                </>
              )}
            </button>
          </form>

          <div className="mt-6 pt-5 border-t border-slate-100 flex items-center justify-center gap-2 text-[11px] text-slate-400 font-medium">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>Ambiente seguro em conformidade sanitária</span>
          </div>
        </div>

        <p className="text-center text-slate-400 text-xs mt-8">
          GastroTag © {new Date().getFullYear()} • Todos os direitos reservados
        </p>
      </div>
    </div>
  );
}
