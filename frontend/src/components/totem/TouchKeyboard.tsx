import { useState } from 'react';
import { Delete } from 'lucide-react';
import { cn } from '@/utils/cn';

export type KeyboardLayout = 'text' | 'numeric';
export type Capitalize = 'words' | 'upper' | 'none';

interface TouchKeyboardProps {
  value: string;
  onChange: (value: string) => void;
  layout?: KeyboardLayout;
  capitalize?: Capitalize;
  maxLength?: number;
}

const ROWS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'ç'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm', '-', '.', '_'],
];
const ACCENTS = ['á', 'à', 'â', 'ã', 'é', 'ê', 'í', 'ó', 'ô', 'õ', 'ú', 'ü'];

function Key({ children, onPress, label, className }: {
  children: React.ReactNode;
  onPress: () => void;
  label?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onPress}
      className={cn(
        'flex h-16 min-w-0 flex-1 touch-manipulation select-none items-center justify-center',
        'rounded-xl border border-slate-200 bg-white text-2xl font-bold text-charcoal-800 shadow-sm',
        'transition-transform active:scale-95 active:bg-brand-100',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function TouchKeyboard({
  value, onChange, layout = 'text', capitalize = 'none', maxLength = 60,
}: TouchKeyboardProps) {
  const [showAccents, setShowAccents] = useState(false);

  function press(char: string) {
    if (value.length >= maxLength) return;
    let next = char;
    if (capitalize === 'upper') next = char.toUpperCase();
    else if (capitalize === 'words') {
      next = value === '' || /[\s-]$/.test(value) ? char.toUpperCase() : char.toLowerCase();
    } else next = char.toLowerCase();
    onChange(value + next);
  }

  const backspace = () => onChange(value.slice(0, -1));

  if (layout === 'numeric') {
    const toggleSign = () => onChange(value.startsWith('-') ? value.slice(1) : `-${value}`);
    const keyClass = 'h-20 text-3xl';
    return (
      <div className="mx-auto flex w-full max-w-md flex-col gap-2">
        {[['7', '8', '9'], ['4', '5', '6'], ['1', '2', '3']].map((row) => (
          <div key={row.join('')} className="flex gap-2">
            {row.map((digit) => (
              <Key key={digit} className={keyClass} onPress={() => press(digit)}>{digit}</Key>
            ))}
          </div>
        ))}
        <div className="flex gap-2">
          <Key className={keyClass} label="Alternar sinal negativo" onPress={toggleSign}>±</Key>
          <Key className={keyClass} onPress={() => press('0')}>0</Key>
          <Key className={keyClass} label="Vírgula" onPress={() => press(',')}>,</Key>
        </div>
        <Key className="h-16 flex-none gap-2 bg-slate-100 text-lg" label="Apagar" onPress={backspace}>
          <Delete className="h-6 w-6" /> Apagar
        </Key>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-2">
      {showAccents && (
        <div className="flex gap-2">
          {ACCENTS.map((char) => (
            <Key key={char} className="bg-amber-50" onPress={() => press(char)}>
              {char.toUpperCase()}
            </Key>
          ))}
        </div>
      )}
      {ROWS.map((row, index) => (
        <div key={index} className="flex gap-2">
          {row.map((char) => (
            <Key key={char} onPress={() => press(char)}>{char.toUpperCase()}</Key>
          ))}
        </div>
      ))}
      <div className="flex gap-2">
        <Key
          className={cn('flex-[2] text-lg', showAccents && 'border-amber-400 bg-amber-100')}
          label="Mostrar acentos"
          onPress={() => setShowAccents((open) => !open)}
        >
          Á Ã Ç
        </Key>
        <Key className="flex-[6] text-lg" label="Espaço" onPress={() => press(' ')}>Espaço</Key>
        <Key className="flex-[2] bg-slate-100" label="Apagar" onPress={backspace}>
          <Delete className="h-7 w-7" />
        </Key>
      </div>
    </div>
  );
}
