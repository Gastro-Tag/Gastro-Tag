import type { ProductLot } from '@/types';

type LotLike = Pick<ProductLot, 'id' | 'expiryDate' | 'daysUntilExpiry'>;

/**
 * Lotes que devem ser usados primeiro: os de menor validade entre os utilizáveis (não vencidos).
 * Só faz sentido com mais de um lote; empate marca todos. Não pré-seleciona nada: a validade
 * da etiqueta é sempre a da embalagem em mãos.
 */
export function firstToUseLotIds(lots: LotLike[]): Set<string> {
  if (lots.length < 2) return new Set();
  const earliest = lots.reduce((min, lot) => (lot.expiryDate < min ? lot.expiryDate : min), lots[0].expiryDate);
  const first = lots.filter((lot) => lot.expiryDate === earliest);
  // Todos com a mesma validade: o selo não ajuda a escolher.
  return first.length === lots.length ? new Set() : new Set(first.map((lot) => lot.id));
}

/** "vence hoje", "vence amanhã", "vence em N dias" — dias contados pelo servidor (data da cozinha). */
export function expiresInText(days: number): string {
  if (days <= 0) return 'vence hoje';
  if (days === 1) return 'vence amanhã';
  return `vence em ${days} dias`;
}
