// Desbloqueio do PIN pelo ADMIN. O limitador do PIN conta erros por aparelho (IP) + operador, e o admin
// não sabe de qual aparelho veio o bloqueio. Em vez de apagar a chave exata (resetKey precisaria do IP),
// cada operador tem uma "geração" que entra na chave: subir a geração solta o bloqueio em todos os
// aparelhos de uma vez. As contagens antigas ficam órfãs e somem sozinhas no fim da janela de 15 min.
// Fica em memória, como o próprio limitador: reiniciar a API também zera os bloqueios.
const generations = new Map<string, number>();

export function pinLockoutGeneration(userId: string): number {
  return generations.get(userId) ?? 0;
}

export function releasePinLockout(userId: string): void {
  generations.set(userId, pinLockoutGeneration(userId) + 1);
}
