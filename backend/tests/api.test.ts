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

// Valores fictícios, só para o teste: o sistema não traz prazos cadastrados.
const ruleBody = {
  sourceType: 'REFERENCIA_TECNICA', source: 'Regra de teste de integração',
  validatedByName: 'Responsável Técnico de Teste', validatedAt: daysFromToday(-1),
};

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
  if (productIds.length) {
    // Origem com filhas não pode ser apagada (Restrict): apaga das folhas para a origem.
    for (let round = 0; round < 10; round++) {
      const removed = await prisma.label.deleteMany({ where: { productId: { in: productIds }, children: { none: {} } } });
      if (removed.count === 0) break;
    }
  }
  if (ruleIds.length) {
    // Versões apontam umas para as outras (Restrict): solta a cadeia antes de apagar.
    await prisma.shelfLifeRule.updateMany({ where: { id: { in: ruleIds } }, data: { previousVersionId: null } });
    await prisma.shelfLifeRule.deleteMany({ where: { id: { in: ruleIds } } });
  }
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
        storageType: 'REFRIGERADO', storageTemperature: 4,
      });
    expect(invalidDate.status).toBe(422);
    expect(invalidDate.body.error.code).toBe('VALIDATION_ERROR');

    const missingResponsible = await request(app).post('/api/labels')
      .set('Authorization', `Bearer ${accessToken}`).send({
        productId: product.body.data.id, lot: `LOT-${suffix.slice(0, 8)}`, originalExpiryDate: daysFromToday(30),
        openedAt: today(), storageType: 'REFRIGERADO', storageTemperature: 4,
      });
    expect(missingResponsible.status).toBe(422);
    expect(missingResponsible.body.error.code).toBe('VALIDATION_ERROR');

    const missingTemperature = await request(app).post('/api/labels')
      .set('Authorization', `Bearer ${accessToken}`).send({
        productId: product.body.data.id, lot: `LOT-${suffix.slice(0, 8)}`, originalExpiryDate: daysFromToday(30),
        responsibleName: 'Operador de Teste', storageType: 'REFRIGERADO', storageTemp: '4°C',
      });
    expect(missingTemperature.status).toBe(422);
    expect(missingTemperature.body.error.message).toContain('temperatura');
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
        productId, originalExpiryDate: expiry, openedAt, storageType: 'REFRIGERADO', storageTemperature: 4,
      });
    expect(preview.status).toBe(200);
    expect(preview.body.data.rule.shelfLifeDays).toBe(2);
    expect(preview.body.data.rule).toMatchObject({
      id: null, sourceType: null, version: null, validated: false,
      source: 'Prazo cadastrado no produto (sem regra validada)',
    });
    expect(preview.body.data.discardAt.slice(0, 10)).toBe(daysFromToday(1));

    const label = await request(app).post('/api/labels').set('Authorization', `Bearer ${accessToken}`).send({
      productId, lot: `LOT-${suffix.slice(0, 8)}`, originalExpiryDate: expiry,
      responsibleName: 'Operador de Teste', openedAt, storageType: 'REFRIGERADO', storageTemperature: 4,
    });
    expect(label.status).toBe(201);
    expect(label.body.data.shelfLifeDays).toBe(2);
    expect(label.body.data).toMatchObject({
      storageTemperature: 4, storageTemp: '4,0 °C', ruleId: null, ruleVersion: null,
      ruleSource: 'Prazo cadastrado no produto (sem regra validada)',
    });
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
        productId: productIds[0], originalExpiryDate: daysFromToday(30), storageType: 'REFRIGERADO', storageTemperature: 4,
      });
    expect(preview.status).toBe(200);
    expect(preview.body.data.openedAt.slice(0, 10)).toBe(today());

    const label = await request(app).post('/api/labels').set('Authorization', `Bearer ${accessToken}`).send({
      productId: productIds[0], lot: `LOT-${suffix.slice(0, 8)}`, originalExpiryDate: daysFromToday(30),
      responsibleName: 'Operador de Teste', storageType: 'REFRIGERADO', storageTemperature: 4,
    });
    expect(label.status).toBe(201);
    expect(label.body.data.openedAt.slice(0, 10)).toBe(today());
  });

  it('rejects a future opening date and a label that would be born expired', async () => {
    const payload = {
      productId: productIds[0], lot: `LOT-${suffix.slice(0, 8)}`, originalExpiryDate: daysFromToday(30),
      responsibleName: 'Operador de Teste', storageType: 'REFRIGERADO', storageTemperature: 4,
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

    const rule = await request(app).post('/api/shelf-life-rules').set('Authorization', `Bearer ${accessToken}`).send({
      ...ruleBody, productId: product.body.data.id, storageType: 'REFRIGERADO', shelfLifeDays: 4,
      minTemperature: 0, maxTemperature: 5,
    });
    expect(rule.status).toBe(201);
    ruleIds.push(rule.body.data.id);

    const payload = {
      productId: product.body.data.id, originalExpiryDate: daysFromToday(30), openedAt: today(),
      storageType: 'REFRIGERADO',
    };
    const preview = (body: object) => request(app).post('/api/labels/preview')
      .set('Authorization', `Bearer ${accessToken}`).send({ ...payload, ...body });

    const outsideRange = await preview({ storageTemperature: 6 });
    expect(outsideRange.status).toBe(422);
    expect(outsideRange.body.error.code).toBe('VALIDATION_ERROR');
    expect(outsideRange.body.error.message).toContain('acima da faixa');
    expect((await preview({ storageTemperature: -0.5 })).body.error.message).toContain('abaixo da faixa');

    const withinRange = await preview({ storageTemperature: 4.25 });
    expect(withinRange.status).toBe(200);
    expect(withinRange.body.data.rule).toMatchObject({
      id: rule.body.data.id, shelfLifeDays: 4, minTemperature: 0, maxTemperature: 5,
      sourceType: 'REFERENCIA_TECNICA', version: 1, validatedByName: 'Responsável Técnico de Teste',
      validatedAt: daysFromToday(-1), validated: true,
    });
    expect(withinRange.body.data.storageTemperature).toBe(4.3);
    expect(withinRange.body.data.storageTemp).toBe('4,3 °C');

    // Sem temperatura, a prévia calcula o prazo sem conferir a faixa.
    const withoutTemperature = await preview({});
    expect(withoutTemperature.status).toBe(200);
    expect(withoutTemperature.body.data.storageTemperature).toBeNull();
    expect(withoutTemperature.body.data.storageTemp).toBeNull();

    // Texto livre não é mais aceito, nem medição fora da faixa de sanidade.
    expect((await preview({ storageTemperature: '4°C' })).status).toBe(422);
    expect((await preview({ storageTemperature: 31 })).status).toBe(422);
    expect((await preview({ storageTemperature: -51 })).status).toBe(422);

    const label = await request(app).post('/api/labels').set('Authorization', `Bearer ${accessToken}`).send({
      ...payload, lot: 'LOT-REGRA', responsibleName: 'Operador de Teste', storageTemperature: 3,
    });
    expect(label.status).toBe(201);
    expect(label.body.data).toMatchObject({
      ruleId: rule.body.data.id, ruleVersion: 1, ruleSource: ruleBody.source,
      storageTemperature: 3, storageTemp: '3,0 °C', shelfLifeDays: 4,
    });
    expect(label.body.data.rule.minTemperature).toBe(0);

    const outside = await request(app).post('/api/labels').set('Authorization', `Bearer ${accessToken}`).send({
      ...payload, lot: 'LOT-REGRA', responsibleName: 'Operador de Teste', storageTemperature: 7,
    });
    expect(outside.status).toBe(422);
  });

  describe('versioned shelf-life rules', () => {
    const asAdmin = () => `Bearer ${accessToken}`;
    const category = `Regras ${suffix.slice(0, 8)}`;
    let productId = '';
    const rules = (method: 'get' | 'post' | 'put' | 'delete', path = '', token = asAdmin()) =>
      request(app)[method](`/api/shelf-life-rules${path}`).set('Authorization', token);

    beforeAll(async () => {
      const product = await request(app).post('/api/products').set('Authorization', asAdmin()).send({
        name: `Produto versões ${suffix.slice(0, 8)}`, brand: 'Teste', category,
        daysValidRefrigerated: 2, daysValidFrozen: 5,
      });
      productId = product.body.data.id;
      productIds.push(productId);
    });

    it('lets only administrators manage rules', async () => {
      const login = await request(app).post('/api/auth/login').send({ email: operatorEmail, password: 'TestPassword123!' });
      const asOperator = `Bearer ${login.body.data.accessToken}`;
      const anyId = randomUUID();
      expect((await rules('get', '', asOperator)).status).toBe(403);
      expect((await rules('get', `/${anyId}/versions`, asOperator)).status).toBe(403);
      expect((await rules('post', '', asOperator).send({
        ...ruleBody, category, storageType: 'CONGELADO', shelfLifeDays: 10,
      })).status).toBe(403);
      expect((await rules('put', `/${anyId}`, asOperator).send({ ...ruleBody, shelfLifeDays: 10 })).status).toBe(403);
      expect((await rules('delete', `/${anyId}`, asOperator)).status).toBe(403);
      expect((await request(app).get('/api/shelf-life-rules')).status).toBe(401);
    });

    it('validates the rule body', async () => {
      const post = (body: object) => rules('post').send({
        ...ruleBody, category, storageType: 'CONGELADO', shelfLifeDays: 10, ...body,
      });
      expect((await post({ productId })).status).toBe(422); // produto e categoria juntos
      expect((await post({ category: undefined })).status).toBe(422); // nenhum alvo
      expect((await post({ shelfLifeDays: 0 })).status).toBe(422);
      expect((await post({ minTemperature: 5, maxTemperature: 1 })).status).toBe(422);
      expect((await post({ maxTemperature: 31 })).status).toBe(422); // mesma faixa da etiqueta
      expect((await post({ minTemperature: -51 })).status).toBe(422);
      const unknownCategory = await post({ category: `Inexistente ${suffix}` });
      expect(unknownCategory.status).toBe(422);
      expect(unknownCategory.body.error.message).toBe('Categoria não encontrada entre os produtos ativos.');
      expect((await post({ sourceType: 'OUTRA' })).status).toBe(422);
      expect((await post({ source: '' })).status).toBe(422);
      expect((await post({ validatedByName: undefined })).status).toBe(422);
      expect((await post({ validatedAt: daysFromToday(1) })).status).toBe(422);
      expect((await post({ category: undefined, productId: randomUUID() })).status).toBe(404);
    });

    it('creates a rule, refuses a second active one and chains new versions', async () => {
      const created = await rules('post').send({
        ...ruleBody, productId, storageType: 'REFRIGERADO', shelfLifeDays: 3, maxTemperature: 5,
      });
      expect(created.status).toBe(201);
      ruleIds.push(created.body.data.id);
      expect(created.body.data).toMatchObject({
        productId, category: null, storageType: 'REFRIGERADO', shelfLifeDays: 3,
        minTemperature: null, maxTemperature: 5, version: 1, previousVersionId: null, active: true,
        deactivatedAt: null, validatedAt: daysFromToday(-1), sourceType: 'REFERENCIA_TECNICA',
        product: { id: productId }, createdBy: { name: 'Teste de integração' },
      });

      const duplicate = await rules('post').send({ ...ruleBody, productId, storageType: 'REFRIGERADO', shelfLifeDays: 4 });
      expect(duplicate.status).toBe(409);
      expect(duplicate.body.error.message).toBe('Já existe uma regra ativa para este alvo. Crie uma nova versão dela.');
      // Outro armazenamento é outro alvo.
      const frozen = await rules('post').send({ ...ruleBody, productId, storageType: 'CONGELADO', shelfLifeDays: 30 });
      expect(frozen.status).toBe(201);
      ruleIds.push(frozen.body.data.id);

      const labelPayload = {
        productId, lot: 'LOT-VERSAO', originalExpiryDate: daysFromToday(30), responsibleName: 'Operador de Teste',
        storageType: 'REFRIGERADO', storageTemperature: 4,
      };
      const oldLabel = await request(app).post('/api/labels').set('Authorization', asAdmin()).send(labelPayload);
      expect(oldLabel.status).toBe(201);
      expect(oldLabel.body.data).toMatchObject({ ruleId: created.body.data.id, ruleVersion: 1, shelfLifeDays: 3 });
      // Regra usada por etiqueta não pode ser apagada nem direto no banco (FK Restrict).
      await expect(prisma.shelfLifeRule.delete({ where: { id: created.body.data.id } }))
        .rejects.toMatchObject({ code: 'P2003' });
      expect(await prisma.shelfLifeRule.count({ where: { id: created.body.data.id } })).toBe(1);

      const v2 = await rules('put', `/${created.body.data.id}`).send({
        ...ruleBody, shelfLifeDays: 2, minTemperature: 0, maxTemperature: 4, source: 'Fonte revisada',
        observation: 'Revisão de teste',
      });
      expect(v2.status).toBe(201);
      ruleIds.push(v2.body.data.id);
      expect(v2.body.data).toMatchObject({
        productId, storageType: 'REFRIGERADO', version: 2, previousVersionId: created.body.data.id,
        active: true, shelfLifeDays: 2, source: 'Fonte revisada', observation: 'Revisão de teste',
      });

      const versions = await rules('get', `/${created.body.data.id}/versions`).expect(200);
      expect(versions.body.data.map((rule: { version: number }) => rule.version)).toEqual([2, 1]);
      expect(versions.body.data[1]).toMatchObject({ id: created.body.data.id, active: false });
      expect(versions.body.data[1].deactivatedAt).not.toBeNull();
      expect((await rules('get', `/${v2.body.data.id}/versions`)).body.data).toHaveLength(2);

      // A versão antiga não pode mais ser editada.
      expect((await rules('put', `/${created.body.data.id}`).send({ ...ruleBody, shelfLifeDays: 5 })).status).toBe(409);

      // A etiqueta antiga continua na versão 1; a nova usa a versão 2 e a faixa nova.
      const savedOld = await request(app).get(`/api/labels/${oldLabel.body.data.id}`).set('Authorization', asAdmin()).expect(200);
      expect(savedOld.body.data).toMatchObject({
        ruleId: created.body.data.id, ruleVersion: 1, ruleSource: ruleBody.source, shelfLifeDays: 3,
      });
      const tooWarm = await request(app).post('/api/labels').set('Authorization', asAdmin())
        .send({ ...labelPayload, storageTemperature: 4.5 });
      expect(tooWarm.status).toBe(422);
      const newLabel = await request(app).post('/api/labels').set('Authorization', asAdmin()).send(labelPayload);
      expect(newLabel.body.data).toMatchObject({
        ruleId: v2.body.data.id, ruleVersion: 2, ruleSource: 'Fonte revisada', shelfLifeDays: 2,
      });

      const activeOnly = await rules('get', `?productId=${productId}`).expect(200);
      expect(activeOnly.body.data.map((rule: { id: string }) => rule.id).sort())
        .toEqual([v2.body.data.id, frozen.body.data.id].sort());
      expect(activeOnly.body.meta).toMatchObject({ total: 2, page: 1 });
      const withInactive = await rules('get', `?productId=${productId}&includeInactive=true&storageType=REFRIGERADO`).expect(200);
      expect(withInactive.body.data.map((rule: { version: number }) => rule.version)).toEqual([2, 1]);
    });

    it('only deactivates on delete, and a category rule applies when the product has none', async () => {
      const categoryRule = await rules('post').send({
        ...ruleBody, category, storageType: 'CONGELADO', shelfLifeDays: 20,
      });
      expect(categoryRule.status).toBe(201);
      ruleIds.push(categoryRule.body.data.id);

      const other = await request(app).post('/api/products').set('Authorization', asAdmin()).send({
        name: `Outro da categoria ${suffix.slice(0, 8)}`, brand: 'Teste', category,
        daysValidRefrigerated: 2, daysValidFrozen: 5,
      });
      productIds.push(other.body.data.id);
      const previewFrozen = () => request(app).post('/api/labels/preview').set('Authorization', asAdmin()).send({
        productId: other.body.data.id, originalExpiryDate: daysFromToday(60), storageType: 'CONGELADO',
      });
      expect((await previewFrozen()).body.data.rule).toMatchObject({ id: categoryRule.body.data.id, validated: true });
      const label = await request(app).post('/api/labels').set('Authorization', asAdmin()).send({
        productId: other.body.data.id, lot: 'LOT-CAT', originalExpiryDate: daysFromToday(60),
        responsibleName: 'Operador de Teste', storageType: 'CONGELADO', storageTemperature: -18,
      });
      expect(label.body.data).toMatchObject({ ruleId: categoryRule.body.data.id, storageTemp: '-18,0 °C' });

      const removed = await rules('delete', `/${categoryRule.body.data.id}`).expect(200);
      expect(removed.body.data).toMatchObject({ id: categoryRule.body.data.id, active: false });
      expect(removed.body.data.deactivatedAt).not.toBeNull();
      expect(await prisma.shelfLifeRule.count({ where: { id: categoryRule.body.data.id } })).toBe(1);
      expect((await request(app).get(`/api/labels/${label.body.data.id}`).set('Authorization', asAdmin())).body.data.ruleId)
        .toBe(categoryRule.body.data.id);

      // Sem regra ativa, volta ao prazo do produto, sem regra validada.
      expect((await previewFrozen()).body.data.rule).toMatchObject({ id: null, shelfLifeDays: 5, validated: false });
      expect((await rules('delete', `/${randomUUID()}`)).status).toBe(404);

      // Depois de desativada, o alvo aceita uma regra nova.
      const again = await rules('post').send({ ...ruleBody, category, storageType: 'CONGELADO', shelfLifeDays: 15 });
      expect(again.status).toBe(201);
      ruleIds.push(again.body.data.id);
    });

    it('stores the category as written on the active products', async () => {
      const canonical = `Laticínios ${suffix.slice(0, 8)}`;
      const product = await request(app).post('/api/products').set('Authorization', asAdmin()).send({
        name: `Produto laticínio ${suffix.slice(0, 8)}`, brand: 'Teste', category: canonical,
        daysValidRefrigerated: 2, daysValidFrozen: 5,
      });
      productIds.push(product.body.data.id);

      const created = await rules('post').send({
        ...ruleBody, category: `  laticinios ${suffix.slice(0, 8).toUpperCase()} `, storageType: 'REFRIGERADO', shelfLifeDays: 3,
      });
      expect(created.status).toBe(201);
      ruleIds.push(created.body.data.id);
      expect(created.body.data.category).toBe(canonical);

      // Outra grafia do mesmo alvo bate no 409, e o preview encontra a regra.
      const duplicate = await rules('post').send({
        ...ruleBody, category: `laticínios ${suffix.slice(0, 8)}`, storageType: 'REFRIGERADO', shelfLifeDays: 4,
      });
      expect(duplicate.status).toBe(409);
      const preview = await request(app).post('/api/labels/preview').set('Authorization', asAdmin()).send({
        productId: product.body.data.id, originalExpiryDate: daysFromToday(30), storageType: 'REFRIGERADO',
      });
      expect(preview.body.data.rule).toMatchObject({ id: created.body.data.id, validated: true });
    });

    it('treats any rule, even an old one without a validator, as validated on the label', async () => {
      const product = await request(app).post('/api/products').set('Authorization', asAdmin()).send({
        name: `Produto regra antiga ${suffix.slice(0, 8)}`, brand: 'Teste', daysValidRefrigerated: 2, daysValidFrozen: 5,
      });
      productIds.push(product.body.data.id);
      // Como as regras que a migration encontrou: sem responsável nem data de validação.
      const legacy = await prisma.shelfLifeRule.create({ data: {
        productId: product.body.data.id, storageType: 'REFRIGERADO', shelfLifeDays: 3,
        sourceType: 'REFERENCIA_TECNICA', source: 'Regra antiga de teste',
      } });
      ruleIds.push(legacy.id);
      const preview = await request(app).post('/api/labels/preview').set('Authorization', asAdmin()).send({
        productId: product.body.data.id, originalExpiryDate: daysFromToday(30), storageType: 'REFRIGERADO',
      });
      expect(preview.body.data.rule).toMatchObject({
        id: legacy.id, validatedByName: null, validatedAt: null, validated: true,
      });
    });

    it('creates only one new version when two edits arrive together', async () => {
      const base = await rules('post').send({ ...ruleBody, category, storageType: 'REFRIGERADO', shelfLifeDays: 3 });
      expect(base.status).toBe(201);
      ruleIds.push(base.body.data.id);
      const [a, b] = await Promise.all([
        rules('put', `/${base.body.data.id}`).send({ ...ruleBody, shelfLifeDays: 4 }),
        rules('put', `/${base.body.data.id}`).send({ ...ruleBody, shelfLifeDays: 5 }),
      ]);
      for (const res of [a, b]) if (res.status === 201) ruleIds.push(res.body.data.id);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      expect(await prisma.shelfLifeRule.count({ where: { category, storageType: 'REFRIGERADO', active: true } })).toBe(1);
    });
  });

  describe('lots and individual packages', () => {
    const asAdmin = () => `Bearer ${accessToken}`;
    const base = { storageType: 'REFRIGERADO', storageTemperature: 4, responsibleName: 'Operador de Teste' };
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
      openedAt: today(), storageType: 'REFRIGERADO', storageTemperature: 4,
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

  describe('sessions', () => {
    const newUser = async (label: string) => {
      const userEmail = `api-${label}-${suffix}@example.test`;
      const created = await request(app).post('/api/users').set('Authorization', `Bearer ${accessToken}`).send({
        name: `Sessão ${label}`, email: userEmail, password: 'TestPassword123!', role: 'OPERATOR',
      }).expect(201);
      createdUserIds.push(created.body.data.id);
      return { id: created.body.data.id as string, email: userEmail };
    };
    const login = async (userEmail: string, password = 'TestPassword123!') => {
      const res = await request(app).post('/api/auth/login').send({ email: userEmail, password }).expect(200);
      return res.body.data as { accessToken: string; refreshToken: string };
    };
    const me = (token: string) => request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    const refresh = (token: string) => request(app).post('/api/auth/refresh').send({ refreshToken: token });

    it('logs out only the device that asked', async () => {
      const user = await newUser('logout');
      const tablet = await login(user.email);
      const panel = await login(user.email);

      // Só o refresh token: a saída vale mesmo depois que o token de acesso venceu.
      await request(app).post('/api/auth/logout').send({ refreshToken: tablet.refreshToken }).expect(200);
      expect((await me(tablet.accessToken)).status).toBe(401);
      expect((await refresh(tablet.refreshToken)).status).toBe(401);
      expect((await me(panel.accessToken)).status).toBe(200);
      expect((await request(app).post('/api/auth/logout').send({ refreshToken: 'token-invalido' })).status).toBe(401);
    });

    it('rotates the refresh token and ends the session when an old token comes back', async () => {
      const user = await newUser('rotate');
      const first = await login(user.email);

      // Duas abas renovando juntas com o mesmo token: as duas seguem logadas.
      const [tabA, tabB] = await Promise.all([refresh(first.refreshToken), refresh(first.refreshToken)]);
      expect([tabA.status, tabB.status]).toEqual([200, 200]);
      const latest = await refresh(tabB.body.data.refreshToken as string);
      expect(latest.status).toBe(200);
      expect(latest.body.data.refreshToken).not.toBe(first.refreshToken);

      // Passada a tolerância, o token antigo indica cópia: a sessão inteira cai.
      await prisma.userSession.updateMany({ where: { userId: user.id }, data: { rotatedAt: new Date(Date.now() - 60_000) } });
      expect((await refresh(first.refreshToken)).status).toBe(401);
      expect((await refresh(latest.body.data.refreshToken as string)).status).toBe(401);
      expect((await me(latest.body.data.accessToken as string)).status).toBe(401);
    });

    it('ends every session when an admin resets the password or changes the role', async () => {
      const user = await newUser('revoke');
      const before = await login(user.email);
      await request(app).patch(`/api/users/${user.id}/password`)
        .set('Authorization', `Bearer ${accessToken}`).send({ password: 'NewTestPassword456!' }).expect(200);
      expect((await me(before.accessToken)).status).toBe(401);
      expect((await refresh(before.refreshToken)).status).toBe(401);

      const afterReset = await login(user.email, 'NewTestPassword456!');
      await request(app).put(`/api/users/${user.id}`)
        .set('Authorization', `Bearer ${accessToken}`).send({ name: 'Só o nome muda' }).expect(200);
      expect((await me(afterReset.accessToken)).status).toBe(200);
      await request(app).put(`/api/users/${user.id}`)
        .set('Authorization', `Bearer ${accessToken}`).send({ role: 'ADMIN' }).expect(200);
      expect((await me(afterReset.accessToken)).status).toBe(401);
    });

    it('lets users change their own password and ends their other sessions', async () => {
      const user = await newUser('own');
      const current = await login(user.email);
      const other = await login(user.email);
      const change = (body: object) => request(app).patch('/api/auth/password')
        .set('Authorization', `Bearer ${current.accessToken}`).send(body);

      expect((await change({ currentPassword: 'Errada123456!', newPassword: 'NewTestPassword456!' })).status).toBe(422);
      expect((await change({ currentPassword: 'TestPassword123!', newPassword: 'TestPassword123!' })).status).toBe(422);
      expect((await change({ currentPassword: 'TestPassword123!', newPassword: 'curta' })).status).toBe(422);
      await change({ currentPassword: 'TestPassword123!', newPassword: 'NewTestPassword456!' }).expect(200);

      expect((await me(current.accessToken)).status).toBe(200);
      expect((await me(other.accessToken)).status).toBe(401);
      expect((await request(app).post('/api/auth/login').send({ email: user.email, password: 'TestPassword123!' })).status).toBe(401);
      await login(user.email, 'NewTestPassword456!');
    });

    it('answers unknown e-mail, deactivated account and wrong password the same way', async () => {
      const user = await newUser('enum');
      await request(app).put(`/api/users/${user.id}`)
        .set('Authorization', `Bearer ${accessToken}`).send({ active: false }).expect(200);
      // IP próprio para não somar falhas ao limite dos outros testes de login.
      const attempt = (body: object) => request(app).post('/api/auth/login')
        .set('X-Forwarded-For', '203.0.113.77').send(body);

      const answers = [
        await attempt({ email: `inexistente-${suffix}@example.test`, password: 'TestPassword123!' }),
        await attempt({ email: user.email, password: 'TestPassword123!' }),
        await attempt({ email, password: 'WrongPassword123!' }),
      ];
      for (const res of answers) {
        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toEqual({ message: 'E-mail ou senha incorretos.', code: 'INVALID_CREDENTIALS' });
      }
    });

    it('returns the same label when the same request is sent again', async () => {
      const send = (productId: string, requestId?: string) => request(app).post('/api/labels')
        .set('Authorization', `Bearer ${accessToken}`).send({
          productId, lot: 'LOT-REENVIO', originalExpiryDate: daysFromToday(30), responsibleName: 'Reenvio',
          storageType: 'REFRIGERADO', storageTemperature: 4, requestId,
        });
      const requestId = randomUUID();
      const first = await send(productIds[0], requestId);
      expect(first.status).toBe(201);
      const again = await send(productIds[0], requestId);
      expect(again.status).toBe(200);
      expect(again.body.data.id).toBe(first.body.data.id);
      expect(await prisma.label.count({ where: { requestId } })).toBe(1);

      const otherProduct = productIds.find((id) => id !== productIds[0])!;
      expect((await send(otherProduct, requestId)).status).toBe(409);

      // Sem chave, cada envio é uma etiqueta nova, como antes.
      const plainA = await send(productIds[0]);
      const plainB = await send(productIds[0]);
      expect([plainA.status, plainB.status]).toEqual([201, 201]);
      expect(plainA.body.data.id).not.toBe(plainB.body.data.id);
    });
  });
});

describe('closing and splitting labels', () => {
  const asAdmin = () => `Bearer ${accessToken}`;
  let asOperator = '';
  let productId = '';
  let ruleProductId = '';

  const newLabel = async (body: object = {}, product = productId) => {
    const res = await request(app).post('/api/labels').set('Authorization', asAdmin()).send({
      productId: product, lot: 'LOT-FRAC', originalExpiryDate: daysFromToday(60), openedAt: today(),
      responsibleName: 'Abertura', storageType: 'REFRIGERADO', storageTemperature: 4, ...body,
    });
    expect(res.status).toBe(201);
    return res.body.data as { id: string; shortCode: string; discardAt: string };
  };
  const close = (id: string, body: object, token = asAdmin()) =>
    request(app).post(`/api/labels/${id}/close`).set('Authorization', token).send(body);
  const splitPreview = (id: string, body: object) =>
    request(app).post(`/api/labels/${id}/split/preview`).set('Authorization', asAdmin()).send(body);
  const split = (id: string, body: object, token = asAdmin()) =>
    request(app).post(`/api/labels/${id}/split`).set('Authorization', token).send({
      count: 1, storageType: 'REFRIGERADO', storageTemperature: 4, responsibleName: 'Fracionador', ...body,
    });
  const listLabels = (query: Record<string, string>) =>
    request(app).get('/api/labels').query({ limit: '100', ...query }).set('Authorization', asAdmin());

  beforeAll(async () => {
    const login = await request(app).post('/api/auth/login').send({ email: operatorEmail, password: 'TestPassword123!' });
    asOperator = `Bearer ${login.body.data.accessToken}`;
    // Prazos fictícios, só para o teste.
    const product = await request(app).post('/api/products').set('Authorization', asAdmin()).send({
      name: `Produto fracionado ${suffix.slice(0, 8)}`, brand: 'Teste', category: `Frac ${suffix.slice(0, 8)}`,
      daysValidRefrigerated: 5, daysValidFrozen: 30,
    });
    productId = product.body.data.id;
    productIds.push(productId);
    const ruleProduct = await request(app).post('/api/products').set('Authorization', asAdmin()).send({
      name: `Produto frac regra ${suffix.slice(0, 8)}`, brand: 'Teste', category: `Frac regra ${suffix.slice(0, 8)}`,
      daysValidRefrigerated: 10, daysValidFrozen: 30,
    });
    ruleProductId = ruleProduct.body.data.id;
    productIds.push(ruleProductId);
  });

  describe('close', () => {
    it('closes as used, repeats the same outcome and refuses another one', async () => {
      const label = await newLabel();
      const first = await close(label.id, { outcome: 'USADO' });
      expect(first.status).toBe(200);
      expect(first.body.data).toMatchObject({
        id: label.id, status: 'ENCERRADA', outcome: 'USADO', discardReason: null, closeNote: null,
        closedByName: 'Teste de integração', parent: null, parentLabelId: null, fractionedAt: null,
      });
      expect(first.body.data.closedAt).toBeTruthy();
      expect(first.body.meta.activeChildren).toEqual([]);

      const again = await close(label.id, { outcome: 'USADO' });
      expect(again.status).toBe(200);
      expect(again.body.data.closedAt).toBe(first.body.data.closedAt);

      const other = await close(label.id, { outcome: 'DESCARTADO', discardReason: 'PRAZO_VENCIDO' });
      expect(other.status).toBe(409);
      expect(other.body.error.message).toBe('Esta etiqueta já foi encerrada.');

      // Encerrada não volta para a bancada: reimprimir é conflito e não conta impressão.
      const reprint = await request(app).patch(`/api/labels/${label.id}/print`).set('Authorization', asAdmin());
      expect(reprint.status).toBe(409);
      expect(reprint.body.error.message).toBe('Etiqueta encerrada não pode ser reimpressa.');
      expect((await prisma.label.findUniqueOrThrow({ where: { id: label.id } })).printCount).toBe(0);
      const active = await newLabel();
      const printed = await request(app).patch(`/api/labels/${active.id}/print`).set('Authorization', asAdmin());
      expect(printed.status).toBe(200);
      expect(printed.body.data).toMatchObject({ printCount: 1, parent: null });
      expect((await request(app).patch(`/api/labels/${randomUUID()}/print`).set('Authorization', asAdmin())).status).toBe(404);
    });

    it('requires a discard reason, and a note when the reason is "Outro"', async () => {
      const label = await newLabel();
      expect((await close(label.id, { outcome: 'DESCARTADO' })).status).toBe(422);
      expect((await close(label.id, { outcome: 'USADO', discardReason: 'PRAZO_VENCIDO' })).status).toBe(422);
      expect((await close(label.id, { outcome: 'DESCARTADO', discardReason: 'OUTRO' })).status).toBe(422);
      expect((await close(label.id, { outcome: 'DESCARTADO', discardReason: 'OUTRO', note: ' ab ' })).status).toBe(422);
      expect((await close(label.id, { outcome: 'DESCARTADO', discardReason: 'INVALIDO' })).status).toBe(422);
      expect((await close(label.id, { outcome: 'PERDIDO' })).status).toBe(422);
      expect((await close(label.id, {
        outcome: 'DESCARTADO', discardReason: 'PRAZO_VENCIDO', note: 'x'.repeat(301),
      })).status).toBe(422);

      const discarded = await close(label.id, { outcome: 'DESCARTADO', discardReason: 'OUTRO', note: ' Caiu no chão ' });
      expect(discarded.status).toBe(200);
      expect(discarded.body.data).toMatchObject({
        status: 'ENCERRADA', outcome: 'DESCARTADO', discardReason: 'OUTRO', closeNote: 'Caiu no chão',
      });
      expect((await close(label.id, { outcome: 'DESCARTADO', discardReason: 'OUTRO', note: 'Repetido' })).status).toBe(200);
      expect((await close(label.id, { outcome: 'DESCARTADO', discardReason: 'PRAZO_VENCIDO' })).status).toBe(409);

      const sensorial = await newLabel();
      const bySensorial = await close(sensorial.id, { outcome: 'DESCARTADO', discardReason: 'ALTERACAO_SENSORIAL' });
      expect(bySensorial.status).toBe(200);
      expect(bySensorial.body.data.closeNote).toBeNull();
    });

    it('lets only administrators cancel, while operators close as used or discarded', async () => {
      const label = await newLabel();
      const denied = await close(label.id, { outcome: 'CANCELADO' }, asOperator);
      expect(denied.status).toBe(403);
      const unchanged = await request(app).get(`/api/labels/${label.id}`).set('Authorization', asAdmin());
      expect(unchanged.body.data.status).toBe('ATIVA');

      const used = await close(label.id, { outcome: 'USADO' }, asOperator);
      expect(used.status).toBe(200);
      expect(used.body.data.closedByName).toBe('Operador de integração');

      const cancelled = await close((await newLabel()).id, { outcome: 'CANCELADO' });
      expect(cancelled.status).toBe(200);
      expect(cancelled.body.data.outcome).toBe('CANCELADO');

      expect((await close(randomUUID(), { outcome: 'USADO' })).status).toBe(404);
      expect((await request(app).post(`/api/labels/${label.id}/close`).send({ outcome: 'USADO' })).status).toBe(401);
    });

    it('warns about children still active, without closing them', async () => {
      const parent = await newLabel();
      const created = await split(parent.id, { count: 2 });
      expect(created.status).toBe(201);
      const [childA, childB] = created.body.data.children as { id: string; shortCode: string }[];
      await close(childA.id, { outcome: 'USADO' }).expect(200);

      const closed = await close(parent.id, { outcome: 'USADO' });
      expect(closed.status).toBe(200);
      expect(closed.body.meta.activeChildren).toHaveLength(1);
      expect(closed.body.meta.activeChildren[0]).toMatchObject({ id: childB.id, shortCode: childB.shortCode });
      expect(closed.body.meta.activeChildren[0].discardAt).toBeTruthy();
      const child = await request(app).get(`/api/labels/${childB.id}`).set('Authorization', asAdmin());
      expect(child.body.data.status).toBe('ATIVA');
    });
  });

  describe('split', () => {
    it('previews the child limited by the parent, and by the rule when it is shorter', async () => {
      const parent = await newLabel(); // refrigerado, 5 dias: descarte em hoje + 4
      expect(parent.discardAt.slice(0, 10)).toBe(daysFromToday(4));

      const refrigerated = await splitPreview(parent.id, { storageType: 'REFRIGERADO' });
      expect(refrigerated.status).toBe(200);
      expect(refrigerated.body.data).toMatchObject({
        cappedByParent: false, cappedByOriginalExpiry: false, fractionedAt: today(),
        storageTemperature: null, storageTemp: null,
      });
      expect(refrigerated.body.data.discardAt.slice(0, 10)).toBe(daysFromToday(4));
      expect(refrigerated.body.data.rule).toMatchObject({ id: null, shelfLifeDays: 5, validated: false });

      // Congelado (30 dias) passaria da origem: fica na data da origem.
      const frozen = await splitPreview(parent.id, { storageType: 'CONGELADO', storageTemperature: -18 });
      expect(frozen.status).toBe(200);
      expect(frozen.body.data.discardAt.slice(0, 10)).toBe(daysFromToday(4));
      expect(frozen.body.data.cappedByParent).toBe(true);
      expect(frozen.body.data.storageTemp).toBe('-18,0 °C');
      const frozenChild = await split(parent.id, { storageType: 'CONGELADO', storageTemperature: -18 });
      expect(frozenChild.status).toBe(201);
      expect(frozenChild.body.data.children[0].cappedByParent).toBe(true);
      expect(frozenChild.body.data.children[0].discardAt.slice(0, 10)).toBe(daysFromToday(4));

      // Origem com 10 dias pelo produto; depois, regra de 2 dias com faixa de temperatura.
      const ruleParent = await newLabel({}, ruleProductId);
      expect(ruleParent.discardAt.slice(0, 10)).toBe(daysFromToday(9));
      const rule = await request(app).post('/api/shelf-life-rules').set('Authorization', asAdmin()).send({
        ...ruleBody, productId: ruleProductId, storageType: 'REFRIGERADO', shelfLifeDays: 2,
        minTemperature: 0, maxTemperature: 5,
      });
      expect(rule.status).toBe(201);
      ruleIds.push(rule.body.data.id);

      const byRule = await splitPreview(ruleParent.id, { storageType: 'REFRIGERADO', storageTemperature: 3 });
      expect(byRule.status).toBe(200);
      expect(byRule.body.data.discardAt.slice(0, 10)).toBe(daysFromToday(1));
      expect(byRule.body.data.cappedByParent).toBe(false);
      expect(byRule.body.data.rule).toMatchObject({
        id: rule.body.data.id, shelfLifeDays: 2, version: 1, validated: true, minTemperature: 0, maxTemperature: 5,
      });

      const outside = await splitPreview(ruleParent.id, { storageType: 'REFRIGERADO', storageTemperature: 7 });
      expect(outside.status).toBe(422);
      expect(outside.body.error.message).toContain('acima da faixa');
      expect((await split(ruleParent.id, { storageTemperature: -1 })).status).toBe(422);
      expect((await splitPreview(ruleParent.id, { storageType: 'REFRIGERADO', storageTemperature: 31 })).status).toBe(422);

      const child = await split(ruleParent.id, { storageTemperature: 3 });
      expect(child.status).toBe(201);
      expect(child.body.data.children[0]).toMatchObject({
        ruleId: rule.body.data.id, ruleVersion: 1, ruleSource: ruleBody.source, shelfLifeDays: 2,
        storageTemperature: 3, storageTemp: '3,0 °C',
      });
      expect(child.body.data.children[0].discardAt.slice(0, 10)).toBe(daysFromToday(1));
    });

    it('validates the body', async () => {
      const parent = await newLabel();
      expect((await split(parent.id, { count: 0 })).status).toBe(422);
      expect((await split(parent.id, { count: 21 })).status).toBe(422);
      expect((await split(parent.id, { count: 1.5 })).status).toBe(422);
      expect((await split(parent.id, { count: '2' })).status).toBe(422);
      expect((await split(parent.id, { storageTemperature: undefined })).status).toBe(422);
      expect((await split(parent.id, { storageTemperature: 31 })).status).toBe(422);
      expect((await split(parent.id, { responsibleName: '  ' })).status).toBe(422);
      expect((await split(parent.id, { storageType: 'AMBIENTE' })).status).toBe(422);
      expect((await split(parent.id, { requestId: 'nao-e-uuid' })).status).toBe(422);
      expect((await split(randomUUID(), {})).status).toBe(404);
      expect(await prisma.label.count({ where: { parentLabelId: parent.id } })).toBe(0);
    });

    it('refuses a closed parent (409) and an expired parent (422)', async () => {
      const closed = await newLabel();
      await close(closed.id, { outcome: 'USADO' }).expect(200);
      expect((await splitPreview(closed.id, { storageType: 'REFRIGERADO' })).status).toBe(409);
      expect((await split(closed.id, {})).status).toBe(409);

      const expired = await newLabel();
      await prisma.label.update({ where: { id: expired.id }, data: { discardAt: new Date(`${daysFromToday(-1)}T00:00:00Z`) } });
      const preview = await splitPreview(expired.id, { storageType: 'REFRIGERADO' });
      expect(preview.status).toBe(422);
      expect(preview.body.error.message).toBe('A etiqueta de origem está vencida. Descarte o produto.');
      expect((await split(expired.id, {})).status).toBe(422);
      expect(await prisma.label.count({ where: { parentLabelId: { in: [closed.id, expired.id] } } })).toBe(0);
    });

    it('creates children from the parent snapshot, each with its own code', async () => {
      const parent = await newLabel();
      // O produto muda depois da abertura: a filha copia o que está na etiqueta de origem.
      await request(app).put(`/api/products/${productId}`).set('Authorization', asAdmin())
        .send({ name: `Produto fracionado renomeado ${suffix.slice(0, 8)}`, brand: 'Outra marca' }).expect(200);

      const created = await split(parent.id, { count: 3, responsibleName: ' Maria ' }, asOperator);
      expect(created.status).toBe(201);
      const { parent: parentAfter, children } = created.body.data;
      expect(parentAfter).toMatchObject({ id: parent.id, status: 'ATIVA' });
      expect(children).toHaveLength(3);
      expect(new Set(children.map((child: { shortCode: string }) => child.shortCode)).size).toBe(3);
      for (const child of children) {
        expect(child).toMatchObject({
          productId, productName: `Produto fracionado ${suffix.slice(0, 8)}`, productBrand: 'Teste',
          lot: 'LOT-FRAC', userId: operatorId, responsibleName: 'Maria', status: 'ATIVA',
          parentLabelId: parent.id, parent: { id: parent.id, shortCode: parent.shortCode },
          fractionedAt: today(), storageType: 'REFRIGERADO', storageTemperature: 4, storageTemp: '4,0 °C',
          requestId: null, cappedByParent: false,
        });
        expect(child.openedAt.slice(0, 10)).toBe(today());
        expect(child.originalExpiryDate.slice(0, 10)).toBe(daysFromToday(60));
        expect(child.discardAt.slice(0, 10)).toBe(daysFromToday(4));
      }

      const detail = await request(app).get(`/api/labels/${parent.id}`).set('Authorization', asAdmin());
      expect(detail.body.data.children).toHaveLength(3);
      expect(detail.body.data.children[0]).toEqual({
        id: expect.any(String), shortCode: expect.any(String), status: 'ATIVA', discardAt: expect.any(String),
      });
      expect(detail.body.data.parent).toBeNull();
      const childDetail = await request(app).get(`/api/labels/${children[0].id}`).set('Authorization', asAdmin());
      expect(childDetail.body.data.parent).toEqual({ id: parent.id, shortCode: parent.shortCode });
      expect(childDetail.body.data.children).toEqual([]);

      // Origem com filhas não pode ser apagada.
      await expect(prisma.label.delete({ where: { id: parent.id } })).rejects.toThrow(/labels_parent_label_id_fkey/);
    });

    it('closes the parent as used when the package is finished, and a resend returns the same children', async () => {
      const parent = await newLabel();
      const requestId = randomUUID();
      const first = await split(parent.id, { count: 2, closeParent: true, requestId, responsibleName: ' Turno da Ana ' });
      expect(first.status).toBe(201);
      // Quem encerrou é o responsável do turno; a conta logada fica no id.
      expect(first.body.data.parent).toMatchObject({
        status: 'ENCERRADA', outcome: 'USADO', closedByName: 'Turno da Ana', closedById: userId,
      });
      const ids = first.body.data.children.map((child: { id: string }) => child.id).sort();

      const again = await split(parent.id, { count: 2, closeParent: true, requestId });
      expect(again.status).toBe(200);
      expect(again.body.data.children.map((child: { id: string }) => child.id).sort()).toEqual(ids);
      expect(again.body.data.parent.status).toBe('ENCERRADA');
      expect(await prisma.label.count({ where: { parentLabelId: parent.id } })).toBe(2);

      // Sem a chave do pedido, a origem encerrada não divide mais.
      expect((await split(parent.id, { count: 1 })).status).toBe(409);
    });

    it('does not duplicate children when the same request arrives twice at once', async () => {
      const parent = await newLabel();
      const requestId = randomUUID();
      const [a, b] = await Promise.all([
        split(parent.id, { count: 2, requestId }),
        split(parent.id, { count: 2, requestId }),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 201]);
      const idsOf = (res: { body: { data: { children: { id: string }[] } } }) =>
        res.body.data.children.map((child) => child.id).sort();
      expect(idsOf(a)).toEqual(idsOf(b));
      expect(await prisma.label.count({ where: { parentLabelId: parent.id } })).toBe(2);
    });

    it('filters the list by status, due date and parent', async () => {
      const parent = await newLabel();
      const children = (await split(parent.id, { count: 2 })).body.data.children as { id: string }[];
      const closed = await newLabel();
      await close(closed.id, { outcome: 'DESCARTADO', discardReason: 'EMBALAGEM_DANIFICADA' }).expect(200);
      const expired = await newLabel();
      await prisma.label.update({ where: { id: expired.id }, data: { discardAt: new Date(`${daysFromToday(-1)}T00:00:00Z`) } });
      const dueToday = await newLabel();
      await prisma.label.update({ where: { id: dueToday.id }, data: { discardAt: new Date(`${today()}T00:00:00Z`) } });
      const ids = (res: { body: { data: { id: string }[] } }) => res.body.data.map((label) => label.id);

      const byParent = await listLabels({ parentLabelId: parent.id });
      expect(byParent.status).toBe(200);
      expect(ids(byParent).sort()).toEqual(children.map((child) => child.id).sort());
      expect(byParent.body.data[0].parent).toEqual({ id: parent.id, shortCode: parent.shortCode });

      const closedList = ids(await listLabels({ productId, status: 'ENCERRADA' }));
      expect(closedList).toContain(closed.id);
      expect(closedList).not.toContain(parent.id);
      const activeResponse = await listLabels({ productId, status: 'ATIVA' });
      const countOf = (id: string) =>
        activeResponse.body.data.find((label: { id: string }) => label.id === id)?.childrenCount;
      expect(countOf(parent.id)).toBe(2);
      expect(countOf(children[0].id)).toBe(0);
      expect(activeResponse.body.data[0]._count).toBeUndefined();
      const activeList = ids(activeResponse);
      expect(activeList).toContain(parent.id);
      expect(activeList).not.toContain(closed.id);

      const expiredList = ids(await listLabels({ productId, status: 'ATIVA', due: 'expired' }));
      expect(expiredList).toContain(expired.id);
      expect(expiredList).not.toContain(dueToday.id);
      expect(expiredList).not.toContain(parent.id);
      const todayList = ids(await listLabels({ productId, status: 'ATIVA', due: 'today' }));
      expect(todayList).toEqual([dueToday.id]);
      const upcoming = ids(await listLabels({ productId, status: 'ATIVA', due: 'upcoming' }));
      expect(upcoming).toContain(parent.id);
      expect(upcoming).not.toContain(expired.id);
      expect(upcoming).not.toContain(dueToday.id);

      expect((await listLabels({ status: 'ABERTA' })).status).toBe(422);
      expect((await listLabels({ due: 'ontem' })).status).toBe(422);
      expect((await listLabels({ parentLabelId: 'nao-e-uuid' })).status).toBe(422);
    });
  });
});
