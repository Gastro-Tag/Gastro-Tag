import { Request, Response } from 'express';
import { z } from 'zod';
import { OperatorService } from '../services/operatorService';

const verifySchema = z.object({
  userId: z.string().uuid('Escolha o operador.'),
  pin: z.string().regex(/^\d{4,6}$/, 'O PIN deve ter de 4 a 6 dígitos.'),
});

export const TotemController = {
  async operators(_req: Request, res: Response) {
    const operators = await OperatorService.listWithPin();
    res.json({ success: true, data: operators });
  },

  async verifyOperator(req: Request, res: Response) {
    const { userId, pin } = verifySchema.parse(req.body);
    const result = await OperatorService.verify(userId, pin, req.user!.sid);
    res.json({ success: true, data: result });
  },
};
