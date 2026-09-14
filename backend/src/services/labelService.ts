import { StorageType } from '@prisma/client';
import { prisma } from '../prisma/client';
import { Errors } from '../utils/errors';
import { calcDiscardDate, generateShortCode, parseDateUTC } from '../utils/dateUtils';

export const LabelService = {
  async create(data: {
    productId:    string;
    userId:       string;
    lot:          string;
    openedAt:     string;
    storageType:  'REFRIGERADO' | 'CONGELADO';
    storageTemp:  string;
  }) {
    // Load product to compute discard date
    const product = await prisma.product.findUnique({
      where: { id: data.productId, active: true },
    });
    if (!product) throw Errors.notFound('Produto');

    const days =
      data.storageType === 'REFRIGERADO'
        ? product.daysValidRefrigerated
        : product.daysValidFrozen;

    if (days === 0) {
      throw new Error(
        `Produto não possui validade configurada para ${data.storageType.toLowerCase()}.`,
      );
    }

    const openedAt  = parseDateUTC(data.openedAt);
    const discardAt = calcDiscardDate(openedAt, days);

    // Ensure unique short code
    let shortCode: string;
    let attempts = 0;
    do {
      shortCode = generateShortCode();
      attempts++;
      if (attempts > 10) throw new Error('Falha ao gerar código único.');
    } while (await prisma.label.findUnique({ where: { shortCode } }));

    return prisma.label.create({
      data: {
        shortCode,
        productId:   data.productId,
        userId:      data.userId,
        lot:         data.lot,
        openedAt,
        discardAt,
        storageType: data.storageType as StorageType,
        storageTemp: data.storageTemp,
      },
      include: {
        product: true,
        user:    { select: { name: true } },
      },
    });
  },

  async list(filters: {
    productId?: string;
    userId?:    string;
    page?:      number;
    limit?:     number;
  }) {
    const { productId, userId, page = 1, limit = 20 } = filters;
    const skip = (page - 1) * limit;

    const where = {
      ...(productId && { productId }),
      ...(userId    && { userId }),
    };

    const [total, items] = await Promise.all([
      prisma.label.count({ where }),
      prisma.label.findMany({
        where,
        skip,
        take:    limit,
        orderBy: { createdAt: 'desc' },
        include: {
          product: { select: { name: true, brand: true } },
          user:    { select: { name: true } },
        },
      }),
    ]);

    return {
      data: items,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  },

  async getById(id: string) {
    const label = await prisma.label.findUnique({
      where:   { id },
      include: {
        product: true,
        user:    { select: { name: true, email: true } },
      },
    });
    if (!label) throw Errors.notFound('Etiqueta');
    return label;
  },

  async registerPrint(id: string) {
    return prisma.label.update({
      where: { id },
      data: {
        printedAt:  new Date(),
        printCount: { increment: 1 },
      },
    });
  },
};
