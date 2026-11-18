function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Ex.: "5 produtos, 7 combinações sem regra". */
export function semRegraResumo(total: number, missingCount: number): string {
  return `${plural(total, 'produto', 'produtos')}, ${plural(missingCount, 'combinação', 'combinações')} sem regra`;
}

/** Ex.: "usa 7 dias do cadastro do produto". */
export function usaDiasDoCadastro(days: number): string {
  return `usa ${plural(days, 'dia', 'dias')} do cadastro do produto`;
}

/** Corpo da confirmação ao ligar o bloqueio. */
export function confirmaBloqueio(counts: { total: number; missingCount: number } | null): string {
  if (!counts) return 'Não foi possível calcular quantos produtos ficarão bloqueados. Ligar mesmo assim?';
  const { total, missingCount } = counts;
  if (total === 0) return 'Nenhum produto ficará bloqueado: todos já têm regra validada.';
  return `${plural(total, 'produto', 'produtos')} (${plural(missingCount, 'combinação', 'combinações')}) ${total === 1 ? 'ficará bloqueado até ganhar' : 'ficarão bloqueados até ganharem'} regra.`;
}

/** Texto do toast depois de salvar a exigência. */
export function toastBloqueio(ligado: boolean, blockedProducts: number, blockedCombinations: number): string {
  if (!ligado) return 'Exigência desligada. Etiquetas sem regra voltam a sair com aviso.';
  if (blockedProducts === 0) return 'Exigência ligada. Nenhum produto está bloqueado.';
  return `Exigência ligada. ${plural(blockedProducts, 'produto bloqueado', 'produtos bloqueados')} (${plural(blockedCombinations, 'combinação', 'combinações')}) até ${blockedProducts === 1 ? 'ganhar' : 'ganharem'} regra.`;
}

/** Ex.: "bloqueado: não imprime". */
export const BLOQUEADO_NAO_IMPRIME = 'bloqueado: não imprime';

export const RULE_REQUIRED_CODE = 'RULE_REQUIRED';
