/** Valor interno da opção "Outra…" na caixa de categoria (nunca é enviado à API). */
export const OTHER_CATEGORY = '__outra__';

export const CATEGORY_MAX_LENGTH = 60;

/** Ignora caixa, acentos e espaços repetidos/nas pontas. */
export function normalizeCategory(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Singular simples: tira "s" ou "es" finais de palavras com 4+ letras. */
function singular(word: string): string {
  return word
    .split(' ')
    .map((w) => (w.length > 4 && w.endsWith('es') ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w))
    .join(' ');
}

/**
 * Opções da caixa de categoria: a lista + a categoria atual do produto com a grafia exata
 * (se ainda não estiver na lista), em ordem alfabética.
 */
export function buildCategoryOptions(list: string[], current: string): string[] {
  const options = [...list];
  if (current && current !== OTHER_CATEGORY && !options.includes(current)) {
    options.push(current);
    options.sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }
  return options;
}

/** True se os textos são o mesmo, ignorando caixa, acentos e espaços. */
export function isSameCategory(a: string, b: string): boolean {
  return normalizeCategory(a) === normalizeCategory(b);
}

/**
 * Procura, entre as opções, uma equivalente (caixa/acentos/espaços) ou muito parecida
 * (singular/plural simples ou distância de edição pequena). Devolve a grafia da opção.
 */
export function findSimilarCategory(text: string, options: string[]): string | null {
  const target = normalizeCategory(text);
  if (!target) return null;

  let best: { option: string; dist: number } | null = null;
  for (const option of options) {
    const norm = normalizeCategory(option);
    if (!norm) continue;
    if (norm === target) return option;

    let dist = Infinity;
    if (singular(norm) === singular(target)) {
      dist = 1;
    } else {
      // Textos curtos tolerariam trocas demais: 1 erro a cada 3 letras, no máximo 2.
      const limit = Math.min(2, Math.floor(Math.min(norm.length, target.length) / 3));
      const d = levenshtein(norm, target);
      if (d <= limit) dist = d;
    }
    if (dist !== Infinity && (!best || dist < best.dist)) best = { option, dist };
  }
  return best ? best.option : null;
}
