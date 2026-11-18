/**
 * Categorias de produto: comparação tolerante e grafia que fica gravada. Funções puras.
 */

/**
 * Grupos comuns de cozinha, só para organizar o cadastro e sugerir na caixa de seleção.
 * Não são classificação regulatória (ANVISA/RDC) nem definem prazo de validade.
 */
export const DEFAULT_CATEGORIES = [
  'Laticínios',
  'Carnes',
  'Aves',
  'Pescados',
  'Frios e embutidos',
  'Hortifrúti',
  'Ovos',
  'Molhos e condimentos',
  'Massas',
  'Grãos e cereais',
  'Panificação',
  'Sobremesas',
  'Bebidas',
] as const;

/** Compara categorias sem diferenciar maiúsculas, acentos e espaços nas pontas. */
export const normalizeCategory = (value: string) =>
  value.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

/** Tira espaços das pontas e junta espaços repetidos; texto vazio vira `null` (sem categoria). */
export function cleanCategoryInput(value: string | null | undefined): string | null {
  if (value == null) return null;
  const cleaned = value.trim().replace(/\s+/g, ' ');
  return cleaned === '' ? null : cleaned;
}

export interface CategoryUsage {
  category: string | null;
  count: number;
}

/**
 * Chave para escolher a grafia ao gravar o produto: como `normalizeCategory`, mas também junta espaços
 * internos repetidos ("Frios  e embutidos" = "frios e embutidos"). Só serve para escolher a grafia;
 * regra de categoria, lock e cálculo da etiqueta continuam usando o texto exato gravado.
 */
export const categoryKey = (value: string) => normalizeCategory(value).replace(/\s+/g, ' ');

/**
 * Entre as grafias em uso equivalentes a `category`, a mais usada (empate: ordem alfabética).
 * `null` quando nenhuma é equivalente. `key` define a equivalência (padrão: `normalizeCategory`,
 * a usada nas regras de categoria).
 */
export function pickUsedSpelling(
  category: string, usage: CategoryUsage[], key: (value: string) => string = normalizeCategory,
): string | null {
  const wanted = key(category);
  const match = usage
    .filter((row): row is { category: string; count: number } =>
      row.category !== null && key(row.category) === wanted)
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category))[0];
  return match?.category ?? null;
}

export interface CategorySources {
  /** Categorias dos produtos ativos com a contagem de cada grafia. */
  usage: CategoryUsage[];
  /** Categorias das regras de categoria ativas, da mais recente para a mais antiga. */
  ruleCategories?: string[];
  /** Na edição: a categoria gravada hoje no produto. */
  current?: string | null;
}

/**
 * Grafia a gravar no produto, comparando por `categoryKey`. Vazio vira `null`. Ordem:
 * 1. na edição, a categoria atual do produto, se equivalente (não troca a grafia de quem já tem regra);
 * 2. a de uma regra de categoria ativa (a mais recente), para o produto pegar a regra;
 * 3. a mais usada nos produtos ativos;
 * 4. a da lista padrão;
 * 5. o texto digitado, limpo.
 */
export function resolveCategory(value: string | null | undefined, sources: CategorySources): string | null {
  const cleaned = cleanCategoryInput(value);
  if (cleaned === null) return null;
  const wanted = categoryKey(cleaned);
  const { usage, ruleCategories = [], current } = sources;
  if (current && categoryKey(current) === wanted) return current;
  const fromRule = ruleCategories.find((item) => categoryKey(item) === wanted);
  if (fromRule !== undefined) return fromRule;
  const used = pickUsedSpelling(cleaned, usage, categoryKey);
  if (used !== null) return used;
  return DEFAULT_CATEGORIES.find((item) => categoryKey(item) === wanted) ?? cleaned;
}

/**
 * Categorias em uso mais a lista padrão, sem repetir equivalentes (`categoryKey`), em ordem pt-BR.
 * Grafia de cada uma: a de uma regra de categoria ativa (a mais recente); senão, a mais usada; senão,
 * a da lista padrão. Categorias que só existem em regras (sem produto ativo) não entram.
 */
export function mergeWithDefaults(usage: CategoryUsage[], ruleCategories: string[] = []): string[] {
  const byKey = new Map<string, string>();
  const spelling = (category: string) =>
    ruleCategories.find((item) => categoryKey(item) === categoryKey(category))
    ?? pickUsedSpelling(category, usage, categoryKey)
    ?? category;
  for (const row of usage) {
    if (row.category === null) continue;
    const key = categoryKey(row.category);
    if (!byKey.has(key)) byKey.set(key, spelling(row.category));
  }
  for (const category of DEFAULT_CATEGORIES) {
    const key = categoryKey(category);
    if (!byKey.has(key)) byKey.set(key, spelling(category));
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}
