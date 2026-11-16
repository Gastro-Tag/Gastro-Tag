import { NextFunction, Request, Response } from 'express';
import { logger } from '../utils/logger';

/**
 * Log de acesso em stdout (JSON em produção): método, rota sem query string, status, tempo e IP.
 * Nunca registra corpo, query nem cabeçalhos: tokens e senhas não passam por aqui.
 * O /health bem-sucedido fica de fora para o healthcheck do Docker não encher o log.
 */
export function accessLog(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const path = req.originalUrl.split('?')[0];
    if (path === '/health' && res.statusCode < 400) return;
    const durationMs = Math.round(Number(process.hrtime.bigint() - start) / 1e5) / 10;
    logger.info(`${req.method} ${path} ${res.statusCode} ${durationMs}ms`, {
      type: 'access',
      method: req.method,
      path,
      status: res.statusCode,
      durationMs,
      ip: req.ip,
    });
  });
  next();
}
