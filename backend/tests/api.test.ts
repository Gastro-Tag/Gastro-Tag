import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../src/app';
import { prisma } from '../src/prisma/client';
import { AuthService } from '../src/services/authService';

const suffix = randomUUID();
const email = `api-test-${suffix}@example.test`;
let userId = '';
let productId = '';
let accessToken = '';
let refreshToken = '';

beforeAll(async () => {
  const user = await prisma.user.create({ data: {
    name: 'Teste de integração', email,
    passwordHash: await AuthService.hashPassword('TestPassword123!'), role: 'ADMIN',
  } });
  userId = user.id;
});

afterAll(async () => {
  if (productId) await prisma.label.deleteMany({ where: { productId } });
  if (productId) await prisma.product.deleteMany({ where: { id: productId } });
  if (userId) await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

describe('API integration flow', () => {
  it('logs in, denies unauthenticated access, and rejects a refresh token as access', async () => {
    const login = await request(app).post('/api/auth/login').send({ email, password: 'TestPassword123!' });
    expect(login.status).toBe(200);
    accessToken = login.body.data.accessToken;
    refreshToken = login.body.data.refreshToken;

    expect((await request(app).get('/api/auth/me')).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${refreshToken}`)).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`)).status).toBe(200);
  });

  it('creates a product and a label using the backend discard calculation', async () => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + 30);
    const expiry = date.toISOString().slice(0, 10);
    const product = await request(app).post('/api/products').set('Authorization', `Bearer ${accessToken}`).send({
      name: 'Produto integração', brand: 'Teste', category: 'Integração',
      originalExpiryDate: expiry, daysValidRefrigerated: 2, daysValidFrozen: 5,
    });
    expect(product.status).toBe(201);
    productId = product.body.data.id;

    const openedAt = new Date().toISOString().slice(0, 10);
    const preview = await request(app).post('/api/labels/preview')
      .set('Authorization', `Bearer ${accessToken}`).send({
        productId, openedAt, storageType: 'REFRIGERADO', storageTemp: '4°C',
      });
    expect(preview.status).toBe(200);
    expect(preview.body.data.rule.shelfLifeDays).toBe(2);
    expect(preview.body.data.discardAt.slice(0, 10)).toBe(new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10));

    const label = await request(app).post('/api/labels').set('Authorization', `Bearer ${accessToken}`).send({
      productId, lot: `LOT-${suffix.slice(0, 8)}`, responsibleName: 'Operador de Teste', openedAt,
      storageType: 'REFRIGERADO', storageTemp: '4°C',
    });
    expect(label.status).toBe(201);
    expect(label.body.data.shelfLifeDays).toBe(2);
    expect(label.body.data.productName).toBe('Produto integração');
    expect(label.body.data.discardAt.slice(0, 10)).toBe(new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10));
  });
});
