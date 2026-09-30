import 'dotenv/config';
import bcrypt from 'bcryptjs';
import app from './app';
import { prisma } from './prisma/client';
import { logger } from './utils/logger';

const PORT = Number(process.env.PORT) || 3333;

async function ensureAdminExists(): Promise<void> {
  const adminEmail = process.env.ADMIN_EMAIL?.trim();
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminEmail || !adminPassword) {
    logger.warn('Admin inicial não criado. Defina ADMIN_EMAIL e ADMIN_PASSWORD para habilitá-lo.');
    return;
  }
  if (adminPassword.length < 12) {
    throw new Error('ADMIN_PASSWORD precisa ter pelo menos 12 caracteres.');
  }

  const passwordHash = await bcrypt.hash(adminPassword, 12);
  const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (existingAdmin) {
    await prisma.user.update({
      where: { id: existingAdmin.id },
      data: { passwordHash, role: 'ADMIN', active: true },
    });
    logger.info('Credencial do administrador sincronizada com as variáveis de ambiente.');
    return;
  }
  await prisma.user.create({
    data: { name: 'Administrador', email: adminEmail, passwordHash, role: 'ADMIN' },
  });
  logger.info('Usuário administrador inicial criado.');
}

async function bootstrap(): Promise<void> {
  try {
    await prisma.$connect();
    logger.info('PostgreSQL conectado');
    await ensureAdminExists();

    app.listen(PORT, () => {
      logger.info(`API rodando na porta ${PORT}`);
    });
  } catch (err) {
    logger.error('Erro ao inicializar servidor', err);
    await prisma.$disconnect();
    process.exit(1);
  }
}

process.on('SIGINT', async () => { await prisma.$disconnect(); process.exit(0); });
process.on('SIGTERM', async () => { await prisma.$disconnect(); process.exit(0); });

bootstrap();