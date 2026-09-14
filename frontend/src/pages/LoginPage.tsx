import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChefHat, Lock, Mail } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { Spinner } from '@/components/ui/Spinner';

export function LoginPage() {
  const [email, setEmail]       = useState('admin@gastrotag.com');
  const [password, setPassword] = useState('admin123');
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
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-900 px-4">
      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 bg-brand-700 rounded-2xl flex items-center justify-center mb-4 shadow-card-lg">
            <ChefHat className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">Gastro-Tag</h1>
          <p className="text-slate-400 text-sm mt-1">Sistema de Rotulagem de Alimentos</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="bg-white rounded-xl p-6 shadow-card-lg space-y-4">
          <h2 className="text-lg font-semibold text-slate-800 mb-1">Entrar</h2>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2.5 text-sm">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">E-mail</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="email" required
                value={email} onChange={(e) => setEmail(e.target.value)}
                className="input pl-9"
                placeholder="seu@email.com"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Senha</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="password" required
                value={password} onChange={(e) => setPassword(e.target.value)}
                className="input pl-9"
                placeholder="••••••••"
              />
            </div>
          </div>

          <button type="submit" disabled={isLoading} className="btn-primary btn btn-lg w-full mt-2">
            {isLoading ? <Spinner size="sm" className="text-white" /> : 'Entrar'}
          </button>
        </form>

        <p className="text-center text-slate-500 text-xs mt-6">
          Gastro-Tag © {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
