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
      <div className="flex max-h-[100dvh] w-full max-w-5xl flex-col rounded-t-3xl bg-slate-100 p-4 pb-4 shadow-2xl sm:rounded-t-[32px] sm:p-6 sm:pb-8 [@media(max-height:500px)]:rounded-none [@media(max-height:500px)]:p-3 [@media(max-height:500px)]:pb-3">
        <h2 className="shrink-0 text-xl font-extrabold text-charcoal-800 sm:text-2xl">Quem está manipulando?</h2>
        <p className="mb-3 mt-0.5 shrink-0 text-sm font-medium text-slate-500 sm:mb-5 sm:text-base [@media(max-height:500px)]:mb-2">Toque no seu nome.</p>

        {/* A lista rola por dentro quando a tela é baixa; o botão Fechar fica sempre à vista. */}
        <div className="grid min-h-0 grid-cols-1 gap-3 overflow-y-auto overscroll-contain min-[480px]:grid-cols-2 sm:grid-cols-3">
          {recents.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setOperator(name)}
              className={cn(
                'flex min-h-[64px] touch-manipulation items-center gap-3 rounded-2xl border-2 bg-white px-4 py-2 text-left text-lg font-bold sm:min-h-20 sm:px-5 sm:text-xl',
                'transition-transform active:scale-95',
                name === operator ? 'border-brand-500 text-brand-700' : 'border-slate-200 text-charcoal-800',
              )}
            >
              <User className="h-6 w-6 shrink-0 text-slate-400" />
              <span className="line-clamp-2 min-w-0 break-words">{name}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => setTyping(true)}
            className="flex min-h-[64px] touch-manipulation items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 bg-white/60 text-lg font-bold text-slate-600 active:scale-95 sm:min-h-20 sm:text-xl"
          >
            <Plus className="h-6 w-6" /> Outro nome
          </button>
        </div>

        <button type="button" onClick={closeOperatorSheet} className="btn btn-outline mt-3 h-14 w-full shrink-0 text-lg sm:mt-5 sm:h-16">
          Fechar
        </button>
      </div>
    </div>
  );
}
