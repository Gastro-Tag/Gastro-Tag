import bcrypt from 'bcryptjs';
import { prisma } from '../prisma/client';
import { logger } from '../utils/logger';
import { AuthService } from './authService';
import { SessionService } from './sessionService';

type BootEnv = Partial<Record<'ADMIN_EMAIL' | 'ADMIN_PASSWORD' | 'ADMIN_SYNC_ON_BOOT', string>>;

export type AdminBootResult = 'skipped' | 'created' | 'kept' | 'synced' | 'in_sync';

/**
 * Admin inicial a partir de ADMIN_EMAIL / ADMIN_PASSWORD.
 * Sem ADMIN_SYNC_ON_BOOT=true, só cria a conta quando ela não existe: nunca troca a senha,
 * o perfil nem reativa uma conta desativada pelo painel.
 */
export const AdminBootstrapService = {
  async ensure(env: BootEnv = process.env): Promise<AdminBootResult> {
    const email = env.ADMIN_EMAIL?.trim().toLowerCase();
    const password = env.ADMIN_PASSWORD;

    if (!email || !password) {
      logger.warn('Admin inicial não criado. Defina ADMIN_EMAIL e ADMIN_PASSWORD para habilitá-lo.');
      return 'skipped';
    }
    // A senha só é exigida quando vai ser usada (criar ou sincronizar): conta mantida não derruba o boot.
    const shortPassword = password.length < 12;
    const shortPasswordMessage = 'ADMIN_PASSWORD precisa ter pelo menos 12 caracteres.';

    const existing = await prisma.user.findUnique({ where: { email } });
    if (!existing) {
      if (shortPassword) throw new Error(shortPasswordMessage);
      await prisma.user.create({
        data: { name: 'Administrador', email, passwordHash: await AuthService.hashPassword(password), role: 'ADMIN' },
      });
      logger.info('Usuário administrador inicial criado.');
      return 'created';
    }

    if (env.ADMIN_SYNC_ON_BOOT !== 'true') {
      if (shortPassword) logger.warn(`${shortPasswordMessage} A conta já existe e não foi alterada.`);
      if (!existing.active || existing.role !== 'ADMIN') {
        logger.warn('A conta de ADMIN_EMAIL está desativada ou não é ADMIN; nada foi alterado. Use ADMIN_SYNC_ON_BOOT=true para restaurá-la.');
      } else {
        logger.info('Administrador já existe; senha e perfil não foram alterados.');
      }
      return 'kept';
    }

    if (shortPassword) throw new Error(shortPasswordMessage);
    const samePassword = await bcrypt.compare(password, existing.passwordHash);
    if (samePassword && existing.role === 'ADMIN' && existing.active) {
      logger.info('Administrador já está sincronizado com as variáveis de ambiente.');
      return 'in_sync';
    }
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        ...(samePassword ? {} : { passwordHash: await AuthService.hashPassword(password) }),
        role: 'ADMIN',
        active: true,
      },
    });
    // Senha ou perfil mudou: as sessões abertas caem, como numa troca de senha pelo painel.
    if (!samePassword || existing.role !== 'ADMIN') await SessionService.revokeAll(existing.id);
    logger.warn('Credencial do administrador sincronizada com as variáveis de ambiente (ADMIN_SYNC_ON_BOOT=true).');
    return 'synced';
  },
};
