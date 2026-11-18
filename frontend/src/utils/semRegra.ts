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
