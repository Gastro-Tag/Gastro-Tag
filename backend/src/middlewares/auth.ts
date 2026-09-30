import { Request, Response, NextFunction } from 'express';
import { prisma } from '../prisma/client';
import { verifyAccessToken, TokenPayload } from '../utils/jwt';
import { Errors } from '../utils/errors';

declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) throw Errors.unauthorized();

  const payload = verifyAccessToken(auth.slice(7));
  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, name: true, role: true, active: true },
  });
  if (!user?.active) throw Errors.unauthorized();

  req.user = { sub: user.id, name: user.name, role: user.role, type: 'access' };
  next();
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) throw Errors.unauthorized();
  if (req.user.role !== 'ADMIN') throw Errors.forbidden();
  next();
}