import bcrypt from 'bcryptjs';
import { prisma } from '../prisma/client';
import { AppError, Errors } from '../utils/errors';
import { verifyRefreshToken } from '../utils/jwt';
import { SessionService } from './sessionService';

export const AuthService = {
  async login(email: string, password: string) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.active) throw Errors.unauthorized();

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw Errors.unauthorized();

    const tokens = await SessionService.start(user);
    return {
      ...tokens,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    };
  },

  async refresh(refreshToken: string) {
    return SessionService.rotate(refreshToken);
  },

  async logout(refreshToken: string): Promise<void> {
    await SessionService.revoke(verifyRefreshToken(refreshToken).sid);
  },

  async changePassword(userId: string, sid: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw Errors.unauthorized();
    // 422, e não 401: o frontend trataria 401 como sessão expirada e tentaria renovar.
    if (!await bcrypt.compare(currentPassword, user.passwordHash)) throw Errors.validation('Senha atual incorreta.');
    if (currentPassword === newPassword) throw Errors.validation('A nova senha precisa ser diferente da atual.');

    await prisma.user.update({ where: { id: userId }, data: { passwordHash: await AuthService.hashPassword(newPassword) } });
    await SessionService.revokeAll(userId, sid);
  },

  async verifyAdmin(email: string, password: string): Promise<void> {
    const user = await prisma.user.findUnique({ where: { email } });
    const valid = user?.active && user.role === 'ADMIN' && await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new AppError('Credenciais de administrador inválidas.', 403, 'FORBIDDEN');
  },

  async hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(plain, 12);
  },
};
