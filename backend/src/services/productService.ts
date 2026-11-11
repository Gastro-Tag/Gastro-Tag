import { Prisma } from '@prisma/client';
import { prisma } from '../prisma/client';
import { Errors } from '../utils/errors';
import {
  PENDING_LOT_CODE, addDays, daysUntil, getExpiryStatus, kitchenToday, kitchenWeekAgo, summarizeLots,
} from '../utils/dateUtils';

export type ProductStatus = 'all' | 'valid' | 'expiring' | 'expired' | 'recent' | 'no_lot';
export type ProductSort   = 'name' | 'brand' | 'date' | 'created';
export type SortOrder     = 'asc' | 'desc';

export interface ProductFilters {
  search?:   string;
  status?:   ProductStatus;
  storage?:  'refrigerado' | 'congelado';
  category?: string;
  sort?:     ProductSort;
  order?:    SortOrder;
  page?:     number;
  limit?:    number;
}

const activeLots = { where: { active: true }, orderBy: { expiryDate: 'asc' } } as const;

/** Mesma regra de `summarizeLots`, em forma de consulta. */
export function lotStatusWhere(status: 'valid' | 'expiring' | 'expired', today: Date): Prisma.ProductWhereInput {
  const in7Days = addDays(today, 7);
  if (status === 'expired') return { lots: { some: { active: true, expiryDate: { lt: today } } } };
  if (status === 'expiring') {
    return { lots: {
      none: { active: true, expiryDate: { lt: today } },
      some: { active: true, expiryDate: { gte: today, lte: in7Days } },
    } };
  }
  return { lots: { none: { active: true, expiryDate: { lte: in7Days } }, some: { active: true } } };
}

export const ProductService = {
  async list(filters: ProductFilters) {
    const {
      search, status = 'all', storage,
      category, sort = 'name', order = 'asc',
      page = 1, limit = 20,
    } = filters;

    const skip = (page - 1) * limit;
    const now = kitchenToday();

    // ── Build WHERE ────────────────────────────────────
    const where: Prisma.ProductWhereInput = { active: true };

    // Texto
    if (search) {
      where.OR = [
        { name:  { contains: search, mode: 'insensitive' } },
        { brand: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Categoria
    if (category) {
      where.category = { equals: category, mode: 'insensitive' };
    }

    // Tipo de armazenamento
    if (storage === 'refrigerado') where.daysValidRefrigerated = { gt: 0 };
    if (storage === 'congelado')   where.daysValidFrozen       = { gt: 0 };

    // Status baseado na validade dos lotes ativos
    if (status === 'valid' || status === 'expiring' || status === 'expired') {
      Object.assign(where, lotStatusWhere(status, now));
    }
    if (status === 'no_lot') where.lots      = { none: { active: true } };
    if (status === 'recent') where.createdAt = { gte: kitchenWeekAgo() };

    // ── Build ORDER BY ─────────────────────────────────
    const orderBy: Prisma.ProductOrderByWithRelationInput =
      sort === 'name'  ? { name:      order } :
      sort === 'brand' ? { brand:     order } :
      /* created */      { createdAt: order };
    const include = { lots: activeLots, _count: { select: { labels: true } } };

    // ── Execute ────────────────────────────────────────
    const total = await prisma.product.count({ where });
    let items;
    if (sort === 'date') {
      // A data está nos lotes: ordena em memória, sempre com produtos sem lote no fim.
      const direction = order === 'asc' ? 1 : -1;
      const firstExpiry = (lots: { expiryDate: Date }[]) => lots[0]?.expiryDate.getTime() ?? null;
      const all = await prisma.product.findMany({ where, include, orderBy: [{ name: 'asc' }, { id: 'asc' }] });
      items = all.sort((a, b) => {
        const [dateA, dateB] = [firstExpiry(a.lots), firstExpiry(b.lots)];
        if (dateA === null || dateB === null) return (dateA === null ? 1 : 0) - (dateB === null ? 1 : 0);
        return (dateA - dateB) * direction;
      }).slice(skip, skip + limit);
    } else {
      items = await prisma.product.findMany({ where, orderBy, skip, take: limit, include });
    }

    // Enrich with computed fields
    const data = items.map(({ lots, ...p }) => ({
      ...p,
      ...summarizeLots(lots),
      labelCount: p._count.labels,
    }));

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasNext:    page * limit < total,
        hasPrev:    page > 1,
      },
    };
  },

  async getById(id: string) {
    const product = await prisma.product.findUnique({
      where: { id, active: true },
      include: {
        lots: activeLots,
        labels: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: { user: { select: { name: true } } },
        },
        _count: { select: { labels: true } },
      },
    });
    if (!product) throw Errors.notFound('Produto');
    return {
      ...product,
      ...summarizeLots(product.lots),
      lots: product.lots.map((lot) => ({
        ...lot,
        needsReview:     lot.code === PENDING_LOT_CODE,
        daysUntilExpiry: daysUntil(lot.expiryDate),
        computedStatus:  getExpiryStatus(lot.expiryDate),
      })),
      labelCount: product._count.labels,
    };
  },

  async create(data: {
    name: string;
    brand: string;
    category?: string;
    daysValidRefrigerated: number;
    daysValidFrozen: number;
    unit?: string;
    notes?: string;
  }) {
    return prisma.product.create({ data });
  },

  async update(id: string, data: Partial<{
    name: string;
    brand: string;
    category: string;
    daysValidRefrigerated: number;
    daysValidFrozen: number;
    unit: string;
    notes: string;
  }>) {
    const current = await prisma.product.findUnique({ where: { id, active: true } });
    if (!current) throw Errors.notFound('Produto');
    if (
      (data.daysValidRefrigerated ?? current.daysValidRefrigerated) <= 0 &&
      (data.daysValidFrozen ?? current.daysValidFrozen) <= 0
    ) throw Errors.validation('O produto precisa manter ao menos um tipo de validade pós-abertura.');
    return prisma.product.update({ where: { id }, data });
  },

  async remove(id: string) {
    await ProductService.getById(id);
    // Soft delete
    return prisma.product.update({ where: { id }, data: { active: false } });
  },

  async getCategories() {
    const rows = await prisma.product.findMany({
      where:   { active: true, category: { not: null } },
      select:  { category: true },
      distinct: ['category'],
      orderBy: { category: 'asc' },
    });
    return rows.map((r) => r.category).filter(Boolean);
  },
};
