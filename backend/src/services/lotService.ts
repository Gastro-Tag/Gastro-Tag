import { prisma } from '../prisma/client';
import { Errors } from '../utils/errors';
import { kitchenToday } from '../utils/dateUtils';
import { parseDateOnly } from '../domain/shelfLife';

async function assertCodeAvailable(productId: string, code: string, ignoreLotId?: string) {
  const duplicate = await prisma.productLot.findFirst({
    where: { productId, code, active: true, ...(ignoreLotId && { id: { not: ignoreLotId } }) },
    select: { id: true },
  });
  if (duplicate) throw Errors.conflict('Já existe um lote ativo com este código neste produto.');
}

async function findActiveLot(productId: string, lotId: string) {
  const lot = await prisma.productLot.findFirst({
    where: { id: lotId, productId, active: true, product: { active: true } },
  });
  if (!lot) throw Errors.notFound('Lote');
  return lot;
}

export const LotService = {
  async create(productId: string, data: { code: string; expiryDate: string }) {
    const product = await prisma.product.findUnique({ where: { id: productId, active: true } });
    if (!product) throw Errors.notFound('Produto');

    const expiryDate = parseDateOnly(data.expiryDate, 'Validade');
    if (expiryDate.getTime() < kitchenToday().getTime()) {
      throw Errors.validation('Este lote já está vencido. Não cadastre: descarte o produto.');
    }
    await assertCodeAvailable(productId, data.code);
    return prisma.productLot.create({ data: { productId, code: data.code, expiryDate } });
  },

  async update(productId: string, lotId: string, data: { code?: string; expiryDate?: string }) {
    await findActiveLot(productId, lotId);
    if (data.code) await assertCodeAvailable(productId, data.code, lotId);
    return prisma.productLot.update({
      where: { id: lotId },
      data: {
        ...(data.code && { code: data.code }),
        ...(data.expiryDate && { expiryDate: parseDateOnly(data.expiryDate, 'Validade') }),
      },
    });
  },

  /** Encerra o lote sem apagar: as etiquetas continuam apontando para ele. */
  async remove(productId: string, lotId: string) {
    await findActiveLot(productId, lotId);
    return prisma.productLot.update({ where: { id: lotId }, data: { active: false } });
  },

  findActiveLot,
};
