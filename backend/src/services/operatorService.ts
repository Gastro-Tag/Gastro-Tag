import { createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../prisma/client';
import { AppError, Errors } from '../utils/errors';
import { handlerInvalid, signHandlerToken, verifyHandlerToken } from '../utils/jwt';

export interface Handler { id: string; name: string }

// Mesma mensagem para PIN errado, usuário sem PIN e usuário desativado: não revela quem tem PIN.
const invalidPin = () => new AppError('PIN incorreto.', 401, 'INVALID_PIN');

// Hash fixo para comparar quando o usuário não tem PIN: a resposta leva o mesmo tempo.
const DUMMY_PIN_HASH = bcrypt.hashSync('000000', 12);

/** Impressão curta do hash do PIN: muda a cada PIN novo, sem expor o hash no token. */
const pinVersion = (pinHash: string) => createHash('sha256').update(pinHash).digest('hex').slice(0, 16);

export const OperatorService = {
  async setPin(userId: string, pin: string | null) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw Errors.notFound('Usuário');
    await prisma.user.update({
      where: { id: userId },
      data: { pinHash: pin === null ? null : await bcrypt.hash(pin, 12) },
    });
  },

  /** Usuários ativos com PIN: a lista do turno no totem. */
  async listWithPin() {
    return prisma.user.findMany({
      where: { active: true, pinHash: { not: null } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  },

  /** Confere o PIN e emite o token do turno, preso à sessão do aparelho que conferiu. */
  async verify(userId: string, pin: string, sid: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId }, select: { id: true, name: true, active: true, pinHash: true },
    });
    const usable = Boolean(user?.active && user.pinHash);
    const matches = await bcrypt.compare(pin, usable ? user!.pinHash! : DUMMY_PIN_HASH);
    if (!usable || !matches) throw invalidPin();

    const { token, expiresAt } = signHandlerToken({ hid: user!.id, sid, pv: pinVersion(user!.pinHash!) });
    return { operator: { id: user!.id, name: user!.name }, handlerToken: token, expiresAt };
  },

  /**
   * Operador do turno a partir do token. Vale só na mesma sessão, com o usuário ativo e o mesmo PIN.
   * Sem token, devolve null (fluxo com nome digitado).
   */
  async resolve(handlerToken: string | undefined, sid: string): Promise<Handler | null> {
    if (handlerToken === undefined) return null;
    const payload = verifyHandlerToken(handlerToken);
    if (payload.sid !== sid) throw handlerInvalid();
    const user = await prisma.user.findUnique({
      where: { id: payload.hid }, select: { id: true, name: true, active: true, pinHash: true },
    });
    if (!user?.active || !user.pinHash || pinVersion(user.pinHash) !== payload.pv) throw handlerInvalid();
    return { id: user.id, name: user.name };
  },
};
