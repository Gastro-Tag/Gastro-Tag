import 'dotenv/config';
import bcrypt from 'bcryptjs';
import app        from './app';
import { prisma }   from './prisma/client';
import { logger }   from './utils/logger';

const PORT = Number(process.env.PORT) || 3333;

async function ensureAdminExists() {
  const adminEmail = 'admin@gastrotag.com';
  
  try {
    const existingAdmin = await prisma.user.findUnique({
      where: { email: adminEmail },
    });

    if (!existingAdmin) {
      const passwordHash = await bcrypt.hash('admin123', 8);
      await prisma.user.create({
        data: {
          name: 'Administrador',
          email: adminEmail,
          passwordHash,
          role: 'ADMIN',
        },
      });
      logger.info('✅ Usuário administrador criado automaticamente na inicialização.');
    }
  } catch (err) {
    logger.error('❌ Erro ao verificar ou criar o usuário administrador automático:', err);
  }
}

async function bootstrap() {
  try {
    await prisma.$connect();
    logger.info('✅ PostgreSQL conectado');

    // Garante que o admin existe antes de abrir a API para requisições
    await ensureAdminExists();

    app.listen(PORT, () => {
      logger.info(`🚀 API rodando em http://localhost:${PORT}`);
    });
  } catch (err) {
    logger.error('Erro ao inicializar servidor', err);
    process.exit(1);
  }
}

process.on('SIGINT',  async () => { await prisma.$disconnect(); process.exit(0); });
process.on('SIGTERM', async () => { await prisma.$disconnect(); process.exit(0); });

bootstrap();