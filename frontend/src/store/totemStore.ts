import { create } from 'zustand';
import { getOperator, getRecentOperators, rememberOperator } from '@/utils/totem';

interface TotemState {
  operator: string;
  recents: string[];
  operatorSheetOpen: boolean;
  setOperator: (name: string) => void;
  syncOperator: () => void;
  openOperatorSheet: () => void;
  closeOperatorSheet: () => void;
}

export const useTotemStore = create<TotemState>((set) => ({
  operator: getOperator(),
  recents: getRecentOperators(),
  operatorSheetOpen: false,

  setOperator: (name) => {
    rememberOperator(name);
    set({ operator: getOperator(), recents: getRecentOperators(), operatorSheetOpen: false });
  },
  // Aplica a expiração do turno com o totem aberto, sem precisar recarregar a página.
  syncOperator: () => set((state) => {
    const operator = getOperator();
    return operator === state.operator ? state : { operator };
  }),
  openOperatorSheet: () => set({ operatorSheetOpen: true }),
  closeOperatorSheet: () => set({ operatorSheetOpen: false }),
}));
