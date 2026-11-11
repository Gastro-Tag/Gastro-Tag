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
  // Sessão encerrada (saída, troca de senha, conta desativada) derruba o token na hora.
  const session = await prisma.userSession.findUnique({
    where: { id: payload.sid },
    select: {
      revokedAt: true, expiresAt: true,
      user: { select: { id: true, name: true, role: true, active: true } },
    },
  });
  if (!session || session.revokedAt || session.expiresAt <= new Date()
    || session.user.id !== payload.sub || !session.user.active) {
    throw Errors.unauthorized();
  }

  const { user } = session;
  req.user = { sub: user.id, name: user.name, role: user.role, sid: payload.sid, type: 'access' };
  next();
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) throw Errors.unauthorized();
  if (req.user.role !== 'ADMIN') throw Errors.forbidden();
  next();
}
