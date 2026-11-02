import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { AuthController } from '../controllers/authController';
import { ProductController } from '../controllers/productController';
import { LabelController } from '../controllers/labelController';
import { DashboardController } from '../controllers/dashboardController';
import { UserController } from '../controllers/userController';
import { authenticate, requireAdmin } from '../middlewares/auth';

const router = Router();
const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    success: false,
    error: { message: 'Muitas tentativas de login. Tente novamente em 15 minutos.', code: 'RATE_LIMITED' },
  },
});

const verifyAdminRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    success: false,
    error: { message: 'Muitas tentativas. Tente novamente em 15 minutos.', code: 'RATE_LIMITED' },
  },
});

router.post('/auth/login', loginRateLimit, AuthController.login);
router.post('/auth/refresh', AuthController.refresh);
router.post('/auth/verify-admin', authenticate, verifyAdminRateLimit, AuthController.verifyAdmin);
router.get('/auth/me', authenticate, AuthController.me);

router.get('/users', authenticate, requireAdmin, UserController.list);
router.post('/users', authenticate, requireAdmin, UserController.create);
router.put('/users/:id', authenticate, requireAdmin, UserController.update);
router.patch('/users/:id/password', authenticate, requireAdmin, UserController.resetPassword);

router.get('/products', authenticate, ProductController.list);
router.get('/products/categories', authenticate, ProductController.getCategories);
router.get('/products/:id', authenticate, ProductController.getById);
router.post('/products', authenticate, requireAdmin, ProductController.create);
router.put('/products/:id', authenticate, requireAdmin, ProductController.update);
router.delete('/products/:id', authenticate, requireAdmin, ProductController.remove);

router.get('/labels', authenticate, LabelController.list);
router.get('/labels/:id', authenticate, LabelController.getById);
router.post('/labels/preview', authenticate, LabelController.preview);
router.post('/labels', authenticate, LabelController.create);
router.patch('/labels/:id/print', authenticate, LabelController.registerPrint);

router.get('/dashboard/stats', authenticate, DashboardController.getStats);

export default router;
