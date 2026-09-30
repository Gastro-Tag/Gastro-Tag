import { Prisma } from '@prisma/client';
import { prisma } from '../prisma/client';
import { Errors } from '../utils/errors';
import { daysUntil, getProductStatus, kitchenToday, kitchenWeekAgo } from '../utils/dateUtils';
import { parseDateOnly } from '../domain/shelfLife';

export type ProductStatus = 'all' | 'valid' | 'expiring' | 'expired' | 'recent';
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

    // Status baseado em validade original
    const sevenDaysFromNow = new Date(now);
    sevenDaysFromNow.setUTCDate(sevenDaysFromNow.getUTCDate() + 7);
    const sevenDaysAgo = kitchenWeekAgo();

    if (status === 'valid')    where.originalExpiryDate = { gt: sevenDaysFromNow };
    if (status === 'expiring') where.originalExpiryDate = { gte: now, lte: sevenDaysFromNow };
    if (status === 'expired')  where.originalExpiryDate = { lt: now };
    if (status === 'recent')   where.createdAt          = { gte: sevenDaysAgo };

    // ── Build ORDER BY ─────────────────────────────────
    const orderBy: Prisma.ProductOrderByWithRelationInput =
      sort === 'name'    ? { name:               order } :
      sort === 'brand'   ? { brand:              order } :
      sort === 'date'    ? { originalExpiryDate: order } :
      /* created */        { createdAt:          order };

    // ── Execute ────────────────────────────────────────
    const [total, items] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where, orderBy, skip, take: limit,
        include: { _count: { select: { labels: true } } },
      }),
    ]);

    // Enrich with computed fields
    const data = items.map((p) => ({
      ...p,
      daysUntilExpiry:  daysUntil(p.originalExpiryDate),
      labelCount:       p._count.labels,
      computedStatus:   getProductStatus(p.originalExpiryDate),
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
      daysUntilExpiry: daysUntil(product.originalExpiryDate),
      computedStatus:  getProductStatus(product.originalExpiryDate),
      labelCount:      product._count.labels,
    };
  },

  async create(data: {
    name: string;
    brand: string;
    category?: string;
    originalExpiryDate: string;
    daysValidRefrigerated: number;
    daysValidFrozen: number;
    unit?: string;
    notes?: string;
  }) {
    return prisma.product.create({
      data: {
        ...data,
        originalExpiryDate: new Date(data.originalExpiryDate + 'T00:00:00Z'),
      },
    });
  },

  async update(id: string, data: Partial<{
    name: string;
    brand: string;
    category: string;
    originalExpiryDate: string;
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
    return prisma.product.update({
      where: { id },
      data: {
        ...data,
        ...(data.originalExpiryDate && {
          originalExpiryDate: parseDateOnly(data.originalExpiryDate),
        }),
      },
    });
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
