import { useEffect, useRef, useState } from 'react';
import { Plus, ShieldCheck, User } from 'lucide-react';
import { totemApi } from '@/services';
import { extractError } from '@/services/api';
import type { TotemOperator } from '@/types';
import { useTotemStore } from '@/store/totemStore';
import { cleanName } from '@/utils/totem';
import { cn } from '@/utils/cn';
import { KeyboardSheet } from './KeyboardSheet';

/** "Quem está manipulando?" — escolhido uma vez por turno e impresso na etiqueta. */
export function OperatorSheet() {
  const { operator, handlerToken, recents, operatorSheetOpen, setOperator, setVerifiedOperator, closeOperatorSheet } = useTotemStore();
  const [typing, setTyping] = useState(false);
  // Operadores com PIN: lista do servidor. Sem rede ou sem ninguém com PIN, o fluxo de nome digitado segue igual.
  const [pinOperators, setPinOperators] = useState<TotemOperator[]>([]);
  const [loadingPin, setLoadingPin] = useState(false);
  const [pinFor, setPinFor] = useState<TotemOperator | null>(null);
  // Já houve interação (teclado aberto, PIN): a resposta tardia da lista não pode mudar a tela.
  const touched = useRef(false);

  useEffect(() => {
    if (!operatorSheetOpen) return;
    let active = true;
    touched.current = false;
    setTyping(false);
    setPinFor(null);
    setLoadingPin(true);
    const finish = (list: TotemOperator[]) => {
      if (!active) return;
      setPinOperators(list);
      setLoadingPin(false);
      // Ninguém com PIN nem nos recentes: vai direto ao teclado, como antes.
      // Só liga o teclado, e só se ninguém interagiu ainda.
      if (!touched.current && list.length === 0 && useTotemStore.getState().recents.length === 0) setTyping(true);
    };
    totemApi.operators()
      .then(({ data }) => finish(data.data))
      .catch(() => finish([]));
    return () => { active = false; };
  }, [operatorSheetOpen]);

  if (!operatorSheetOpen) return null;

  if (pinFor) {
    const target = pinFor;
    return (
      <KeyboardSheet
        title={`PIN de ${target.name}`}
        hint="Digite o PIN de 4 a 6 dígitos."
        placeholder="PIN"
        layout="date"
        maxLength={6}
        displayValue={(value) => '•'.repeat(value.length)}
        announce={(value) => `${value.length} ${value.length === 1 ? 'dígito digitado' : 'dígitos digitados'}`}
        confirmLabel="Confirmar PIN"
        onCancel={() => setPinFor(null)}
        onConfirm={async (value) => {
          if (!/^\d{4,6}$/.test(value)) return 'O PIN tem de 4 a 6 dígitos.';
          try {
            const { data } = await totemApi.verifyOperator(target.id, value);
            const { operator: verified, handlerToken: token, expiresAt } = data.data;
            setVerifiedOperator(verified, token, expiresAt);
          } catch (err) {
            return extractError(err);
          }
        }}
      />
    );
  }

  if (typing) {
    return (
      <KeyboardSheet
        title="Quem está manipulando?"
        hint="O nome sai impresso na etiqueta como responsável."
        placeholder="Digite o nome"
        capitalize="words"
        maxLength={100}
        confirmLabel="Salvar nome"
        onCancel={() => (recents.length > 0 || pinOperators.length > 0 ? setTyping(false) : closeOperatorSheet())}
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
        <p className="mb-3 mt-0.5 shrink-0 text-sm font-medium text-slate-500 sm:mb-5 sm:text-base [@media(max-height:500px)]:mb-2">
          {pinOperators.length > 0 ? 'Toque no seu nome. Quem tem PIN confirma o PIN.' : 'Toque no seu nome.'}
        </p>

        {/* A lista rola por dentro quando a tela é baixa; o botão Fechar fica sempre à vista. */}
        <div className="grid min-h-0 grid-cols-1 gap-3 overflow-y-auto overscroll-contain min-[480px]:grid-cols-2 sm:grid-cols-3">
          {pinOperators.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => { touched.current = true; setPinFor(item); }}
              className={cn(
                'flex min-h-[64px] touch-manipulation items-center gap-3 rounded-2xl border-2 bg-white px-4 py-2 text-left text-lg font-bold sm:min-h-20 sm:px-5 sm:text-xl',
                'transition-transform active:scale-95',
                handlerToken && item.name === operator ? 'border-brand-500 text-brand-700' : 'border-slate-200 text-charcoal-800',
              )}
            >
              <ShieldCheck className="h-6 w-6 shrink-0 text-emerald-600" />
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 block break-words">{item.name}</span>
                <span className="block text-sm font-semibold text-slate-500">Com PIN</span>
              </span>
            </button>
          ))}
          {recents.filter((name) => !pinOperators.some((item) => item.name.toLowerCase() === name.toLowerCase())).map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setOperator(name)}
              className={cn(
                'flex min-h-[64px] touch-manipulation items-center gap-3 rounded-2xl border-2 bg-white px-4 py-2 text-left text-lg font-bold sm:min-h-20 sm:px-5 sm:text-xl',
                'transition-transform active:scale-95',
                name === operator && !handlerToken ? 'border-brand-500 text-brand-700' : 'border-slate-200 text-charcoal-800',
              )}
            >
              <User className="h-6 w-6 shrink-0 text-slate-400" />
              <span className="line-clamp-2 min-w-0 break-words">{name}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => { touched.current = true; setTyping(true); }}
            className="flex min-h-[64px] touch-manipulation items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 bg-white/60 text-lg font-bold text-slate-600 active:scale-95 sm:min-h-20 sm:text-xl"
          >
            <Plus className="h-6 w-6" /> Outro nome
          </button>
        </div>

        {loadingPin && <p className="mt-2 shrink-0 text-sm font-semibold text-slate-400">Buscando operadores com PIN…</p>}

        <button type="button" onClick={closeOperatorSheet} className="btn btn-outline mt-3 h-14 w-full shrink-0 text-lg sm:mt-5 sm:h-16">
          Fechar
        </button>
      </div>
    </div>
  );
}
