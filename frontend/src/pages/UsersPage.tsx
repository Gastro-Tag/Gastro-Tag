import { useCallback, useEffect, useId, useState } from 'react';
import { KeyRound, Pencil, Plus, Power, ShieldCheck, User as UserIcon } from 'lucide-react';
import { userApi } from '@/services';
import { extractError } from '@/services/api';
import type { ManagedUser, UserRole } from '@/types';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { InlineLoader, Spinner } from '@/components/ui/Spinner';
import { PasswordInput } from '@/components/ui/PasswordInput';
import { useToastContext } from '@/components/ui/Toast';
import { useAuthStore } from '@/store/authStore';
import { cn } from '@/utils/cn';

type Dialog =
  | { kind: 'create' }
  | { kind: 'edit'; user: ManagedUser }
  | { kind: 'password'; user: ManagedUser }
  | null;

const ROLE_LABEL: Record<UserRole, string> = { ADMIN: 'Administrador', OPERATOR: 'Operador' };

export function UsersPage() {
  const currentUserId = useAuthStore((state) => state.user?.id);
  const { toast } = useToastContext();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [toToggle, setToToggle] = useState<ManagedUser | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await userApi.list();
      setUsers(data.data);
    } catch (err) {
      toast(extractError(err), 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  async function confirmToggle() {
    if (!toToggle) return;
    const target = toToggle;
    setToToggle(null);
    try {
      await userApi.update(target.id, { active: !target.active });
      toast(target.active ? 'Usuário desativado.' : 'Usuário reativado.', 'success');
      void load();
    } catch (err) {
      toast(extractError(err), 'error');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-charcoal-800 sm:text-3xl">Usuários</h1>
          <p className="mt-1 text-xs font-medium text-slate-500 sm:text-sm">
            Operadores geram etiquetas; administradores também cuidam de produtos e usuários.
          </p>
        </div>
        <button className="btn btn-primary shadow-sm" onClick={() => setDialog({ kind: 'create' })}>
          <Plus className="h-4 w-4 text-brand-400" />
          <span>Novo Usuário</span>
        </button>
      </div>

      {loading ? (
        <InlineLoader text="Carregando usuários…" />
      ) : users.length === 0 ? (
        <EmptyState icon="👤" title="Nenhum usuário encontrado" desc="Cadastre a conta do totem e os operadores." />
      ) : (
        <div className="space-y-3">
          {users.map((user) => {
            const isSelf = user.id === currentUserId;
            return (
              <div key={user.id} className={cn('card flex flex-col justify-between gap-4 p-4 sm:flex-row sm:items-center', !user.active && 'opacity-60')}>
                <div className="flex min-w-0 items-center gap-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-600">
                    {user.role === 'ADMIN' ? <ShieldCheck className="h-5 w-5" /> : <UserIcon className="h-5 w-5" />}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-base font-bold text-charcoal-800">{user.name}{isSelf && ' (você)'}</h3>
                      <span className="badge badge-neutral">{ROLE_LABEL[user.role]}</span>
                      {!user.active && <span className="badge badge-expired">Desativado</span>}
                    </div>
                    <p className="truncate text-xs text-slate-500">{user.email}</p>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <button className="btn btn-outline btn-sm" onClick={() => setDialog({ kind: 'edit', user })}>
                    <Pencil className="h-3.5 w-3.5" /> Editar
                  </button>
                  <button className="btn btn-outline btn-sm" onClick={() => setDialog({ kind: 'password', user })}>
                    <KeyRound className="h-3.5 w-3.5" /> Senha
                  </button>
                  {!isSelf && (
                    <button className="btn btn-ghost btn-sm" onClick={() => setToToggle(user)}>
                      <Power className="h-3.5 w-3.5" /> {user.active ? 'Desativar' : 'Reativar'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {dialog && (
        <UserDialog
          dialog={dialog}
          isSelf={dialog.kind !== 'create' && dialog.user.id === currentUserId}
          onClose={() => setDialog(null)}
          onSaved={(message) => { setDialog(null); toast(message, 'success'); void load(); }}
        />
      )}

      <ConfirmDialog
        open={!!toToggle}
        title={toToggle?.active ? 'Desativar usuário' : 'Reativar usuário'}
        body={toToggle?.active
          ? `${toToggle.name} perderá o acesso imediatamente. As etiquetas já geradas continuam no histórico.`
          : `${toToggle?.name} voltará a ter acesso ao sistema.`}
        confirmLabel={toToggle?.active ? 'Desativar' : 'Reativar'}
        danger={toToggle?.active}
        onConfirm={() => void confirmToggle()}
        onCancel={() => setToToggle(null)}
      />
    </div>
  );
}

function UserDialog({ dialog, isSelf, onClose, onSaved }: {
  dialog: NonNullable<Dialog>;
  isSelf: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const existing = dialog.kind === 'create' ? null : dialog.user;
  const [name, setName] = useState(existing?.name ?? '');
  const [email, setEmail] = useState(existing?.email ?? '');
  const [role, setRole] = useState<UserRole>(existing?.role ?? 'OPERATOR');
  const [password, setPassword] = useState('');
  const passwordId = useId();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const showProfile = dialog.kind !== 'password';
  const showPassword = dialog.kind !== 'edit';
  const title = dialog.kind === 'create' ? 'Novo usuário'
    : dialog.kind === 'edit' ? 'Editar usuário' : `Nova senha de ${dialog.user.name}`;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (dialog.kind === 'create') {
        await userApi.create({ name, email, role, password });
        onSaved('Usuário criado.');
      } else if (dialog.kind === 'edit') {
        await userApi.update(dialog.user.id, { name, email, role });
        onSaved('Usuário atualizado.');
      } else {
        await userApi.resetPassword(dialog.user.id, password);
        onSaved('Senha redefinida.');
      }
    } catch (err) {
      setError(extractError(err));
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <form onSubmit={handleSubmit} className="w-full max-w-md space-y-4 rounded-3xl border border-slate-200/80 bg-white p-6 shadow-card-lg">
        <h2 className="text-base font-bold text-charcoal-800">{title}</h2>

        {error && (
          <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</p>
        )}

        {showProfile && (
          <>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">
              Nome
              <input required minLength={2} maxLength={100} value={name} onChange={(e) => setName(e.target.value)} className="input mt-1.5" />
            </label>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">
              E-mail
              <input type="email" required maxLength={120} autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} className="input mt-1.5" />
            </label>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">
              Perfil
              <select value={role} disabled={isSelf} onChange={(e) => setRole(e.target.value as UserRole)} className="input mt-1.5">
                <option value="OPERATOR">Operador</option>
                <option value="ADMIN">Administrador</option>
              </select>
            </label>
          </>
        )}

        {showPassword && (
          <div>
            <label htmlFor={passwordId} className="block text-xs font-bold uppercase tracking-wider text-slate-500">Senha (mínimo 12 caracteres)</label>
            <PasswordInput id={passwordId} required minLength={12} maxLength={72} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className="input mt-1.5" />
          </div>
        )}

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
