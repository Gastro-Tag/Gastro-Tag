import { Prisma } from '@prisma/client';
import { prisma } from '../prisma/client';
import { Errors } from '../utils/errors';
import { daysUntil } from '../utils/dateUtils';

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
    const now  = new Date();
    now.setUTCHours(0, 0, 0, 0);

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
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 7);

    if (status === 'valid')    where.originalExpiryDate = { gte: sevenDaysFromNow };
    if (status === 'expiring') where.originalExpiryDate = { gte: now, lt: sevenDaysFromNow };
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
      computedStatus:   computeStatus(p.originalExpiryDate),
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
      computedStatus:  computeStatus(product.originalExpiryDate),
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
    await ProductService.getById(id);
    return prisma.product.update({
      where: { id },
      data: {
        ...data,
        ...(data.originalExpiryDate && {
          originalExpiryDate: new Date(data.originalExpiryDate + 'T00:00:00Z'),
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

function computeStatus(expiryDate: Date): 'valid' | 'expiring' | 'expired' {
  const days = daysUntil(expiryDate);
  if (days < 0)  return 'expired';
  if (days <= 7) return 'expiring';
  return 'valid';
}
