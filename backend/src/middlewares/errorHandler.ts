import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: {
        message: err.message,
        code: err.code ?? 'APP_ERROR',
      },
    });
    return;
  }

  // Prisma unique constraint
  if ((err as any).code === 'P2002') {
    res.status(409).json({
      success: false,
      error: { message: 'Registro duplicado.', code: 'CONFLICT' },
    });
    return;
  }

  // Prisma not found
  if ((err as any).code === 'P2025') {
    res.status(404).json({
      success: false,
      error: { message: 'Registro não encontrado.', code: 'NOT_FOUND' },
    });
    return;
  }

  logger.error('Unhandled error', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  res.status(500).json({
    success: false,
    error: {
      message: 'Erro interno do servidor.',
      code: 'INTERNAL_ERROR',
    },
  });
}
