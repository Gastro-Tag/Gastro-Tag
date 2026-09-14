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

  async me(req: Request, res: Response) {
    res.json({ success: true, data: req.user });
  },
};
