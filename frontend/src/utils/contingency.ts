import type { ContingencyOutcome, ContingencyPreview, ContingencyRecordDTO, DiscardReason, StorageType } from '@/types';

// Lógica pura do formulário "Lançar etiqueta de papel" (plano B). Não imprime nada; o servidor calcula o descarte.

export interface ContingencyForm {
  productId: string;
  storageType: StorageType;
  lot: string;
  originalExpiryDate: string;  // YYYY-MM-DD
  openedAtLocal: string;       // valor de <input type="datetime-local">
  responsibleName: string;
  paperRef: string;
  outcome: ContingencyOutcome;
  discardReason: DiscardReason | '';
  note: string;
  outageId: string;
}

export const EMPTY_CONTINGENCY_FORM: ContingencyForm = {
  productId: '', storageType: 'REFRIGERADO', lot: '', originalExpiryDate: '', openedAtLocal: '',
  responsibleName: '', paperRef: '', outcome: 'EM_USO', discardReason: '', note: '', outageId: '',
};

export const CONTINGENCY_OUTCOME_LABEL: Record<ContingencyOutcome, string> = {
  EM_USO: 'Ainda em uso',
  USADO: 'Usado',
  DESCARTADO: 'Descartado',
};

const pad = (n: number) => String(n).padStart(2, '0');

/** Data/hora local no formato do `datetime-local` (YYYY-MM-DDTHH:mm). */
export function toLocalInput(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** `datetime-local` (hora do aparelho) para ISO UTC; null se vazio ou inválido. */
export function localInputToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

const OTHER_NOTE_MIN = 3;

/** Primeiro erro do formulário (mensagem curta em pt-BR) ou null se está pronto para calcular/registrar. */
export function validateContingencyForm(form: ContingencyForm, now: Date = new Date()): string | null {
  if (!form.productId) return 'Escolha o produto.';
  if (!form.lot.trim()) return 'Informe o lote.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.originalExpiryDate)) return 'Informe a validade do fabricante.';
  const openedIso = localInputToIso(form.openedAtLocal);
  if (!openedIso) return 'Informe a data e a hora da abertura.';
  if (new Date(openedIso).getTime() > now.getTime() + 60_000) return 'A abertura não pode estar no futuro.';
  if (!form.responsibleName.trim()) return 'Informe o responsável da folha.';
  if (form.outcome === 'DESCARTADO') {
    if (!form.discardReason) return 'Informe o motivo do descarte.';
    if (form.discardReason === 'OUTRO' && form.note.trim().length < OTHER_NOTE_MIN) return 'Descreva o motivo na observação (mínimo 3 caracteres).';
  }
  return null;
}

/** Corpo da API. Chame só depois de `validateContingencyForm` devolver null. */
export function buildContingencyDTO(form: ContingencyForm): ContingencyRecordDTO {
  const openedAt = localInputToIso(form.openedAtLocal);
  if (!openedAt) throw new Error('Data de abertura inválida.');
  return {
    productId: form.productId,
    storageType: form.storageType,
    lot: form.lot.trim(),
    originalExpiryDate: form.originalExpiryDate,
    openedAt,
    responsibleName: form.responsibleName.trim(),
    paperRef: form.paperRef.trim() || undefined,
    note: form.note.trim() || undefined,
    outcome: form.outcome,
    discardReason: form.outcome === 'DESCARTADO' && form.discardReason ? form.discardReason : undefined,
    outageId: form.outageId || undefined,
  };
}

/** Linhas do resultado do "Calcular": regra e aviso de vencido. */
export function previewSummary(preview: ContingencyPreview): { ruleText: string; warning: string | null } {
  const ruleText = preview.rule.validated
    ? `Regra validada${preview.rule.version ? ` (v${preview.rule.version})` : ''}${preview.rule.source ? ` · ${preview.rule.source}` : ''}`
    : 'sem regra validada';
  return { ruleText, warning: preview.expired ? 'Já venceu: registre como descartado ou usado.' : null };
}

/** "Em uso" com cálculo já vencido não é aceito pelo servidor; evita o envio inútil. */
export function blocksEmUso(preview: ContingencyPreview | null, outcome: ContingencyOutcome): boolean {
  return outcome === 'EM_USO' && !!preview?.expired;
}
