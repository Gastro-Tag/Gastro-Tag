import type { DiscardReason, Label, LabelOutcome } from '@/types';

export const OUTCOME_LABEL: Record<LabelOutcome, string> = {
  USADO: 'Usado',
  DESCARTADO: 'Descartado',
  CANCELADO: 'Cancelado',
};

export const REASON_LABEL: Record<DiscardReason, string> = {
  PRAZO_VENCIDO: 'Prazo vencido',
  ALTERACAO_SENSORIAL: 'Alteração sensorial',
  EMBALAGEM_DANIFICADA: 'Embalagem danificada',
  OUTRO: 'Outro',
};

export const REASON_OPTIONS = Object.keys(REASON_LABEL) as DiscardReason[];

/** Texto do destino: "Descartado · Prazo vencido". Vazio para etiqueta ativa. */
export function outcomeText(label: Pick<Label, 'status' | 'outcome' | 'discardReason'>): string {
  if (label.status !== 'ENCERRADA' || !label.outcome) return '';
  const reason = label.outcome === 'DESCARTADO' && label.discardReason ? ` · ${REASON_LABEL[label.discardReason]}` : '';
  return `${OUTCOME_LABEL[label.outcome]}${reason}`;
}
