import { PrismaClient, UserRole } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

function daysFromToday(days: number): Date {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

async function seedAdmin(): Promise<void> {
  const email = process.env.ADMIN_EMAIL?.trim();
  const password = process.env.ADMIN_PASSWORD;
  if (!email && !password) {
    console.info('Seed sem ADMIN_EMAIL/ADMIN_PASSWORD; admin não foi criado.');
    return;
  }
  if (!email || !password || password.length < 12) {
    throw new Error('Defina ADMIN_EMAIL e ADMIN_PASSWORD com pelo menos 12 caracteres.');
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return;

  await prisma.user.create({
    data: {
      name: 'Administrador',
      email,
      passwordHash: await bcrypt.hash(password, 12),
      role: UserRole.ADMIN,
    },
  });
  console.info(`Admin de seed criado: ${email}`);
}

async function seedProducts(): Promise<void> {
  const products = [
    { name: 'Leite Integral', brand: 'Nestlé', category: 'Laticínios', daysValidRefrigerated: 3, daysValidFrozen: 0, unit: 'L', originalExpiryDate: daysFromToday(45) },
    { name: 'Frango Inteiro', brand: 'Sadia', category: 'Proteínas', daysValidRefrigerated: 2, daysValidFrozen: 90, unit: 'kg', originalExpiryDate: daysFromToday(60) },
    { name: 'Molho de Tomate', brand: 'Heinz', category: 'Condimentos', daysValidRefrigerated: 7, daysValidFrozen: 60, unit: 'L', originalExpiryDate: daysFromToday(120) },
    { name: 'Creme de Leite', brand: 'Piracanjuba', category: 'Laticínios', daysValidRefrigerated: 5, daysValidFrozen: 30, unit: 'L', originalExpiryDate: daysFromToday(90) },
    { name: 'Manteiga sem Sal', brand: 'Aviação', category: 'Laticínios', daysValidRefrigerated: 30, daysValidFrozen: 120, unit: 'kg', originalExpiryDate: daysFromToday(180) },
  ];

  let created = 0;
  for (const product of products) {
    const existing = await prisma.product.findFirst({
      where: { name: product.name, brand: product.brand },
      select: { id: true },
    });
    if (existing) continue;
    await prisma.product.create({ data: product });
    created++;
  }
  console.info(`${created} produto(s) de exemplo criado(s); registros existentes preservados.`);
}

async function main(): Promise<void> {
  await seedAdmin();
  await seedProducts();
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());