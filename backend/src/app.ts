import 'express-async-errors';
import express from 'express';
import helmet  from 'helmet';
import cors    from 'cors';
import morgan  from 'morgan';

import router         from './routes';
import { errorHandler } from './middlewares/errorHandler';
import { logger }       from './utils/logger';
import { prisma }       from './prisma/client';

const app = express();

// Quantos proxies confiáveis existem à frente da API. Sem isso, o limite de
// tentativas vê todos os aparelhos como um só; valor maior permite forjar o IP.
const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 0);
if (!Number.isInteger(trustProxyHops) || trustProxyHops < 0) {
  throw new Error('TRUST_PROXY_HOPS deve ser um número inteiro maior ou igual a 0.');
}
app.set('trust proxy', trustProxyHops);

// ── Security & parsing ────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin:      process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Logging ───────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev', {
    stream: { write: (msg) => logger.http(msg.trim()) },
  }));
}

// ── API routes ────────────────────────────────────────────
app.use('/api', router);

// ── Health check ──────────────────────────────────────────
// Confere o banco; sem detalhes do erro na resposta (usado pelo healthcheck do Docker).
app.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', db: 'ok' });
  } catch (error) {
    logger.error('Health check: banco indisponível', { message: (error as Error).message });
    res.status(503).json({ status: 'error', db: 'error' });
  }
});

// ── 404 ───────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ success: false, error: { message: 'Rota não encontrada.', code: 'NOT_FOUND' } }));

// ── Error handler (must be last) ─────────────────────────
app.use(errorHandler);

export default app;
