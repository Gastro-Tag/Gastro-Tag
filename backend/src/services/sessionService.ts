import { createHash, randomUUID } from 'node:crypto';
import { prisma } from '../prisma/client';
import { Errors } from '../utils/errors';
import { REFRESH_TTL_MS, signAccessToken, signRefreshToken, verifyRefreshToken } from '../utils/jwt';

// Duas abas do mesmo navegador podem renovar ao mesmo tempo com o token anterior.
const ROTATION_GRACE_MS = 30_000;
const KEEP_REVOKED_MS = 7 * 24 * 60 * 60 * 1000;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

function issueTokens(user: { id: string; name: string; role: string }, sid: string) {
  const payload = { sub: user.id, name: user.name, role: user.role, sid };
  const refreshToken = signRefreshToken(payload);
  return { accessToken: signAccessToken(payload), refreshToken, refreshHash: hashToken(refreshToken) };
}

export const SessionService = {
  async start(user: { id: string; name: string; role: string }) {
    const now = Date.now();
    // Limpeza oportunista: sessões vencidas ou encerradas há dias não servem para nada.
    await prisma.userSession.deleteMany({
      where: {
        userId: user.id,
        OR: [{ expiresAt: { lt: new Date(now) } }, { revokedAt: { lt: new Date(now - KEEP_REVOKED_MS) } }],
      },
    });
    const sid = randomUUID();
    const { accessToken, refreshToken, refreshHash } = issueTokens(user, sid);
    await prisma.userSession.create({
      data: { id: sid, userId: user.id, tokenHash: refreshHash, expiresAt: new Date(now + REFRESH_TTL_MS) },
    });
    return { accessToken, refreshToken };
  },

  async rotate(refreshToken: string) {
    const payload = verifyRefreshToken(refreshToken);
    const presented = hashToken(refreshToken);

    // Duas tentativas: se outra requisição renovou no meio, o token vira o anterior e cai na tolerância.
    for (let attempt = 0; attempt < 2; attempt++) {
      const session = await prisma.userSession.findUnique({
        where: { id: payload.sid },
        include: { user: { select: { id: true, name: true, role: true, active: true } } },
      });
      const now = Date.now();
      if (!session || session.userId !== payload.sub || session.revokedAt
        || session.expiresAt.getTime() <= now || !session.user.active) {
        throw Errors.unauthorized();
      }

      const isCurrent = presented === session.tokenHash;
      const isRecentPrevious = presented === session.previousHash
        && session.rotatedAt !== null && now - session.rotatedAt.getTime() < ROTATION_GRACE_MS;
      if (!isCurrent && !isRecentPrevious) {
        // Token antigo reapresentado: pode ter sido copiado. Encerra a sessão inteira.
        await SessionService.revoke(session.id);
        throw Errors.unauthorized();
      }

      const tokens = issueTokens(session.user, session.id);
      const { count } = await prisma.userSession.updateMany({
        where: { id: session.id, tokenHash: session.tokenHash, revokedAt: null },
        data: {
          previousHash: session.tokenHash,
          tokenHash: tokens.refreshHash,
          rotatedAt: new Date(now),
          expiresAt: new Date(now + REFRESH_TTL_MS),
        },
      });
      if (count === 1) return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
    }
    throw Errors.unauthorized();
  },

  async revoke(sid: string) {
    await prisma.userSession.updateMany({ where: { id: sid, revokedAt: null }, data: { revokedAt: new Date() } });
  },

  /** Encerra todas as sessões do usuário, exceto a do aparelho que pediu a mudança. */
  async revokeAll(userId: string, exceptSid?: string) {
    await prisma.userSession.updateMany({
      where: { userId, revokedAt: null, ...(exceptSid ? { id: { not: exceptSid } } : {}) },
      data: { revokedAt: new Date() },
    });
  },
};
