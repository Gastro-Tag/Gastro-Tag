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
  if (productIds.length) await prisma.productLot.deleteMany({ where: { productId: { in: productIds } } });
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
      name: 'Produto validação', brand: 'Teste',
      daysValidRefrigerated: 2, daysValidFrozen: 5,
    });
    expect(product.status).toBe(201);
    productIds.push(product.body.data.id);

    const invalidDate = await request(app).post('/api/labels/preview')
      .set('Authorization', `Bearer ${accessToken}`).send({
        productId: product.body.data.id, originalExpiryDate: daysFromToday(30), openedAt: '2026-02-31',
        storageType: 'REFRIGERADO', storageTemp: '4°C',
      });
    expect(invalidDate.status).toBe(422);
    expect(invalidDate.body.error.code).toBe('VALIDATION_ERROR');

    const missingResponsible = await request(app).post('/api/labels')
      .set('Authorization', `Bearer ${accessToken}`).send({
        productId: product.body.data.id, lot: `LOT-${suffix.slice(0, 8)}`, originalExpiryDate: daysFromToday(30),
        openedAt: today(), storageType: 'REFRIGERADO', storageTemp: '4°C',
      });
    expect(missingResponsible.status).toBe(422);
    expect(missingResponsible.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('creates a product and a label using the backend discard calculation', async () => {
    const expiry = daysFromToday(30);
    const product = await request(app).post('/api/products').set('Authorization', `Bearer ${accessToken}`).send({
      name: 'Produto integração', brand: 'Teste', category: 'Integração',
      daysValidRefrigerated: 2, daysValidFrozen: 5,
    });
    expect(product.status).toBe(201);
    const productId = product.body.data.id as string;
    productIds.push(productId);

    const openedAt = today();
    const preview = await request(app).post('/api/labels/preview')
      .set('Authorization', `Bearer ${accessToken}`).send({
        productId, originalExpiryDate: expiry, openedAt, storageType: 'REFRIGERADO', storageTemp: '4°C',
      });
    expect(preview.status).toBe(200);
    expect(preview.body.data.rule.shelfLifeDays).toBe(2);
    expect(preview.body.data.discardAt.slice(0, 10)).toBe(daysFromToday(1));

    const label = await request(app).post('/api/labels').set('Authorization', `Bearer ${accessToken}`).send({
      productId, lot: `LOT-${suffix.slice(0, 8)}`, originalExpiryDate: expiry,
      responsibleName: 'Operador de Teste', openedAt, storageType: 'REFRIGERADO', storageTemp: '4°C',
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
        productId: productIds[0], originalExpiryDate: daysFromToday(30), storageType: 'REFRIGERADO', storageTemp: '4°C',
      });
    expect(preview.status).toBe(200);
    expect(preview.body.data.openedAt.slice(0, 10)).toBe(today());

    const label = await request(app).post('/api/labels').set('Authorization', `Bearer ${accessToken}`).send({
      productId: productIds[0], lot: `LOT-${suffix.slice(0, 8)}`, originalExpiryDate: daysFromToday(30),
      responsibleName: 'Operador de Teste', storageType: 'REFRIGERADO', storageTemp: '4°C',
    });
    expect(label.status).toBe(201);
    expect(label.body.data.openedAt.slice(0, 10)).toBe(today());
  });

  it('rejects a future opening date and a label that would be born expired', async () => {
    const payload = {
      productId: productIds[0], lot: `LOT-${suffix.slice(0, 8)}`, originalExpiryDate: daysFromToday(30),
      responsibleName: 'Operador de Teste', storageType: 'REFRIGERADO', storageTemp: '4°C',
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
      name: 'Produto com regra', brand: 'Teste', category: 'Integração',
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
      productId: product.body.data.id, originalExpiryDate: daysFromToday(30), openedAt: today(),
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

  describe('lots and individual packages', () => {
    const asAdmin = () => `Bearer ${accessToken}`;
    const base = { storageType: 'REFRIGERADO', storageTemp: '4°C', responsibleName: 'Operador de Teste' };
    let productId = '';
    const createLot = (code: string, expiryDate: string) => request(app).post(`/api/products/${productId}/lots`)
      .set('Authorization', asAdmin()).send({ code, expiryDate });
    const getProduct = async () => (await request(app).get(`/api/products/${productId}`)
      .set('Authorization', asAdmin()).expect(200)).body.data;
    const previewOf = (body: object) => request(app).post('/api/labels/preview')
      .set('Authorization', asAdmin()).send({ productId, ...base, ...body });
    const createLabel = (body: object) => request(app).post('/api/labels')
      .set('Authorization', asAdmin()).send({ productId, ...base, ...body });

    beforeAll(async () => {
      const product = await request(app).post('/api/products').set('Authorization', asAdmin()).send({
        name: 'Produto com lotes', brand: 'Teste', daysValidRefrigerated: 5, daysValidFrozen: 0,
      }).expect(201);
      productId = product.body.data.id;
      productIds.push(productId);
    });

    it('starts without lots, and the label needs an expiry source', async () => {
      const product = await getProduct();
      expect(product.computedStatus).toBe('no_lot');
      expect(product.nextExpiryDate).toBeNull();

      const noSource = await previewOf({});
      expect(noSource.status).toBe(422);
      expect(noSource.body.error.message).toContain('validade da embalagem');
    });

    it('limits the discard date by the expiry of the chosen lot', async () => {
      const near = await createLot(' lote-a ', daysFromToday(2));
      expect(near.status).toBe(201);
      expect(near.body.data.code).toBe('LOTE-A');
      const far = await createLot('LOTE-B', daysFromToday(40));
      expect(far.status).toBe(201);

      const product = await getProduct();
      expect(product.lots.map((lot: { code: string }) => lot.code)).toEqual(['LOTE-A', 'LOTE-B']);
      expect(product.computedStatus).toBe('expiring');
      expect(product.nextExpiryDate.slice(0, 10)).toBe(daysFromToday(2));

      const capped = await previewOf({ lotId: near.body.data.id });
      expect(capped.body.data.discardAt.slice(0, 10)).toBe(daysFromToday(2));
      expect(capped.body.data.cappedByOriginalExpiry).toBe(true);
      expect(capped.body.data.lot.code).toBe('LOTE-A');

      const free = await previewOf({ lotId: far.body.data.id });
      expect(free.body.data.discardAt.slice(0, 10)).toBe(daysFromToday(4));
      expect(free.body.data.cappedByOriginalExpiry).toBe(false);
    });

    it('keeps on the label the lot and the expiry used, even after the lot changes', async () => {
      const lot = (await createLot('LOTE-C', daysFromToday(3))).body.data;
      const label = await createLabel({ lotId: lot.id });
      expect(label.status).toBe(201);
      expect(label.body.data.lot).toBe('LOTE-C');
      expect(label.body.data.lotId).toBe(lot.id);
      expect(label.body.data.originalExpiryDate.slice(0, 10)).toBe(daysFromToday(3));

      await request(app).put(`/api/products/${productId}/lots/${lot.id}`).set('Authorization', asAdmin())
        .send({ code: 'LOTE-C2', expiryDate: daysFromToday(9) }).expect(200);
      await request(app).delete(`/api/products/${productId}/lots/${lot.id}`).set('Authorization', asAdmin()).expect(200);

      const saved = await request(app).get(`/api/labels/${label.body.data.id}`).set('Authorization', asAdmin()).expect(200);
      expect(saved.body.data.lot).toBe('LOTE-C');
      expect(saved.body.data.originalExpiryDate.slice(0, 10)).toBe(daysFromToday(3));

      const closed = await createLabel({ lotId: lot.id });
      expect(closed.status).toBe(404);
      expect((await getProduct()).lots.some((item: { id: string }) => item.id === lot.id)).toBe(false);
    });

    it('accepts the expiry of an individual package without registering a lot', async () => {
      const before = (await getProduct()).lots.length;
      const label = await createLabel({ lot: 'CAIXA-7', originalExpiryDate: daysFromToday(1) });
      expect(label.status).toBe(201);
      expect(label.body.data.lotId).toBeNull();
      expect(label.body.data.lot).toBe('CAIXA-7');
      expect(label.body.data.discardAt.slice(0, 10)).toBe(daysFromToday(1));
      expect(label.body.data.cappedByOriginalExpiry).toBe(true);
      expect((await getProduct()).lots.length).toBe(before);

      const noCode = await createLabel({ originalExpiryDate: daysFromToday(1) });
      expect(noCode.status).toBe(422);
    });

    it('refuses an expired package, mixed sources and a lot from another product', async () => {
      const expired = await previewOf({ originalExpiryDate: daysFromToday(-1) });
      expect(expired.status).toBe(422);
      expect(expired.body.error.message).toContain('vencida');

      const lot = (await getProduct()).lots[0];
      const mixed = await previewOf({ lotId: lot.id, originalExpiryDate: daysFromToday(10) });
      expect(mixed.status).toBe(422);
      const lotAndText = await createLabel({ lotId: lot.id, lot: 'OUTRO' });
      expect(lotAndText.status).toBe(422);

      const foreign = await request(app).post('/api/labels/preview').set('Authorization', asAdmin())
        .send({ ...base, productId: productIds[0], lotId: lot.id });
      expect(foreign.status).toBe(404);
    });

    it('rejects a duplicate or already expired lot and lets a closed code return', async () => {
      expect((await createLot('LOTE-A', daysFromToday(50))).status).toBe(409);
      expect((await createLot('LOTE-X', daysFromToday(-1))).status).toBe(422);
      expect((await createLot('LOTE-C2', daysFromToday(50))).status).toBe(201);
    });

    it('refuses an expired lot, even when chosen by id', async () => {
      const lot = await prisma.productLot.create({ data: {
        productId, code: 'LOTE-VENCIDO', expiryDate: new Date(`${daysFromToday(-1)}T00:00:00Z`),
      } });
      const preview = await previewOf({ lotId: lot.id });
      expect(preview.status).toBe(422);
      expect(preview.body.error.message).toContain('vencida');
      expect((await createLabel({ lotId: lot.id })).status).toBe(422);

      const product = await getProduct();
      expect(product.computedStatus).toBe('expired');
      expect(product.expiredLotCount).toBe(1);
      await request(app).delete(`/api/products/${productId}/lots/${lot.id}`).set('Authorization', asAdmin()).expect(200);
    });

    it('rejects malformed ids and lots belonging to another product', async () => {
      const lot = (await getProduct()).lots[0];
      const url = `/api/products/${productIds[0]}/lots/${lot.id}`;
      expect((await request(app).put(url).set('Authorization', asAdmin()).send({ code: 'INTRUSO' })).status).toBe(404);
      expect((await request(app).delete(url).set('Authorization', asAdmin())).status).toBe(404);

      expect((await request(app).put(`/api/products/${productId}/lots/nao-e-uuid`)
        .set('Authorization', asAdmin()).send({ code: 'X' })).status).toBe(422);
      expect((await request(app).delete(`/api/products/${productId}/lots/%00`)
        .set('Authorization', asAdmin())).status).toBe(422);
      expect((await createLot('COM\u0000NULO', daysFromToday(10))).status).toBe(422);
    });

    it('does not accept lots of a removed product', async () => {
      const created = await request(app).post('/api/products').set('Authorization', asAdmin()).send({
        name: 'Produto removido com lote', brand: 'Teste', daysValidRefrigerated: 5, daysValidFrozen: 0,
      }).expect(201);
      productIds.push(created.body.data.id);
      const removedId = created.body.data.id as string;
      const lot = await request(app).post(`/api/products/${removedId}/lots`).set('Authorization', asAdmin())
        .send({ code: 'ORFAO', expiryDate: daysFromToday(10) }).expect(201);
      await request(app).delete(`/api/products/${removedId}`).set('Authorization', asAdmin()).expect(200);

      const preview = await request(app).post('/api/labels/preview').set('Authorization', asAdmin())
        .send({ ...base, productId: removedId, lotId: lot.body.data.id });
      expect(preview.status).toBe(404);
    });

    it('flags the lot created by the migration as pending review', async () => {
      const lot = await prisma.productLot.create({ data: {
        productId, code: 'SEM-LOTE', expiryDate: new Date(`${daysFromToday(20)}T00:00:00Z`),
      } });
      const product = await getProduct();
      expect(product.pendingLotCount).toBe(1);
      expect(product.lots.find((item: { id: string }) => item.id === lot.id).needsReview).toBe(true);

      await request(app).put(`/api/products/${productId}/lots/${lot.id}`).set('Authorization', asAdmin())
        .send({ code: 'REAL-1' }).expect(200);
      expect((await getProduct()).pendingLotCount).toBe(0);
    });

    it('allows only administrators to manage lots', async () => {
      const login = await request(app).post('/api/auth/login').send({ email: operatorEmail, password: 'TestPassword123!' });
      const asOperator = `Bearer ${login.body.data.accessToken}`;
      const lot = (await getProduct()).lots[0];

      expect((await request(app).post(`/api/products/${productId}/lots`).set('Authorization', asOperator)
        .send({ code: 'NEGADO', expiryDate: daysFromToday(10) })).status).toBe(403);
      expect((await request(app).put(`/api/products/${productId}/lots/${lot.id}`).set('Authorization', asOperator)
        .send({ code: 'NEGADO' })).status).toBe(403);
      expect((await request(app).delete(`/api/products/${productId}/lots/${lot.id}`).set('Authorization', asOperator)).status).toBe(403);
    });

    it('classifies products by their active lots in the list and on the dashboard', async () => {
      const make = async (name: string, expiries: string[]) => {
        const created = await request(app).post('/api/products').set('Authorization', asAdmin()).send({
          name: `${name} ${suffix}`, brand: 'Status', daysValidRefrigerated: 2, daysValidFrozen: 0,
        }).expect(201);
        productIds.push(created.body.data.id);
        if (expiries.length) {
          await prisma.productLot.createMany({ data: expiries.map((date, index) => ({
            productId: created.body.data.id, code: `S${index}`, expiryDate: new Date(`${date}T00:00:00Z`),
          })) });
        }
      };
      await make('Valido', [daysFromToday(30)]);
      await make('Proximo', [daysFromToday(3), daysFromToday(30)]);
      await make('Vencido', [daysFromToday(-1), daysFromToday(30)]);
      await make('Sinlote', []);
      await make('Limite7', [daysFromToday(7)]);
      await make('Limite8', [daysFromToday(8)]);
      await make('Hoje', [today()]);
      await make('Sovencido', [daysFromToday(-2)]);

      const namesFor = async (query: string) => {
        const list = await request(app).get(`/api/products?search=${suffix}&${query}`).set('Authorization', asAdmin()).expect(200);
        return list.body.data.map((item: { name: string; computedStatus: string }) => item.name.split(' ')[0]);
      };
      expect(await namesFor('status=valid')).toEqual(['Limite8', 'Valido']);
      expect(await namesFor('status=expiring')).toEqual(['Hoje', 'Limite7', 'Proximo']);
      expect(await namesFor('status=expired')).toEqual(['Sovencido', 'Vencido']);
      expect(await namesFor('status=no_lot')).toEqual(['Sinlote']);
      expect(await namesFor('sort=date&order=asc')).toEqual(
        ['Sovencido', 'Vencido', 'Hoje', 'Proximo', 'Limite7', 'Limite8', 'Valido', 'Sinlote'],
      );
      expect(await namesFor('sort=date&order=desc')).toEqual(
        ['Valido', 'Limite8', 'Limite7', 'Proximo', 'Hoje', 'Vencido', 'Sovencido', 'Sinlote'],
      );

      // A consulta e o resumo por produto precisam concordar nos limites.
      const everyProduct = await request(app).get(`/api/products?search=${suffix}&limit=100`).set('Authorization', asAdmin()).expect(200);
      const statusOf = Object.fromEntries(everyProduct.body.data.map(
        (item: { name: string; computedStatus: string }) => [item.name.split(' ')[0], item.computedStatus],
      ));
      expect(statusOf).toMatchObject({
        Valido: 'valid', Limite8: 'valid', Limite7: 'expiring', Hoje: 'expiring', Proximo: 'expiring',
        Vencido: 'expired', Sovencido: 'expired', Sinlote: 'no_lot',
      });

      const list = await request(app).get(`/api/products?search=${suffix}&status=expired`).set('Authorization', asAdmin()).expect(200);
      const [onlyExpired, withGoodLot] = list.body.data;
      expect(onlyExpired.nextExpiryDate).toBeNull();
      expect(onlyExpired.daysUntilExpiry).toBeNull();
      expect(withGoodLot.expiredLotCount).toBe(1);
      expect(withGoodLot.nextExpiryDate.slice(0, 10)).toBe(daysFromToday(30));

      const stats = await request(app).get('/api/dashboard/stats').set('Authorization', asAdmin()).expect(200);
      expect(stats.body.data.products.expired).toBeGreaterThanOrEqual(1);
      expect(stats.body.data.products.expiring).toBeGreaterThanOrEqual(1);
    });
  });

  it('restricts product removal to administrators', async () => {
    const product = await request(app).post('/api/products').set('Authorization', `Bearer ${accessToken}`).send({
      name: 'Produto de permissão', brand: 'Teste',
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
      name: 'Produto bloqueado', brand: 'Teste',
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
      productId: productIds[0], lot: 'LOT-OPERADOR', originalExpiryDate: daysFromToday(30), responsibleName: 'Operador criado',
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
