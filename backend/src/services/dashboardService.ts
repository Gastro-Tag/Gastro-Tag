import { prisma } from '../prisma/client';

export const DashboardService = {
  async getStats() {
    const now = new Date();
    now.setUTCHours(0, 0, 0, 0);

    const in7Days = new Date(now);
    in7Days.setUTCDate(in7Days.getUTCDate() + 7);

    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 7);

    const [
      totalProducts,
      expiredProducts,
      expiringProducts,
      validProducts,
      recentProducts,
      totalLabels,
      labelsToday,
      labelsThisWeek,
      labelsByStorage,
      topProducts,
    ] = await Promise.all([
      prisma.product.count({ where: { active: true } }),

      prisma.product.count({
        where: { active: true, originalExpiryDate: { lt: now } },
      }),

      prisma.product.count({
        where: { active: true, originalExpiryDate: { gte: now, lt: in7Days } },
      }),

      prisma.product.count({
        where: { active: true, originalExpiryDate: { gte: in7Days } },
      }),

      prisma.product.count({
        where: { active: true, createdAt: { gte: sevenDaysAgo } },
      }),

      prisma.label.count(),

      prisma.label.count({
        where: { createdAt: { gte: now } },
      }),

      prisma.label.count({
        where: { createdAt: { gte: sevenDaysAgo } },
      }),

      prisma.label.groupBy({
        by: ['storageType'],
        _count: { storageType: true },
      }),

      prisma.product.findMany({
        where:   { active: true },
        orderBy: { labels: { _count: 'desc' } },
        take:    5,
        select:  { id: true, name: true, brand: true, _count: { select: { labels: true } } },
      }),
    ]);

    return {
      products: {
        total:    totalProducts,
        expired:  expiredProducts,
        expiring: expiringProducts,
        valid:    validProducts,
        recent:   recentProducts,
      },
      labels: {
        total:       totalLabels,
        today:       labelsToday,
        thisWeek:    labelsThisWeek,
        byStorage:   Object.fromEntries(
          labelsByStorage.map((r) => [r.storageType, r._count.storageType]),
        ),
      },
      topProducts: topProducts.map((p) => ({
        id:         p.id,
        name:       p.name,
        brand:      p.brand,
        labelCount: p._count.labels,
      })),
    };
  },
};
