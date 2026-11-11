import { useId, useState } from 'react';
import { authApi } from '@/services';
import { extractError } from '@/services/api';
import { Spinner } from '@/components/ui/Spinner';
import { PasswordInput } from '@/components/ui/PasswordInput';
import { useToastContext } from '@/components/ui/Toast';

export function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const { toast } = useToastContext();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (newPassword !== confirmation) { setError('A confirmação não confere com a nova senha.'); return; }
    setSaving(true);
    setError('');
    try {
      await authApi.changePassword(currentPassword, newPassword);
      toast('Senha alterada. Os outros aparelhos com esta conta foram desconectados.', 'success');
      onClose();
    } catch (err) {
      setError(extractError(err));
      setSaving(false);
    }
  }

  const ids = { current: useId(), next: useId(), confirm: useId() };
  const field = 'block text-xs font-bold uppercase tracking-wider text-slate-500';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Trocar minha senha">
      <form onSubmit={handleSubmit} className="w-full max-w-md space-y-4 rounded-3xl border border-slate-200/80 bg-white p-6 shadow-card-lg">
        <h2 className="text-base font-bold text-charcoal-800">Trocar minha senha</h2>

        {error && (
          <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</p>
        )}

        <div>
          <label htmlFor={ids.current} className={field}>Senha atual</label>
          <PasswordInput id={ids.current} required maxLength={72} autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className="input mt-1.5" />
        </div>
        <div>
          <label htmlFor={ids.next} className={field}>Nova senha (mínimo 12 caracteres)</label>
          <PasswordInput id={ids.next} required minLength={12} maxLength={72} autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="input mt-1.5" />
        </div>
        <div>
          <label htmlFor={ids.confirm} className={field}>Confirme a nova senha</label>
          <PasswordInput id={ids.confirm} required minLength={12} maxLength={72} autoComplete="new-password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} className="input mt-1.5" />
        </div>

        <p className="text-xs text-slate-500">Este aparelho continua conectado; os outros precisarão entrar de novo.</p>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn btn-ghost">Cancelar</button>
          <button type="submit" disabled={saving} className="btn btn-primary">
            {saving ? <Spinner size="sm" className="text-white" /> : 'Salvar'}
          </button>
        </div>
      </form>
    </div>
  );
}
