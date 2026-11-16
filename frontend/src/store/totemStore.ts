import { create } from 'zustand';
import {
  clearOperator, getHandlerToken, getOperator, getRecentOperators, rememberOperator, rememberVerifiedOperator,
} from '@/utils/totem';

interface TotemState {
  operator: string;
  /** Token do operador confirmado por PIN (vazio com nome digitado). Só espelha o localStorage. */
  handlerToken: string;
  recents: string[];
  operatorSheetOpen: boolean;
  /** Nome digitado, sem PIN. */
  setOperator: (name: string) => void;
  /** Operador que confirmou o PIN no servidor. */
  setVerifiedOperator: (operator: { id: string; name: string }, handlerToken: string, expiresAt: string) => void;
  /** O servidor recusou o token: esquece o operador e pede de novo. */
  invalidateOperator: () => void;
  syncOperator: () => void;
  openOperatorSheet: () => void;
  closeOperatorSheet: () => void;
}

export const useTotemStore = create<TotemState>((set) => ({
  operator: getOperator(),
  handlerToken: getHandlerToken(),
  recents: getRecentOperators(),
  operatorSheetOpen: false,

  setOperator: (name) => {
    rememberOperator(name);
    set({ operator: getOperator(), handlerToken: getHandlerToken(), recents: getRecentOperators(), operatorSheetOpen: false });
  },
  setVerifiedOperator: (operator, handlerToken, expiresAt) => {
    rememberVerifiedOperator(operator, handlerToken, expiresAt);
    set({ operator: getOperator(), handlerToken: getHandlerToken(), operatorSheetOpen: false });
  },
  invalidateOperator: () => {
    clearOperator();
    set({ operator: '', handlerToken: '', operatorSheetOpen: true });
  },
  // Aplica a expiração do turno com o totem aberto, sem precisar recarregar a página.
  syncOperator: () => set((state) => {
    const operator = getOperator();
    const handlerToken = getHandlerToken();
    return operator === state.operator && handlerToken === state.handlerToken ? state : { operator, handlerToken };
  }),
  openOperatorSheet: () => set({ operatorSheetOpen: true }),
  closeOperatorSheet: () => set({ operatorSheetOpen: false }),
}));
