import { Request, Response } from 'express';
import { z } from 'zod';
import { AuthService } from '../services/authService';

const loginSchema = z.object({
  email:    z.string().email('E-mail inválido.'),
  password: z.string().min(6, 'Senha deve ter ao menos 6 caracteres.'),
});

const refreshSchema = z.object({
  refreshToken: z.string(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Informe a senha atual.').max(72),
  newPassword: z.string()
    .min(12, 'Senha deve ter ao menos 12 caracteres.')
    .max(72, 'Senha deve ter no máximo 72 caracteres.'),
});

export const AuthController = {
  async login(req: Request, res: Response) {
    const { email, password } = loginSchema.parse(req.body);
    const result = await AuthService.login(email, password);
    res.json({ success: true, data: result });
  },

  async refresh(req: Request, res: Response) {
    const { refreshToken } = refreshSchema.parse(req.body);
    const result = await AuthService.refresh(refreshToken);
    res.json({ success: true, data: result });
  },

  // Usa o refresh token: funciona mesmo depois que o token de acesso venceu.
  async logout(req: Request, res: Response) {
    const { refreshToken } = refreshSchema.parse(req.body);
    await AuthService.logout(refreshToken);
    res.json({ success: true, data: null });
  },

  async changePassword(req: Request, res: Response) {
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
    await AuthService.changePassword(req.user!.sub, req.user!.sid, currentPassword, newPassword);
    res.json({ success: true, data: null });
  },

  async verifyAdmin(req: Request, res: Response) {
    const { email, password } = loginSchema.parse(req.body);
    await AuthService.verifyAdmin(email, password);
    res.json({ success: true, data: { valid: true } });
  },

  async me(req: Request, res: Response) {
    res.json({ success: true, data: req.user });
  },
};
