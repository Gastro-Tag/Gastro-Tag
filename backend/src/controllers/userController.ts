import { Request, Response } from 'express';
import { z } from 'zod';
import { isPseudonymized, UserService } from '../services/userService';

const passwordSchema = z.string()
  .min(12, 'Senha deve ter ao menos 12 caracteres.')
  .max(72, 'Senha deve ter no máximo 72 caracteres.');

const userFields = z.object({
  name:  z.string().trim().min(2, 'Nome deve ter ao menos 2 caracteres.').max(100),
  // Guardado em minúsculas: "Ana@x.com" e "ana@x.com" são a mesma conta.
  // O domínio de quem teve os dados removidos é reservado: um e-mail nele faria a conta parecer removida.
  email: z.string().trim().toLowerCase().email('E-mail inválido.').max(120)
    .refine((value) => !isPseudonymized(value), 'E-mail inválido.'),
  role:  z.enum(['ADMIN', 'OPERATOR']),
});

const createSchema = userFields.extend({ password: passwordSchema });
const updateSchema = userFields.extend({ active: z.boolean() }).partial();
const passwordBodySchema = z.object({ password: passwordSchema });
// null remove o PIN.
const pinBodySchema = z.object({
  pin: z.union([
    z.string({ error: 'O PIN deve ter de 4 a 6 dígitos.' }).regex(/^\d{4,6}$/, 'O PIN deve ter de 4 a 6 dígitos.'),
    z.null(),
  ], { error: 'O PIN deve ter de 4 a 6 dígitos.' }),
});

const pseudonymizeSchema = z.strictObject({
  confirmName: z.string({ error: 'Digite o nome do usuário para confirmar.' }).max(200),
});

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

  /** Arquivo cru (sem o envelope success) para o admin baixar e entregar ao titular. */
  async exportData(req: Request, res: Response) {
    const data = await UserService.exportData(req.params.id);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="titular-${data.user.id.slice(0, 8)}.json"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(JSON.stringify(data, null, 2));
  },

  async pseudonymize(req: Request, res: Response) {
    const { confirmName } = pseudonymizeSchema.parse(req.body);
    const user = await UserService.pseudonymize(req.params.id, req.user!.sub, confirmName);
    res.json({ success: true, data: user });
  },

  async setPin(req: Request, res: Response) {
    const { pin } = pinBodySchema.parse(req.body);
    const user = await UserService.setPin(req.params.id, pin);
    res.json({ success: true, data: user });
  },

  async unlockPin(req: Request, res: Response) {
    const user = await UserService.unlockPin(req.params.id);
    res.json({ success: true, data: user });
  },
};
