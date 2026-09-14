import { PrismaClient, UserRole } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Iniciando seed...');

  // Admin padrão
  const adminHash = await bcrypt.hash('admin123', 10);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@gastrotag.com' },
    update: {},
    create: {
      name: 'Administrador',
      email: 'admin@gastrotag.com',
      passwordHash: adminHash,
      role: UserRole.ADMIN,
    },
  });
  console.log('✅ Usuário admin criado:', admin.email);

  // Produtos de exemplo
  const products = [
    { name: 'Leite Integral', brand: 'Nestlé', category: 'Laticínios', daysValidRefrigerated: 3, daysValidFrozen: 0, unit: 'L', originalExpiryDate: new Date('2025-12-31') },
    { name: 'Frango Inteiro', brand: 'Sadia', category: 'Proteínas', daysValidRefrigerated: 2, daysValidFrozen: 90, unit: 'kg', originalExpiryDate: new Date('2025-08-15') },
    { name: 'Molho de Tomate', brand: 'Heinz', category: 'Condimentos', daysValidRefrigerated: 7, daysValidFrozen: 60, unit: 'L', originalExpiryDate: new Date('2026-06-01') },
    { name: 'Creme de Leite', brand: 'Piracanjuba', category: 'Laticínios', daysValidRefrigerated: 5, daysValidFrozen: 30, unit: 'L', originalExpiryDate: new Date('2025-11-20') },
    { name: 'Manteiga sem Sal', brand: 'Aviação', category: 'Laticínios', daysValidRefrigerated: 30, daysValidFrozen: 120, unit: 'kg', originalExpiryDate: new Date('2026-03-10') },
  ];

  for (const p of products) {
    await prisma.product.upsert({
      where: { id: p.name + p.brand },  // just for idempotency
      update: {},
      create: p,
    }).catch(() => prisma.product.create({ data: p }));
  }
  console.log(`✅ ${products.length} produtos criados`);

  console.log('🎉 Seed concluído!');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
