import 'express-async-errors';
import express from 'express';
import helmet  from 'helmet';
import cors    from 'cors';
import morgan  from 'morgan';
import path    from 'path';

import router         from './routes';
import { errorHandler } from './middlewares/errorHandler';
import { logger }       from './utils/logger';

const app = express();

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

// ── Static uploads ────────────────────────────────────────
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// ── API routes ────────────────────────────────────────────
app.use('/api', router);

// ── Health check ──────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date() }));

// ── 404 ───────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ success: false, error: { message: 'Rota não encontrada.', code: 'NOT_FOUND' } }));

// ── Error handler (must be last) ─────────────────────────
app.use(errorHandler);

export default app;
