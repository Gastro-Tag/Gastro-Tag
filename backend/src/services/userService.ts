import { UserRole } from '@prisma/client';
import { prisma } from '../prisma/client';
import { Errors } from '../utils/errors';
import { AuthService } from './authService';
import { SessionService } from './sessionService';
import { OperatorService } from './operatorService';

const publicFields = {
  id: true, name: true, email: true, role: true, active: true, createdAt: true, pinHash: true,
} as const;

/** O hash do PIN nunca sai da API: a resposta diz só se o usuário tem PIN. */
function toPublic<T extends { pinHash: string | null }>({ pinHash, ...user }: T) {
  return { ...user, hasPin: pinHash !== null };
}

async function ensureEmailAvailable(email: string, exceptId?: string): Promise<void> {
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing && existing.id !== exceptId) throw Errors.conflict('Já existe um usuário com este e-mail.');
}

export const UserService = {
  async list() {
    const users = await prisma.user.findMany({ select: publicFields, orderBy: { name: 'asc' } });
    return users.map(toPublic);
  },

  async create(data: { name: string; email: string; password: string; role: UserRole }) {
    await ensureEmailAvailable(data.email);
    return toPublic(await prisma.user.create({
      data: {
        name: data.name,
        email: data.email,
        role: data.role,
        passwordHash: await AuthService.hashPassword(data.password),
      },
      select: publicFields,
    }));
  },

  async update(
    id: string,
    actorId: string,
    data: Partial<{ name: string; email: string; role: UserRole; active: boolean }>,
  ) {
    // Quem edita é um ADMIN ativo: travar a própria conta garante que sempre reste um administrador.
    if (id === actorId && (data.active === false || data.role === 'OPERATOR')) {
      throw Errors.validation('Você não pode desativar nem rebaixar a própria conta.');
    }
    const user = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true } });
    if (!user) throw Errors.notFound('Usuário');
    if (data.email) await ensureEmailAvailable(data.email, id);
    const updated = await prisma.user.update({ where: { id }, data, select: publicFields });
    // Desativar ou trocar o perfil derruba as sessões abertas: quem volta entra com o acesso novo.
    if (data.active === false || (data.role && data.role !== user.role)) await SessionService.revokeAll(id);
    return toPublic(updated);
  },

  /** Define (4 a 6 dígitos) ou remove (null) o PIN do operador no totem. */
  async setPin(id: string, pin: string | null) {
    await OperatorService.setPin(id, pin);
    return toPublic(await prisma.user.findUniqueOrThrow({ where: { id }, select: publicFields }));
  },

  async resetPassword(id: string, password: string) {
    const user = await prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!user) throw Errors.notFound('Usuário');
    await prisma.user.update({
      where: { id },
      data: { passwordHash: await AuthService.hashPassword(password) },
    });
    await SessionService.revokeAll(id);
  },
};
