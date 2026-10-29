import { create } from 'zustand';
import { getOperator, getRecentOperators, rememberOperator } from '@/utils/totem';

interface TotemState {
  operator: string;
  recents: string[];
  operatorSheetOpen: boolean;
  setOperator: (name: string) => void;
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
  openOperatorSheet: () => set({ operatorSheetOpen: true }),
  closeOperatorSheet: () => set({ operatorSheetOpen: false }),
}));
