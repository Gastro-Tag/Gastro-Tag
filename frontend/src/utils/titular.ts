/** Lógica pura dos direitos do titular na tela Usuários (exportar e remover dados pessoais). */

/** A remoção só é liberada quando o nome digitado confere com o do usuário (ignorando espaços nas pontas). */
export function canConfirmPseudonymize(typed: string, userName: string): boolean {
  const expected = userName.trim();
  return expected.length > 0 && typed.trim() === expected;
}

/** Nome do arquivo de exportação: o do cabeçalho Content-Disposition ou `titular-<8 do id>.json`. */
export function exportFilename(disposition: string | undefined | null, userId: string): string {
  const fromHeader = /filename="?([^";]+)"?/i.exec(String(disposition ?? ''))?.[1]?.trim();
  return fromHeader || `titular-${userId.slice(0, 8)}.json`;
}
