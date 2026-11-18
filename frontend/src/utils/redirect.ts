/**
 * Página para onde voltar depois do login. Só aceita caminho interno do painel: começa com "/",
 * não com "//" nem "/\" (que o navegador trata como outro site), e não é o próprio login nem o totem.
 */
export function safeNext(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/';
  if (value.startsWith('/login') || value.startsWith('/totem')) return '/';
  return value;
}

/** URL do login guardando a página atual (o painel volta para ela depois de entrar). */
export function loginUrl(pathname: string, search = ''): string {
  const next = safeNext(pathname + search);
  return next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`;
}
