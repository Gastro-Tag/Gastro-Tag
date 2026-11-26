import { Request, Response, Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { AuthController } from '../controllers/authController';
import { ProductController } from '../controllers/productController';
import { LotController } from '../controllers/lotController';
import { LabelController } from '../controllers/labelController';
import { DashboardController } from '../controllers/dashboardController';
import { UserController } from '../controllers/userController';
import { RuleController } from '../controllers/ruleController';
import { TotemController } from '../controllers/totemController';
import { SettingsController } from '../controllers/settingsController';
import { ContingencyController } from '../controllers/contingencyController';
import { authenticate, requireAdmin } from '../middlewares/auth';

const router = Router();

// Só tentativa recusada conta: erro do servidor não pode bloquear a cozinha.
const countOnlyRejected = {
  skipSuccessfulRequests: true,
  requestWasSuccessful: (_req: Request, res: Response) => res.statusCode < 400 || res.statusCode >= 500,
};

const loginRateLimit = rateLimit({
  ...countOnlyRejected,
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
  ...countOnlyRejected,
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    success: false,
    error: { message: 'Muitas tentativas. Tente novamente em 15 minutos.', code: 'RATE_LIMITED' },
  },
});

const changePasswordRateLimit = rateLimit({
  ...countOnlyRejected,
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    success: false,
    error: { message: 'Muitas tentativas. Tente novamente em 15 minutos.', code: 'RATE_LIMITED' },
  },
});

// PIN tem poucas combinações: 5 erros por aparelho e operador escolhido bloqueiam por 15 minutos.
const verifyPinRateLimit = rateLimit({
  ...countOnlyRejected,
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip ?? '')}:${String(req.body?.userId ?? '').slice(0, 64)}`,
  message: {
    success: false,
    error: { message: 'Muitas tentativas de PIN. Tente novamente em 15 minutos.', code: 'RATE_LIMITED' },
  },
});

router.post('/auth/login', loginRateLimit, AuthController.login);
router.post('/auth/refresh', AuthController.refresh);
router.post('/auth/logout', AuthController.logout);
router.patch('/auth/password', authenticate, changePasswordRateLimit, AuthController.changePassword);
router.post('/auth/verify-admin', authenticate, verifyAdminRateLimit, AuthController.verifyAdmin);
router.get('/auth/me', authenticate, AuthController.me);

router.get('/users', authenticate, requireAdmin, UserController.list);
router.post('/users', authenticate, requireAdmin, UserController.create);
router.put('/users/:id', authenticate, requireAdmin, UserController.update);
router.patch('/users/:id/password', authenticate, requireAdmin, UserController.resetPassword);
router.patch('/users/:id/pin', authenticate, requireAdmin, UserController.setPin);

router.get('/totem/operators', authenticate, TotemController.operators);
router.post('/totem/operators/verify', authenticate, verifyPinRateLimit, TotemController.verifyOperator);

router.get('/products', authenticate, ProductController.list);
router.get('/products/categories', authenticate, ProductController.getCategories);
// Antes de /products/:id, senão "without-rule" seria lido como id.
router.get('/products/without-rule', authenticate, requireAdmin, ProductController.withoutRule);
router.get('/products/:id', authenticate, ProductController.getById);
router.post('/products', authenticate, requireAdmin, ProductController.create);
router.put('/products/:id', authenticate, requireAdmin, ProductController.update);
router.delete('/products/:id', authenticate, requireAdmin, ProductController.remove);
router.post('/products/:id/lots', authenticate, requireAdmin, LotController.create);
router.put('/products/:id/lots/:lotId', authenticate, requireAdmin, LotController.update);
router.delete('/products/:id/lots/:lotId', authenticate, requireAdmin, LotController.remove);

router.get('/shelf-life-rules', authenticate, requireAdmin, RuleController.list);
router.get('/shelf-life-rules/:id/versions', authenticate, requireAdmin, RuleController.versions);
router.post('/shelf-life-rules', authenticate, requireAdmin, RuleController.create);
router.put('/shelf-life-rules/:id', authenticate, requireAdmin, RuleController.createVersion);
router.delete('/shelf-life-rules/:id', authenticate, requireAdmin, RuleController.deactivate);

router.get('/labels', authenticate, LabelController.list);
// Antes de /labels/:id, senão "due", "export.csv", "metrics" e "report" seriam lidos como id.
router.get('/labels/due', authenticate, LabelController.due);
router.get('/labels/export.csv', authenticate, requireAdmin, LabelController.exportCsv);
router.get('/labels/metrics', authenticate, requireAdmin, LabelController.metrics);
router.get('/labels/report', authenticate, requireAdmin, LabelController.report);
router.get('/labels/:id', authenticate, LabelController.getById);
router.post('/labels/preview', authenticate, LabelController.preview);
router.post('/labels', authenticate, LabelController.create);
router.patch('/labels/:id/print', authenticate, LabelController.registerPrint);
router.post('/labels/:id/close', authenticate, LabelController.close);
router.post('/labels/:id/split/preview', authenticate, LabelController.splitPreview);
router.post('/labels/:id/split', authenticate, LabelController.split);

router.get('/settings', authenticate, SettingsController.get);
router.put('/settings', authenticate, requireAdmin, SettingsController.update);

// Plano B: o aviso de queda vem de qualquer aparelho logado (o totem roda com conta de operador);
// listar, revisar e lançar registros de contingência é só do ADMIN.
router.post('/contingency/outages', authenticate, ContingencyController.reportOutage);
router.get('/contingency/outages', authenticate, requireAdmin, ContingencyController.listOutages);
router.post('/contingency/outages/:id/review', authenticate, requireAdmin, ContingencyController.reviewOutage);
router.post('/contingency/records/preview', authenticate, requireAdmin, ContingencyController.previewRecord);
router.post('/contingency/records', authenticate, requireAdmin, ContingencyController.createRecord);
router.get('/contingency/records', authenticate, requireAdmin, ContingencyController.listRecords);
router.post('/contingency/records/:id/close', authenticate, requireAdmin, ContingencyController.closeRecord);

router.get('/dashboard/stats', authenticate, DashboardController.getStats);

export default router;
