import { useId, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Lock, Mail } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { Spinner } from '@/components/ui/Spinner';
import { PasswordInput } from '@/components/ui/PasswordInput';
import { ForgotPasswordHelp } from '@/components/ui/ForgotPasswordHelp';

/** Login feito uma única vez ao instalar o totem; a sessão se renova sozinha. */
export function TotemLoginPage() {
  const passwordId = useId();
  const { user, accessToken, login, isLoading, error, clearError } = useAuthStore();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  if (accessToken && user) return <Navigate to="/totem" replace />;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    clearError();
    try {
      await login(email, password);
      navigate('/totem', { replace: true });
    } catch { /* erro exibido pelo store */ }
  }

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-[#F3F4F6] px-4 py-6 sm:px-6 sm:py-10">
      <div className="w-full max-w-lg">
        <div className="mb-4 flex flex-col items-center text-center sm:mb-8">
          <img src="/logo.png" alt="GastroTag" className="mb-2 h-16 w-16 object-contain sm:mb-3 sm:h-24 sm:w-24" />
          <h1 className="text-3xl font-extrabold sm:text-4xl tracking-tight text-charcoal-800">
            Gastro<span className="text-brand-500">Tag</span>
          </h1>
          <p className="mt-1 text-base font-medium sm:text-lg text-slate-500">Ativar este totem de etiquetas</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 rounded-3xl border border-slate-200 bg-white p-5 sm:space-y-5 sm:p-8 shadow-card-lg">
          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-base font-semibold text-rose-700">
              {error}
            </div>
          )}

          <label className="block">
            <span className="mb-1.5 block text-sm font-bold uppercase tracking-wider text-slate-600">E-mail</span>
            <div className="relative">
              <Mail className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
              <input
                type="email" required autoComplete="username" value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="input h-16 pl-12 text-xl" placeholder="conta@cozinha.com"
              />
            </div>
          </label>

          <div className="block">
            <label htmlFor={passwordId} className="mb-1.5 block text-sm font-bold uppercase tracking-wider text-slate-600">Senha</label>
            <div className="relative">
              <Lock className="pointer-events-none absolute z-10 left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
              <PasswordInput
                id={passwordId} required autoComplete="current-password" value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="input h-16 pl-12 text-xl" placeholder="••••••••"
              />
            </div>
          </div>
          <ForgotPasswordHelp large highlight={!!error} />

          <button type="submit" disabled={isLoading} className="btn btn-accent h-16 w-full text-xl font-extrabold">
            {isLoading ? <Spinner size="sm" className="text-white" /> : 'Ativar totem'}
          </button>
        </form>
      </div>
    </div>
  );
}
