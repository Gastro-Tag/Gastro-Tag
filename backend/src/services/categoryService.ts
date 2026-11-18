import { prisma } from '../prisma/client';
import { CategoryUsage } from '../domain/categories';

/** Categorias dos produtos ativos com quantos produtos usam cada grafia. */
export async function activeCategoryUsage(): Promise<CategoryUsage[]> {
  const rows = await prisma.product.groupBy({
    by: ['category'],
    where: { active: true, category: { not: null } },
    _count: { _all: true },
  });
  return rows.map((row) => ({ category: row.category, count: row._count._all }));
}

/** Categorias das regras de categoria ativas, da mais recente para a mais antiga (grafia exata gravada). */
export async function activeRuleCategories(): Promise<string[]> {
  const rows = await prisma.shelfLifeRule.findMany({
    where: { active: true, productId: null, category: { not: null } },
    select: { category: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
  });
  return rows.map((row) => row.category!);
}
