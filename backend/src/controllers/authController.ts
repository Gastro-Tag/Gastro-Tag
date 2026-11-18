import { Request, Response } from 'express';
import { z } from 'zod';
import { AuthService } from '../services/authService';
import { SettingsService } from '../services/settingsService';
import { kitchenToday, MAX_BACKDATE_DAYS } from '../utils/dateUtils';

const loginSchema = z.object({
  // E-mail sem diferenciar maiúsculas: a conta é guardada em minúsculas.
  email:    z.string().trim().toLowerCase().email('E-mail inválido.'),
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
    // Data da cozinha e limite para trás: o formulário limita a data de abertura (o servidor confere de novo).
    // requireValidatedRule: a tela avisa antes; quem recusa a etiqueta sem regra é o servidor.
    const { requireValidatedRule } = await SettingsService.get();
    res.json({
      success: true,
      data: req.user,
      meta: {
        kitchenToday: kitchenToday().toISOString().slice(0, 10), maxBackdateDays: MAX_BACKDATE_DAYS, requireValidatedRule,
      },
    });
  },
};
