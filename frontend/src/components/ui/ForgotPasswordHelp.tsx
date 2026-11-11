import { useState } from 'react';
import { cn } from '@/utils/cn';

/**
 * "Esqueci minha senha": o sistema não envia e-mail, então só explica como a
 * senha é redefinida. `highlight` destaca a opção após um login recusado.
 */
export function ForgotPasswordHelp({ highlight = false, large = false }: { highlight?: boolean; large?: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'inline-flex min-h-[44px] items-center rounded-lg px-1 font-bold underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
          large ? 'text-base' : 'text-sm',
          highlight ? 'text-brand-700' : 'text-slate-500 hover:text-slate-700',
        )}
      >
        Esqueci minha senha
      </button>
      {open && (
        <div className={cn('mt-1 space-y-1.5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-600', large ? 'text-base' : 'text-sm')}>
          <p>Este sistema não envia e-mail de recuperação.</p>
          <p>A senha só pode ser redefinida por um administrador, no painel em <strong>Usuários → Senha</strong>.</p>
          <p>A conta de administrador principal é configurada no servidor; quem administra o servidor é quem redefine essa senha.</p>
        </div>
      )}
    </div>
  );
}
