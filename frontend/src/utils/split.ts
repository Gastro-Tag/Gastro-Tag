import { labelApi } from '@/services';
import type { SplitResult } from '@/types';
import { printLabel } from './printLabel';

/**
 * Imprime as filhas de um fracionamento (1 cópia cada, num único trabalho de impressão)
 * e registra a impressão de cada uma. Cada registro tem tratamento próprio: a falha de uma
 * não impede as outras (o contador é secundário; as etiquetas já estão salvas e impressas).
 */
export async function printSplitChildren(result: SplitResult, logoUrl: string | null, fractionedAt?: string): Promise<void> {
  // Garante a linha "Fracionado de ..." mesmo que o servidor não devolva `parent` nas filhas.
  const children = result.children.map((child) => ({
    ...child,
    parent: child.parent ?? { id: result.parent.id, shortCode: result.parent.shortCode },
    fractionedAt: child.fractionedAt ?? fractionedAt ?? null,
  }));
  printLabel(children, logoUrl, 1);
  await Promise.allSettled(children.map((child) => labelApi.registerPrint(child.id)));
}
