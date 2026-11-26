import type { ReportRow } from '@/types';
import { formatBR } from './date';
import { REASON_LABEL } from './labelStatus';

/** Texto da coluna "Situação" na data de emissão do relatório (today = YYYY-MM-DD da cozinha). */
export function reportSituation(
  row: Pick<ReportRow, 'status' | 'outcome' | 'discardReason' | 'discardAt' | 'beforeClosing'>,
  today: string,
): string {
  if (row.status === 'ATIVA' && row.beforeClosing) return 'Anterior ao encerramento';
  if (row.status === 'ENCERRADA') {
    if (row.outcome === 'USADO') return 'Usada';
    if (row.outcome === 'CANCELADO') return 'Cancelada';
    if (row.outcome === 'DESCARTADO') {
      return row.discardReason ? `Descartada: ${REASON_LABEL[row.discardReason].toLowerCase()}` : 'Descartada';
    }
    return 'Encerrada';
  }
  // Datas YYYY-MM-DD comparam como texto, sem fuso do aparelho.
  return row.discardAt.slice(0, 10) < today.slice(0, 10) ? 'Ativa — vencida' : 'Ativa';
}

/** Quem encerrou, quando e a observação, em texto curto para a célula de situação. */
export function reportClosedDetail(
  row: Pick<ReportRow, 'status' | 'closedByName' | 'closedAt' | 'closeNote'>,
  formatDateTime: (iso: string) => string,
): string {
  if (row.status !== 'ENCERRADA') return '';
  const who = [row.closedByName, row.closedAt ? formatDateTime(row.closedAt) : null].filter(Boolean).join(', ');
  return [who, row.closeNote ? `"${row.closeNote}"` : null].filter(Boolean).join(' · ');
}

/** "dd/mm/aaaa a dd/mm/aaaa" (datas date-only, sem deslocar fuso). */
export function reportPeriodText(from: string, to: string): string {
  return `${formatBR(from)} a ${formatBR(to)}`;
}

/** Lote com a marca de "outra embalagem" quando a validade foi digitada na hora. */
export function reportLotText(row: Pick<ReportRow, 'lot' | 'lotSource'>): string {
  return row.lotSource === 'informado' ? `${row.lot} (outra embalagem)` : row.lot;
}

/** Nome do cabeçalho; sem nome definido, um aviso explícito. */
export function reportKitchenTitle(name: string | null | undefined): string {
  const trimmed = name?.trim();
  return trimmed ? trimmed : 'Cozinha (nome não definido)';
}

/** Mesmo limite do servidor para nome da cozinha e responsável técnico. */
export const REPORT_HEADER_MAX = 80;
