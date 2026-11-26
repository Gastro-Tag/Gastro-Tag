import { useCallback, useEffect, useId, useState } from 'react';
import { Download, Eraser, Hash, KeyRound, Pencil, Plus, Power, ShieldCheck, User as UserIcon } from 'lucide-react';
import { userApi } from '@/services';
import { extractError } from '@/services/api';
import type { ManagedUser, UserRole } from '@/types';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { InlineLoader, Spinner } from '@/components/ui/Spinner';
import { LoadError } from '@/components/ui/LoadError';
import { PasswordInput } from '@/components/ui/PasswordInput';
import { useToastContext } from '@/components/ui/Toast';
import { useAuthStore } from '@/store/authStore';
import { cn } from '@/utils/cn';
import { canConfirmPseudonymize } from '@/utils/titular';

type Dialog =
  | { kind: 'create' }
  | { kind: 'edit'; user: ManagedUser }
  | { kind: 'password'; user: ManagedUser }
  | { kind: 'pin'; user: ManagedUser }
  | null;

const ROLE_LABEL: Record<UserRole, string> = { ADMIN: 'Administrador', OPERATOR: 'Operador' };

export function UsersPage() {
  const currentUserId = useAuthStore((state) => state.user?.id);
  const { toast } = useToastContext();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [toToggle, setToToggle] = useState<ManagedUser | null>(null);
  const [toRemovePin, setToRemovePin] = useState<ManagedUser | null>(null);
  const [toUnlockPin, setToUnlockPin] = useState<ManagedUser | null>(null);
  const [toPseudonymize, setToPseudonymize] = useState<ManagedUser | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const { data } = await userApi.list();
      setUsers(data.data);
    } catch (err) {
      setLoadError(extractError(err));
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

  async function confirmUnlockPin() {
    if (!toUnlockPin) return;
    const target = toUnlockPin;
    setToUnlockPin(null);
    try {
      await userApi.unlockPin(target.id);
      toast(`Novas tentativas de PIN liberadas para ${target.name}. O PIN continua o mesmo.`, 'success');
    } catch (err) {
      toast(extractError(err), 'error');
    }
  }

  async function confirmRemovePin() {
    if (!toRemovePin) return;
    const target = toRemovePin;
    setToRemovePin(null);
    try {
      await userApi.setPin(target.id, null);
      toast(`PIN de ${target.name} removido.`, 'success');
      void load();
    } catch (err) {
      toast(extractError(err), 'error');
    }
  }

  async function exportData(target: ManagedUser) {
    if (exportingId) return;
    setExportingId(target.id);
    try {
      const { blob, filename } = await userApi.exportData(target.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast('Arquivo de dados gerado. Antes de entregar, confira a lista "typedNameMatches": pode trazer etiquetas de outra pessoa com o mesmo nome.', 'success');
    } catch (err) {
      toast(extractError(err), 'error');
    } finally {
      setExportingId(null);
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
      ) : loadError ? (
        <LoadError title="Não foi possível carregar os usuários." message={loadError} onRetry={() => void load()} />
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
                      {user.pseudonymized
                        ? <span className="badge badge-neutral">Dados removidos</span>
                        : !user.active && <span className="badge badge-expired">Desativado</span>}
                      {user.hasPin && <span className="badge badge-valid gap-1" title="Pode confirmar a identidade no totem com PIN"><Hash className="h-3 w-3" />PIN</span>}
                    </div>
                    <p className="truncate text-xs text-slate-500">{user.email}</p>
                  </div>
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {!user.pseudonymized && (
                    <>
                      <button className="btn btn-outline btn-sm" onClick={() => setDialog({ kind: 'edit', user })}>
                        <Pencil className="h-3.5 w-3.5" /> Editar
                      </button>
                      <button className="btn btn-outline btn-sm" onClick={() => setDialog({ kind: 'password', user })}>
                        <KeyRound className="h-3.5 w-3.5" /> Senha
                      </button>
                      <button className="btn btn-outline btn-sm" onClick={() => setDialog({ kind: 'pin', user })}>
                        <Hash className="h-3.5 w-3.5" /> {user.hasPin ? 'Trocar PIN' : 'Definir PIN'}
                      </button>
                      {user.hasPin && (
                        <button className="btn btn-ghost btn-sm" onClick={() => setToUnlockPin(user)}>
                          Desbloquear PIN
                        </button>
                      )}
                      {user.hasPin && (
                        <button className="btn btn-ghost btn-sm" onClick={() => setToRemovePin(user)}>
                          Remover PIN
                        </button>
                      )}
                      {!isSelf && (
                        <button className="btn btn-ghost btn-sm" onClick={() => setToToggle(user)}>
                          <Power className="h-3.5 w-3.5" /> {user.active ? 'Desativar' : 'Reativar'}
                        </button>
                      )}
                    </>
                  )}
                  <button className="btn btn-outline btn-sm" disabled={exportingId === user.id} onClick={() => void exportData(user)}>
                    {exportingId === user.id ? <Spinner size="sm" /> : <Download className="h-3.5 w-3.5" />} Exportar dados
                  </button>
                  {!user.pseudonymized && !isSelf && (
                    <button className="btn btn-danger btn-sm" onClick={() => setToPseudonymize(user)}>
                      <Eraser className="h-3.5 w-3.5" /> Remover dados pessoais
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

      {toPseudonymize && (
        <PseudonymizeDialog
          user={toPseudonymize}
          onClose={() => setToPseudonymize(null)}
          onDone={(name) => { setToPseudonymize(null); toast(`Dados pessoais de ${name} removidos.`, 'success'); void load(); }}
        />
      )}

      <ConfirmDialog
        open={!!toUnlockPin}
        title="Desbloquear PIN"
        body={`Libera novas tentativas de PIN de ${toUnlockPin?.name ?? ''} em todos os aparelhos, sem esperar os 15 minutos. O PIN continua o mesmo; se a pessoa esqueceu, use "Trocar PIN".`}
        confirmLabel="Desbloquear"
        onConfirm={() => void confirmUnlockPin()}
        onCancel={() => setToUnlockPin(null)}
      />

      <ConfirmDialog
        open={!!toRemovePin}
        title="Remover PIN"
        body={`${toRemovePin?.name ?? ''} deixará de confirmar o operador por PIN no totem. As etiquetas já confirmadas continuam marcadas no histórico.`}
        confirmLabel="Remover PIN"
        danger
        onConfirm={() => void confirmRemovePin()}
        onCancel={() => setToRemovePin(null)}
      />

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

function PseudonymizeDialog({ user, onClose, onDone }: {
  user: ManagedUser;
  onClose: () => void;
  onDone: (name: string) => void;
}) {
  const inputId = useId();
  const titleId = useId();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const enabled = canConfirmPseudonymize(typed, user.name) && !busy;

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && !busy) onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!enabled) return;
    setBusy(true);
    setError('');
    try {
      await userApi.pseudonymize(user.id, typed.trim());
      onDone(user.name);
    } catch (err) {
      setError(extractError(err));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby={titleId} className="max-h-full w-full max-w-md space-y-4 overflow-y-auto rounded-3xl border border-slate-200/80 bg-white p-6 shadow-card-lg">
        <h2 id={titleId} className="text-base font-bold text-charcoal-800">Remover dados pessoais de {user.name}</h2>

        <div className="space-y-2 text-xs leading-relaxed text-slate-600">
          <p className="font-bold text-rose-700">Esta ação é irreversível.</p>
          <ul className="list-disc space-y-1 pl-4">
            <li>O nome passa a ser &quot;Usuário removido …&quot;.</li>
            <li>O e-mail e o PIN são apagados.</li>
            <li>A conta é desativada e as sessões são encerradas.</li>
            <li>As etiquetas já registradas mantêm o nome que foi impresso ou digitado, para rastreabilidade. A remoção desses nomes depende de orientação jurídica.</li>
          </ul>
          <p>Recomendamos usar &quot;Exportar dados&quot; antes de continuar.</p>
        </div>

        {error && (
          <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</p>
        )}

        <div>
          <label htmlFor={inputId} className="block text-xs font-bold text-slate-500">
            Para confirmar, digite o nome exato: <span className="text-charcoal-800">{user.name}</span>
          </label>
          <input id={inputId} autoFocus autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} className="input mt-1.5" />
        </div>

        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} disabled={busy} className="btn btn-ghost">Cancelar</button>
          <button type="submit" disabled={!enabled} className="btn btn-danger">
            {busy ? <Spinner size="sm" className="text-white" /> : 'Remover dados pessoais'}
          </button>
        </div>
      </form>
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
  const [pin, setPin] = useState('');
  const passwordId = useId();
  const pinId = useId();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const showProfile = dialog.kind === 'create' || dialog.kind === 'edit';
  const showPassword = dialog.kind === 'create' || dialog.kind === 'password';
  const showPin = dialog.kind === 'pin';
  const title = dialog.kind === 'create' ? 'Novo usuário'
    : dialog.kind === 'edit' ? 'Editar usuário'
    : dialog.kind === 'pin' ? `PIN de ${dialog.user.name}` : `Nova senha de ${dialog.user.name}`;

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
      } else if (dialog.kind === 'pin') {
        await userApi.setPin(dialog.user.id, pin);
        onSaved('PIN definido.');
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

        {showPin && (
          <div>
            <label htmlFor={pinId} className="block text-xs font-bold uppercase tracking-wider text-slate-500">PIN (4 a 6 dígitos)</label>
            <input
              id={pinId} type="password" inputMode="numeric" pattern="\d{4,6}" minLength={4} maxLength={6} required
              autoComplete="new-password" autoFocus value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              className="input mt-1.5 tracking-[0.3em]"
            />
            <p className="mt-1.5 text-xs font-medium text-slate-400">
              Usado pelo operador no totem para confirmar quem está manipulando. Só números; evite datas e sequências óbvias.
            </p>
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
