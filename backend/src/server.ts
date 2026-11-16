import 'dotenv/config';
import type { Server } from 'node:http';
import app from './app';
import { prisma } from './prisma/client';
import { logger } from './utils/logger';
import { AdminBootstrapService } from './services/adminBootstrapService';

const PORT = Number(process.env.PORT) || 3333;
// Tempo máximo para terminar as requisições em andamento antes de sair à força.
const SHUTDOWN_TIMEOUT_MS = 10_000;

let server: Server | undefined;
let shuttingDown = false;

async function bootstrap(): Promise<void> {
  try {
    await prisma.$connect();
    logger.info('PostgreSQL conectado');
    await AdminBootstrapService.ensure();

    server = app.listen(PORT, () => {
      logger.info(`API rodando na porta ${PORT}`);
    });
  } catch (err) {
    logger.error('Erro ao inicializar servidor', { message: (err as Error).message, stack: (err as Error).stack });
    await prisma.$disconnect();
    process.exit(1);
  }
}

/** SIGTERM/SIGINT: para de aceitar conexões, espera as requisições em andamento e fecha o banco. */
function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${signal} recebido; encerrando a API.`);

  const forceExit = setTimeout(() => {
    logger.error(`Encerramento passou de ${SHUTDOWN_TIMEOUT_MS / 1000} s; saindo à força.`);
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  const closeDatabase = async (code: number) => {
    try {
      await prisma.$disconnect();
    } catch (err) {
      logger.error('Erro ao fechar a conexão com o banco', { message: (err as Error).message });
      code = 1;
    }
    process.exit(code);
  };

  if (!server) {
    void closeDatabase(0);
    return;
  }
  server.close((err) => {
    if (err) logger.error('Erro ao fechar o servidor HTTP', { message: err.message });
    void closeDatabase(err ? 1 : 0);
  });
  // Conexões keep-alive ociosas não seguram o encerramento.
  server.closeIdleConnections();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

bootstrap();
