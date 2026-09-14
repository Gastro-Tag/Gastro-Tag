import { Router } from 'express';
import { AuthController }      from '../controllers/authController';
import { ProductController }   from '../controllers/productController';
import { LabelController }     from '../controllers/labelController';
import { DashboardController } from '../controllers/dashboardController';
import { authenticate, requireAdmin } from '../middlewares/auth';

const router = Router();

// ── Auth ─────────────────────────────────────────────────
router.post('/auth/login',   AuthController.login);
router.post('/auth/refresh', AuthController.refresh);
router.get ('/auth/me',      authenticate, AuthController.me);

// ── Products ──────────────────────────────────────────────
router.get   ('/products',              authenticate, ProductController.list);
router.get   ('/products/categories',   authenticate, ProductController.getCategories);
router.get   ('/products/:id',          authenticate, ProductController.getById);
router.post  ('/products',              authenticate, ProductController.create);
router.put   ('/products/:id',          authenticate, ProductController.update);
router.delete('/products/:id',          authenticate, requireAdmin, ProductController.remove);

// ── Labels ───────────────────────────────────────────────
router.get  ('/labels',           authenticate, LabelController.list);
router.get  ('/labels/:id',       authenticate, LabelController.getById);
router.post ('/labels',           authenticate, LabelController.create);
router.patch('/labels/:id/print', authenticate, LabelController.registerPrint);

// ── Dashboard ────────────────────────────────────────────
router.get('/dashboard/stats', authenticate, DashboardController.getStats);

export default router;
