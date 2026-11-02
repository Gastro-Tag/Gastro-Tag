import { Request, Response } from 'express';
import { z } from 'zod';
import { UserService } from '../services/userService';

const passwordSchema = z.string()
  .min(12, 'Senha deve ter ao menos 12 caracteres.')
  .max(72, 'Senha deve ter no máximo 72 caracteres.');

const userFields = z.object({
  name:  z.string().trim().min(2, 'Nome deve ter ao menos 2 caracteres.').max(100),
  email: z.string().trim().email('E-mail inválido.').max(120),
  role:  z.enum(['ADMIN', 'OPERATOR']),
});

const createSchema = userFields.extend({ password: passwordSchema });
const updateSchema = userFields.extend({ active: z.boolean() }).partial();
const passwordBodySchema = z.object({ password: passwordSchema });

export const UserController = {
  async list(_req: Request, res: Response) {
    const users = await UserService.list();
    res.json({ success: true, data: users });
  },

  async create(req: Request, res: Response) {
    const data = createSchema.parse(req.body);
    const user = await UserService.create(data);
    res.status(201).json({ success: true, data: user });
  },

  async update(req: Request, res: Response) {
    const data = updateSchema.parse(req.body);
    const user = await UserService.update(req.params.id, req.user!.sub, data);
    res.json({ success: true, data: user });
  },

  async resetPassword(req: Request, res: Response) {
    const { password } = passwordBodySchema.parse(req.body);
    await UserService.resetPassword(req.params.id, password);
    res.json({ success: true, data: null });
  },
};
