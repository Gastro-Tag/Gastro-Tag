import { useEffect, useState } from 'react';
import { Plus, User } from 'lucide-react';
import { useTotemStore } from '@/store/totemStore';
import { cleanName } from '@/utils/totem';
import { cn } from '@/utils/cn';
import { KeyboardSheet } from './KeyboardSheet';

/** "Quem está manipulando?" — escolhido uma vez por turno e impresso na etiqueta. */
export function OperatorSheet() {
  const { operator, recents, operatorSheetOpen, setOperator, closeOperatorSheet } = useTotemStore();
  const [typing, setTyping] = useState(false);

  useEffect(() => {
    if (operatorSheetOpen) setTyping(recents.length === 0);
  }, [operatorSheetOpen, recents.length]);

  if (!operatorSheetOpen) return null;

  if (typing) {
    return (
      <KeyboardSheet
        title="Quem está manipulando?"
        hint="O nome sai impresso na etiqueta como responsável."
        placeholder="Digite o nome"
        capitalize="words"
        maxLength={100}
        confirmLabel="Salvar nome"
        onCancel={() => (recents.length > 0 ? setTyping(false) : closeOperatorSheet())}
        onConfirm={(value) => {
          const name = cleanName(value);
          if (name.length < 2) return 'Digite o nome do responsável.';
          setOperator(name);
        }}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/55" role="dialog" aria-modal="true" aria-label="Responsável">
      <div className="w-full max-w-5xl rounded-t-[32px] bg-slate-100 p-6 pb-8 shadow-2xl">
        <h2 className="text-2xl font-extrabold text-charcoal-800">Quem está manipulando?</h2>
        <p className="mb-5 mt-0.5 text-base font-medium text-slate-500">Toque no seu nome.</p>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {recents.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setOperator(name)}
              className={cn(
                'flex h-20 touch-manipulation items-center gap-3 rounded-2xl border-2 bg-white px-5 text-left text-xl font-bold',
                'transition-transform active:scale-95',
                name === operator ? 'border-brand-500 text-brand-700' : 'border-slate-200 text-charcoal-800',
              )}
            >
              <User className="h-6 w-6 shrink-0 text-slate-400" />
              <span className="min-w-0 truncate">{name}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => setTyping(true)}
            className="flex h-20 touch-manipulation items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 bg-white/60 text-xl font-bold text-slate-600 active:scale-95"
          >
            <Plus className="h-6 w-6" /> Outro nome
          </button>
        </div>

        <button type="button" onClick={closeOperatorSheet} className="btn btn-outline mt-5 h-16 w-full text-lg">
          Fechar
        </button>
      </div>
    </div>
  );
}
