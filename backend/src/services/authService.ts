import bcrypt from 'bcryptjs';
import { prisma } from '../prisma/client';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../utils/jwt';
import { AppError, Errors } from '../utils/errors';

export const AuthService = {
  async login(email: string, password: string) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.active) throw Errors.unauthorized();

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw Errors.unauthorized();

    const payload = { sub: user.id, name: user.name, role: user.role };
    return {
      accessToken:  signAccessToken(payload),
      refreshToken: signRefreshToken(payload),
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    };
  },

  async refresh(refreshToken: string) {
    const payload = verifyRefreshToken(refreshToken);

    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.active) throw Errors.unauthorized();

    const newPayload = { sub: user.id, name: user.name, role: user.role };
    return {
      accessToken:  signAccessToken(newPayload),
      refreshToken: signRefreshToken(newPayload),
    };
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
