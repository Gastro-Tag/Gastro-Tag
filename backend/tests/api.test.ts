import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import app from '../src/app';
import { prisma } from '../src/prisma/client';
import { AuthService } from '../src/services/authService';
import { kitchenToday } from '../src/utils/dateUtils';

// Precisa valer antes de importar o app: simula a API atrás do nginx.
vi.hoisted(() => { process.env.TRUST_PROXY_HOPS = '1'; });
const isoDate = (date: Date) => date.toISOString().slice(0, 10);
const today = () => isoDate(kitchenToday());
const daysFromToday = (days: number) => isoDate(new Date(kitchenToday().getTime() + days * 86_400_000));

const suffix = randomUUID();
const email = `api-test-${suffix}@example.test`;
const operatorEmail = `api-operator-${suffix}@example.test`;
let userId = '';
let operatorId = '';
const productIds: string[] = [];
const ruleIds: string[] = [];
const createdUserIds: string[] = [];
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
  if (createdUserIds.length) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
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
        openedAt: today(), storageType: 'REFRIGERADO', storageTemp: '4°C',
      });
    expect(missingResponsible.status).toBe(422);
    expect(missingResponsible.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('creates a product and a label using the backend discard calculation', async () => {
    const expiry = daysFromToday(30);
    const product = await request(app).post('/api/products').set('Authorization', `Bearer ${accessToken}`).send({
      name: 'Produto integração', brand: 'Teste', category: 'Integração',
      originalExpiryDate: expiry, daysValidRefrigerated: 2, daysValidFrozen: 5,
    });
    expect(product.status).toBe(201);
    const productId = product.body.data.id as string;
    productIds.push(productId);

    const openedAt = today();
    const preview = await request(app).post('/api/labels/preview')
      .set('Authorization', `Bearer ${accessToken}`).send({
        productId, openedAt, storageType: 'REFRIGERADO', storageTemp: '4°C',
      });
    expect(preview.status).toBe(200);
    expect(preview.body.data.rule.shelfLifeDays).toBe(2);
    expect(preview.body.data.discardAt.slice(0, 10)).toBe(daysFromToday(1));

    const label = await request(app).post('/api/labels').set('Authorization', `Bearer ${accessToken}`).send({
      productId, lot: `LOT-${suffix.slice(0, 8)}`, responsibleName: 'Operador de Teste', openedAt,
      storageType: 'REFRIGERADO', storageTemp: '4°C',
    });
    expect(label.status).toBe(201);
    expect(label.body.data.shelfLifeDays).toBe(2);
    expect(label.body.data.productName).toBe('Produto integração');
    expect(label.body.data.discardAt.slice(0, 10)).toBe(daysFromToday(1));

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

  it('uses the kitchen date when openedAt is omitted', async () => {
    const preview = await request(app).post('/api/labels/preview')
      .set('Authorization', `Bearer ${accessToken}`).send({
        productId: productIds[0], storageType: 'REFRIGERADO', storageTemp: '4°C',
      });
    expect(preview.status).toBe(200);
    expect(preview.body.data.openedAt.slice(0, 10)).toBe(today());

    const label = await request(app).post('/api/labels').set('Authorization', `Bearer ${accessToken}`).send({
      productId: productIds[0], lot: `LOT-${suffix.slice(0, 8)}`, responsibleName: 'Operador de Teste',
      storageType: 'REFRIGERADO', storageTemp: '4°C',
    });
    expect(label.status).toBe(201);
    expect(label.body.data.openedAt.slice(0, 10)).toBe(today());
  });

  it('rejects a future opening date and a label that would be born expired', async () => {
    const payload = {
      productId: productIds[0], lot: `LOT-${suffix.slice(0, 8)}`, responsibleName: 'Operador de Teste',
      storageType: 'REFRIGERADO', storageTemp: '4°C',
    };
    const postLabel = (body: object) => request(app).post('/api/labels')
      .set('Authorization', `Bearer ${accessToken}`).send(body);

    const future = await postLabel({ ...payload, openedAt: daysFromToday(1) });
    expect(future.status).toBe(422);
    expect(future.body.error.message).toContain('futura');

    const expired = await postLabel({ ...payload, openedAt: daysFromToday(-10) });
    expect(expired.status).toBe(422);
    expect(expired.body.error.message).toContain('vencida');

    const lastValidDay = await postLabel({ ...payload, openedAt: daysFromToday(-1) });
    expect(lastValidDay.status).toBe(201);
    expect(lastValidDay.body.data.discardAt.slice(0, 10)).toBe(today());
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
      productId: product.body.data.id, openedAt: today(),
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

  it('blocks operators from writing products and from managing users', async () => {
    const productPayload = {
      name: 'Produto bloqueado', brand: 'Teste', originalExpiryDate: '2035-12-31',
      daysValidRefrigerated: 2, daysValidFrozen: 5,
    };
    const created = await request(app).post('/api/products')
      .set('Authorization', `Bearer ${operatorToken}`).send(productPayload);
    expect(created.status).toBe(403);

    const product = await request(app).post('/api/products')
      .set('Authorization', `Bearer ${accessToken}`).send(productPayload).expect(201);
    productIds.push(product.body.data.id);

    const updated = await request(app).put(`/api/products/${product.body.data.id}`)
      .set('Authorization', `Bearer ${operatorToken}`).send({ daysValidRefrigerated: 30 });
    expect(updated.status).toBe(403);

    expect((await request(app).get('/api/users').set('Authorization', `Bearer ${operatorToken}`)).status).toBe(403);
    const newUser = await request(app).post('/api/users').set('Authorization', `Bearer ${operatorToken}`).send({
      name: 'Bloqueado', email: `blocked-${suffix}@example.test`, password: 'TestPassword123!', role: 'ADMIN',
    });
    expect(newUser.status).toBe(403);
  });

  it('lets an admin create an operator who can log in and label, never exposing the password hash', async () => {
    const newEmail = `api-new-operator-${suffix}@example.test`;
    const created = await request(app).post('/api/users').set('Authorization', `Bearer ${accessToken}`).send({
      name: 'Operador criado', email: newEmail, password: 'TestPassword123!', role: 'OPERATOR',
    });
    expect(created.status).toBe(201);
    expect(created.body.data.passwordHash).toBeUndefined();
    createdUserIds.push(created.body.data.id);

    const duplicate = await request(app).post('/api/users').set('Authorization', `Bearer ${accessToken}`).send({
      name: 'Duplicado', email: newEmail, password: 'TestPassword123!', role: 'OPERATOR',
    });
    expect(duplicate.status).toBe(409);

    const list = await request(app).get('/api/users').set('Authorization', `Bearer ${accessToken}`).expect(200);
    expect(list.body.data.some((user: { email: string }) => user.email === newEmail)).toBe(true);
    expect(JSON.stringify(list.body)).not.toContain('passwordHash');

    const login = await request(app).post('/api/auth/login').send({ email: newEmail, password: 'TestPassword123!' });
    expect(login.status).toBe(200);
    const token = login.body.data.accessToken as string;

    const label = await request(app).post('/api/labels').set('Authorization', `Bearer ${token}`).send({
      productId: productIds[0], lot: 'LOT-OPERADOR', responsibleName: 'Operador criado',
      openedAt: today(), storageType: 'REFRIGERADO', storageTemp: '4°C',
    });
    expect(label.status).toBe(201);

    await request(app).put(`/api/users/${created.body.data.id}`)
      .set('Authorization', `Bearer ${accessToken}`).send({ active: false }).expect(200);
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`)).status).toBe(401);
  });

  it('keeps an admin from locking out their own account', async () => {
    const deactivate = await request(app).put(`/api/users/${userId}`)
      .set('Authorization', `Bearer ${accessToken}`).send({ active: false });
    expect(deactivate.status).toBe(422);
    const demote = await request(app).put(`/api/users/${userId}`)
      .set('Authorization', `Bearer ${accessToken}`).send({ role: 'OPERATOR' });
    expect(demote.status).toBe(422);
  });

  it('applies a password reset made by an admin', async () => {
    const resetEmail = `api-reset-${suffix}@example.test`;
    const created = await request(app).post('/api/users').set('Authorization', `Bearer ${accessToken}`).send({
      name: 'Troca de senha', email: resetEmail, password: 'TestPassword123!', role: 'OPERATOR',
    }).expect(201);
    createdUserIds.push(created.body.data.id);

    const tooShort = await request(app).patch(`/api/users/${created.body.data.id}/password`)
      .set('Authorization', `Bearer ${accessToken}`).send({ password: 'curta' });
    expect(tooShort.status).toBe(422);

    await request(app).patch(`/api/users/${created.body.data.id}/password`)
      .set('Authorization', `Bearer ${accessToken}`).send({ password: 'NewTestPassword456!' }).expect(200);
    const oldLogin = await request(app).post('/api/auth/login').send({ email: resetEmail, password: 'TestPassword123!' });
    expect(oldLogin.status).toBe(401);
    const newLogin = await request(app).post('/api/auth/login').send({ email: resetEmail, password: 'NewTestPassword456!' });
    expect(newLogin.status).toBe(200);
  });

  it('renews the session and answers 401 for an invalid refresh token', async () => {
    const renewed = await request(app).post('/api/auth/refresh').send({ refreshToken });
    expect(renewed.status).toBe(200);
    expect(renewed.body.data.accessToken).toBeTruthy();

    const invalid = await request(app).post('/api/auth/refresh').send({ refreshToken: 'token-invalido' });
    expect(invalid.status).toBe(401);
  });

  it('counts only failed logins, separately for each client address', async () => {
    const loginFrom = (ip: string) => request(app).post('/api/auth/login').set('X-Forwarded-For', ip);

    for (let attempt = 0; attempt < 11; attempt++) {
      expect((await loginFrom('203.0.113.10').send({ email, password: 'TestPassword123!' })).status).toBe(200);
    }

    const badLogin = { email: `ninguem-${suffix}@example.test`, password: 'WrongPassword123!' };
    for (let attempt = 0; attempt < 10; attempt++) {
      expect((await loginFrom('203.0.113.20').send(badLogin)).status).toBe(401);
    }
    const blocked = await loginFrom('203.0.113.20').send(badLogin);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');

    expect((await loginFrom('203.0.113.30').send(badLogin)).status).toBe(401);
  }, 30_000);

  it('does not count server errors against the login limit', async () => {
    const loginFrom = () => request(app).post('/api/auth/login').set('X-Forwarded-For', '203.0.113.40')
      .send({ email, password: 'TestPassword123!' });

    const outage = vi.spyOn(AuthService, 'login').mockRejectedValue(new Error('banco indisponível'));
    try {
      for (let attempt = 0; attempt < 12; attempt++) {
        expect((await loginFrom()).status).toBe(500);
      }
    } finally {
      outage.mockRestore();
    }
    expect((await loginFrom()).status).toBe(200);
  });

  it('unlocks admin actions only with administrator credentials', async () => {
    const asOperator = await request(app).post('/api/auth/verify-admin')
      .set('Authorization', `Bearer ${operatorToken}`).send({ email: operatorEmail, password: 'TestPassword123!' });
    expect(asOperator.status).toBe(403);

    const wrongPassword = await request(app).post('/api/auth/verify-admin')
      .set('Authorization', `Bearer ${operatorToken}`).send({ email, password: 'WrongPassword123!' });
    expect(wrongPassword.status).toBe(403);

    const asAdmin = await request(app).post('/api/auth/verify-admin')
      .set('Authorization', `Bearer ${operatorToken}`).send({ email, password: 'TestPassword123!' });
    expect(asAdmin.status).toBe(200);
    expect(asAdmin.body.data.valid).toBe(true);

    const anonymous = await request(app).post('/api/auth/verify-admin').send({ email, password: 'TestPassword123!' });
    expect(anonymous.status).toBe(401);
  });
});
