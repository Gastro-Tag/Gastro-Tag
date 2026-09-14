import 'dotenv/config';
import app          from './app';
import { prisma }   from './prisma/client';
import { logger }   from './utils/logger';

const PORT = Number(process.env.PORT) || 3333;

async function bootstrap() {
  try {
    await prisma.$connect();
    logger.info('✅ PostgreSQL conectado');

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
