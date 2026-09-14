import { Request, Response } from 'express';
import { z } from 'zod';
import { ProductService, ProductFilters } from '../services/productService';

const createSchema = z.object({
  name:                  z.string().min(2).max(120),
  brand:                 z.string().min(1).max(120),
  category:              z.string().max(60).optional(),
  originalExpiryDate:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato YYYY-MM-DD.'),
  daysValidRefrigerated: z.number().int().min(0).max(365),
  daysValidFrozen:       z.number().int().min(0).max(1095),
  unit:                  z.string().max(20).optional(),
  notes:                 z.string().max(500).optional(),
}).refine((d) => d.daysValidRefrigerated > 0 || d.daysValidFrozen > 0, {
  message: 'Informe ao menos um tipo de validade pós-abertura.',
});

const updateSchema = createSchema.partial();

const listQuerySchema = z.object({
  search:   z.string().optional(),
  status:   z.enum(['all', 'valid', 'expiring', 'expired', 'recent']).optional(),
  storage:  z.enum(['refrigerado', 'congelado']).optional(),
  category: z.string().optional(),
  sort:     z.enum(['name', 'brand', 'date', 'created']).optional(),
  order:    z.enum(['asc', 'desc']).optional(),
  page:     z.coerce.number().int().positive().optional(),
  limit:    z.coerce.number().int().positive().max(100).optional(),
});

export const ProductController = {
  async list(req: Request, res: Response) {
    const query = listQuerySchema.parse(req.query);
    const result = await ProductService.list(query as ProductFilters);
    res.json({ success: true, ...result });
  },

  async getById(req: Request, res: Response) {
    const product = await ProductService.getById(req.params.id);
    res.json({ success: true, data: product });
  },

  async create(req: Request, res: Response) {
    const data = createSchema.parse(req.body);
    const product = await ProductService.create(data);
    res.status(201).json({ success: true, data: product });
  },

  async update(req: Request, res: Response) {
    const data = updateSchema.parse(req.body);
    const product = await ProductService.update(req.params.id, data);
    res.json({ success: true, data: product });
  },

  async remove(req: Request, res: Response) {
    await ProductService.remove(req.params.id);
    res.json({ success: true, message: 'Produto removido com sucesso.' });
  },

  async getCategories(req: Request, res: Response) {
    const categories = await ProductService.getCategories();
    res.json({ success: true, data: categories });
  },
};
