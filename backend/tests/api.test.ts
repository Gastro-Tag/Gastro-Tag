import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../src/app';
import { prisma } from '../src/prisma/client';
import { AuthService } from '../src/services/authService';

const suffix = randomUUID();
const email = `api-test-${suffix}@example.test`;
const operatorEmail = `api-operator-${suffix}@example.test`;
let userId = '';
let operatorId = '';
const productIds: string[] = [];
const ruleIds: string[] = [];
let accessToken = '';
let refreshToken = '';
let operatorToken = '';

beforeAll(async () => {
  const user = await prisma.user.create({ data: {
    name: 'Teste de integração', email,
    passwordHash: await AuthService.hashPassword('TestPassword123!'), role: 'ADMIN',
  } });
  userId = user.id;

  const operator = await prisma.user.create({ data: {
    name: 'Operador de integração', email: operatorEmail,
    passwordHash: await AuthService.hashPassword('TestPassword123!'), role: 'OPERATOR',
  } });
  operatorId = operator.id;
});

afterAll(async () => {
  if (productIds.length) await prisma.label.deleteMany({ where: { productId: { in: productIds } } });
  if (ruleIds.length) await prisma.shelfLifeRule.deleteMany({ where: { id: { in: ruleIds } } });
  if (productIds.length) await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  if (operatorId) await prisma.user.deleteMany({ where: { id: operatorId } });
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

  it('returns 422 for invalid dates and missing required label data', async () => {
    const product = await request(app).post('/api/products').set('Authorization', `Bearer ${accessToken}`).send({
      name: 'Produto validação', brand: 'Teste', originalExpiryDate: '2035-12-31',
      daysValidRefrigerated: 2, daysValidFrozen: 5,
    });
    expect(product.status).toBe(201);
    productIds.push(product.body.data.id);

    const invalidDate = await request(app).post('/api/labels/preview')
      .set('Authorization', `Bearer ${accessToken}`).send({
        productId: product.body.data.id, openedAt: '2026-02-31', storageType: 'REFRIGERADO', storageTemp: '4°C',
      });
    expect(invalidDate.status).toBe(422);
    expect(invalidDate.body.error.code).toBe('VALIDATION_ERROR');

    const missingResponsible = await request(app).post('/api/labels')
      .set('Authorization', `Bearer ${accessToken}`).send({
        productId: product.body.data.id, lot: `LOT-${suffix.slice(0, 8)}`,
        openedAt: new Date().toISOString().slice(0, 10), storageType: 'REFRIGERADO', storageTemp: '4°C',
      });
    expect(missingResponsible.status).toBe(422);
    expect(missingResponsible.body.error.code).toBe('VALIDATION_ERROR');
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
    const productId = product.body.data.id as string;
    productIds.push(productId);

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

    await request(app).put(`/api/products/${productId}`).set('Authorization', `Bearer ${accessToken}`).send({
      name: 'Nome alterado', brand: 'Marca alterada',
    }).expect(200);
    const savedLabel = await request(app).get(`/api/labels/${label.body.data.id}`)
      .set('Authorization', `Bearer ${accessToken}`).expect(200);
    expect(savedLabel.body.data.productName).toBe('Produto integração');
    expect(savedLabel.body.data.productBrand).toBe('Teste');
    expect(savedLabel.body.data.responsibleName).toBe('Operador de Teste');

    const printed = await request(app).patch(`/api/labels/${label.body.data.id}/print`)
      .set('Authorization', `Bearer ${accessToken}`).expect(200);
    expect(printed.body.data.printCount).toBe(1);
    expect(printed.body.data.responsibleName).toBe('Operador de Teste');
  });

  it('applies temperature limits from a product-specific rule', async () => {
    const product = await request(app).post('/api/products').set('Authorization', `Bearer ${accessToken}`).send({
      name: 'Produto com regra', brand: 'Teste', category: 'Integração', originalExpiryDate: '2035-12-31',
      daysValidRefrigerated: 2, daysValidFrozen: 5,
    });
    expect(product.status).toBe(201);
    productIds.push(product.body.data.id);

    const rule = await prisma.shelfLifeRule.create({ data: {
      productId: product.body.data.id, storageType: 'REFRIGERADO', shelfLifeDays: 4,
      minTemperature: '0', maxTemperature: '5', source: 'Regra de teste',
    } });
    ruleIds.push(rule.id);

    const payload = {
      productId: product.body.data.id, openedAt: new Date().toISOString().slice(0, 10),
      storageType: 'REFRIGERADO',
    };
    const outsideRange = await request(app).post('/api/labels/preview')
      .set('Authorization', `Bearer ${accessToken}`).send({ ...payload, storageTemp: '6°C' });
    expect(outsideRange.status).toBe(422);
    expect(outsideRange.body.error.code).toBe('VALIDATION_ERROR');

    const withinRange = await request(app).post('/api/labels/preview')
      .set('Authorization', `Bearer ${accessToken}`).send({ ...payload, storageTemp: '4°C' });
    expect(withinRange.status).toBe(200);
    expect(withinRange.body.data.rule.shelfLifeDays).toBe(4);
  });

  it('restricts product removal to administrators', async () => {
    const product = await request(app).post('/api/products').set('Authorization', `Bearer ${accessToken}`).send({
      name: 'Produto de permissão', brand: 'Teste', originalExpiryDate: '2035-12-31',
      daysValidRefrigerated: 2, daysValidFrozen: 5,
    });
    expect(product.status).toBe(201);
    productIds.push(product.body.data.id);

    const login = await request(app).post('/api/auth/login').send({ email: operatorEmail, password: 'TestPassword123!' });
    expect(login.status).toBe(200);
    operatorToken = login.body.data.accessToken;

    const denied = await request(app).delete(`/api/products/${product.body.data.id}`)
      .set('Authorization', `Bearer ${operatorToken}`);
    expect(denied.status).toBe(403);
    await request(app).delete(`/api/products/${product.body.data.id}`)
      .set('Authorization', `Bearer ${accessToken}`).expect(200);
  });
});
