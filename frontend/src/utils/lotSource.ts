import type { LotSource } from '@/types';

export const LOT_SOURCE_OPTIONS: { value: LotSource | ''; label: string }[] = [
  { value: '', label: 'Todas as embalagens' },
  { value: 'cadastrado', label: 'Lote cadastrado' },
  { value: 'informado', label: 'Outra embalagem' },
  { value: 'anterior', label: 'Anterior aos lotes' },
];

/** Aceita só os valores que o servidor conhece (ex.: vindos da URL). */
export function parseLotSource(value: string | null | undefined): LotSource | '' {
  return value === 'cadastrado' || value === 'informado' || value === 'anterior' ? value : '';
}

/** Resumo curto para o aviso da exportação; vazio sem filtro. */
export function lotSourceText(value: LotSource | ''): string {
  return value === 'cadastrado' ? 'lote cadastrado' : value === 'informado' ? 'outra embalagem' : value === 'anterior' ? 'anterior aos lotes' : '';
}

/** "Outra embalagem": validade digitada na hora, sem lote cadastrado. */
export function isOtherPackage(label: { lotSource?: LotSource }): boolean {
  return label.lotSource === 'informado';
}
