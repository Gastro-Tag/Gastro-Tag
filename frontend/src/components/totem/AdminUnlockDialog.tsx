import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { authApi } from '@/services';
import { extractError } from '@/services/api';
import { Spinner } from '@/components/ui/Spinner';

/** Pede credenciais de administrador antes de liberar as opções do totem. */
export function AdminUnlockDialog({ onUnlock, onCancel }: { onUnlock: () => void; onCancel: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setChecking(true);
    setError('');
    try {
      await authApi.verifyAdmin(email.trim(), password);
      onUnlock();
    } catch (err) {
      setError(extractError(err));
      setPassword('');
      setChecking(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-6" role="dialog" aria-modal="true" aria-label="Área do administrador">
      <form onSubmit={handleSubmit} className="w-full max-w-md space-y-4 rounded-3xl bg-white p-6 shadow-2xl">
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-8 w-8 shrink-0 text-brand-600" />
          <div>
            <h2 className="text-2xl font-extrabold">Área do administrador</h2>
            <p className="text-base text-slate-500">Confirme com uma conta de administrador.</p>
          </div>
        </div>

        {error && (
          <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-base font-bold text-rose-700">
            {error}
          </p>
        )}

        <input
          type="email" required autoComplete="off" autoFocus value={email} aria-label="E-mail do administrador"
          onChange={(event) => setEmail(event.target.value)}
          className="input h-14 text-lg" placeholder="E-mail"
        />
        <input
          type="password" required autoComplete="off" value={password} aria-label="Senha do administrador"
          onChange={(event) => setPassword(event.target.value)}
          className="input h-14 text-lg" placeholder="Senha"
        />

        <div className="flex gap-3">
          <button type="button" onClick={onCancel} className="btn btn-ghost h-16 flex-1 text-lg">Voltar ao totem</button>
          <button type="submit" disabled={checking} className="btn btn-primary h-16 flex-1 text-lg">
            {checking ? <Spinner size="sm" className="text-white" /> : 'Entrar'}
          </button>
        </div>
      </form>
    </div>
  );
}
