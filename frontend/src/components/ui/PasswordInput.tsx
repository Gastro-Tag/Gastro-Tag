import { forwardRef, useState, type InputHTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '@/utils/cn';

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

/**
 * Campo de senha com botão para mostrar/ocultar o texto. Aceita as props de um
 * <input>; a className vai para o campo (que ganha padding à direita para não
 * ficar embaixo do botão).
 */
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput({ className, ...props }, ref) {
    const [visible, setVisible] = useState(false);
    const Icon = visible ? EyeOff : Eye;

    return (
      <div className="relative w-full">
        <input
          {...props}
          ref={ref}
          type={visible ? 'text' : 'password'}
          // Com a senha visível, o teclado móvel não deve capitalizar nem corrigir.
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className={cn(className, 'pr-12')}
        />
        <button
          type="button"
          aria-label="Mostrar senha"
          title={visible ? 'Ocultar senha' : 'Mostrar senha'}
          aria-pressed={visible}
          // Evita tirar o foco do campo (e fechar o teclado virtual) ao tocar no botão.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setVisible((value) => !value)}
          disabled={props.disabled}
          className="absolute right-0 top-1/2 flex h-11 min-h-[44px] w-11 min-w-[44px] -translate-y-1/2 items-center justify-center rounded-xl text-slate-400 transition-colors hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:opacity-50"
        >
          <Icon className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
    );
  },
);
