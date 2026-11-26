import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import app from '../src/app';
import { prisma } from '../src/prisma/client';
import { AuthService } from '../src/services/authService';
import { AdminBootstrapService } from '../src/services/adminBootstrapService';
import { resetMigrationCutoffsForTests } from '../src/services/labelService';
import { logger } from '../src/utils/logger';
import { addMonths, generateShortCode, kitchenToday } from '../src/utils/dateUtils';
import { DEFAULT_CATEGORIES, categoryKey } from '../src/domain/categories';

// Sorteio do código curto observável: o teste força um código que já existe (colisão).
vi.mock('../src/utils/dateUtils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/utils/dateUtils')>();
  return { ...actual, generateShortCode: vi.fn(actual.generateShortCode) };
});
const drawShortCode = vi.mocked(generateShortCode);
const realShortCode = async () =>
  (await vi.importActual<typeof import('../src/utils/dateUtils')>('../src/utils/dateUtils')).generateShortCode;

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
  // Uma execução interrompida pode ter deixado o bloqueio ou o limite do aviso ligados: começa sempre desligado.
  await prisma.kitchenSettings.updateMany({ data: { requireValidatedRule: false, expiryWarningMonths: null } });
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
  // Plano B: registros apontam para produto, regra e usuário (Restrict); apaga antes deles.
  if (productIds.length) await prisma.contingencyRecord.deleteMany({ where: { productId: { in: productIds } } });
  await prisma.connectivityOutage.deleteMany({ where: { reportedById: { in: [userId, operatorId].filter(Boolean) } } });
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

    // Prazo de 2 dias aberto há 2 dias (dentro do limite para trás): venceu ontem.
    const expired = await postLabel({ ...payload, openedAt: daysFromToday(-2) });
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

    it('draws another short code when the drawn one already exists, and the resend still replays', async () => {
      const send = (requestId?: string) => request(app).post('/api/labels')
        .set('Authorization', `Bearer ${accessToken}`).send({
          productId: productIds[0], lot: 'LOT-COLISAO', originalExpiryDate: daysFromToday(30), responsibleName: 'Colisão',
          storageType: 'REFRIGERADO', storageTemperature: 4, requestId,
        });
      const existing = await send();
      expect(existing.status).toBe(201);
      const taken = existing.body.data.shortCode as string;

      const requestId = randomUUID();
      drawShortCode.mockReturnValueOnce(taken).mockReturnValueOnce(taken);
      const created = await send(requestId);
      expect(created.status).toBe(201);
      expect(created.body.data.shortCode).not.toBe(taken);
      expect(drawShortCode.mock.results.slice(-3).map((result) => result.value)).toEqual([taken, taken, created.body.data.shortCode]);

      // Reenvio: o requestId repetido continua devolvendo a mesma etiqueta, mesmo sorteando um código que existe.
      drawShortCode.mockReturnValueOnce(taken);
      const again = await send(requestId);
      expect(again.status).toBe(200);
      expect(again.body.data.id).toBe(created.body.data.id);
      expect(await prisma.label.count({ where: { requestId } })).toBe(1);

      // Só repete código: desiste depois das tentativas, com erro claro, sem gravar nada.
      const before = await prisma.label.count({ where: { lot: 'LOT-COLISAO' } });
      drawShortCode.mockImplementation(() => taken);
      try {
        const failed = await send(randomUUID());
        expect(failed.status).toBe(503);
        expect(failed.body.error.code).toBe('SHORT_CODE_UNAVAILABLE');
      } finally {
        drawShortCode.mockImplementation(await realShortCode());
      }
      expect(await prisma.label.count({ where: { lot: 'LOT-COLISAO' } })).toBe(before);
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

    it('redoes the split transaction when a drawn short code already exists, and the resend still replays', async () => {
      const parent = await newLabel();
      const taken = parent.shortCode;
      const requestId = randomUUID();
      const fresh = (await realShortCode())();
      // Primeira transação: a 2ª filha sorteia o código da origem e a transação aborta. A segunda tentativa grava.
      drawShortCode.mockReturnValueOnce(fresh).mockReturnValueOnce(taken);
      const created = await split(parent.id, { count: 2, closeParent: true, requestId });
      expect(created.status).toBe(201);
      const codes = created.body.data.children.map((child: { shortCode: string }) => child.shortCode);
      expect(codes).toHaveLength(2);
      expect(codes).not.toContain(taken);
      expect(created.body.data.parent).toMatchObject({ status: 'ENCERRADA', outcome: 'USADO' });
      // Nada da tentativa abortada ficou no banco.
      expect(await prisma.label.count({ where: { parentLabelId: parent.id } })).toBe(2);
      expect(await prisma.label.count({ where: { shortCode: fresh } })).toBe(0);

      const again = await split(parent.id, { count: 2, closeParent: true, requestId });
      expect(again.status).toBe(200);
      expect(again.body.data.children.map((child: { id: string }) => child.id).sort())
        .toEqual(created.body.data.children.map((child: { id: string }) => child.id).sort());

      // Só repete código: desiste depois das tentativas, sem filhas nem encerrar a origem.
      const other = await newLabel();
      drawShortCode.mockImplementation(() => other.shortCode);
      try {
        const failed = await split(other.id, { count: 1, closeParent: true });
        expect(failed.status).toBe(503);
        expect(failed.body.error.code).toBe('SHORT_CODE_UNAVAILABLE');
      } finally {
        drawShortCode.mockImplementation(await realShortCode());
      }
      expect(await prisma.label.count({ where: { parentLabelId: other.id } })).toBe(0);
      expect((await prisma.label.findUniqueOrThrow({ where: { id: other.id } })).status).toBe('ATIVA');
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

describe('etapa G1: operador com PIN, limite de abertura, descarte do dia, CSV e saúde', () => {
  const asAdmin = () => `Bearer ${accessToken}`;
  let asOperator = '';
  let productId = '';
  let pinUserId = '';
  const pinUserName = `Operadora PIN ${suffix.slice(0, 6)}`;

  const loginAs = async (userEmail: string) => {
    const res = await request(app).post('/api/auth/login').send({ email: userEmail, password: 'TestPassword123!' }).expect(200);
    return `Bearer ${res.body.data.accessToken as string}`;
  };
  const setPin = (id: string, pin: unknown, token = asAdmin()) =>
    request(app).patch(`/api/users/${id}/pin`).set('Authorization', token).send({ pin });
  const verify = (body: object, token = asAdmin(), ip = '198.51.100.1') =>
    request(app).post('/api/totem/operators/verify').set('Authorization', token).set('X-Forwarded-For', ip).send(body);
  const labelBody = (body: object = {}) => ({
    productId, lot: 'LOT-G1', originalExpiryDate: daysFromToday(60), openedAt: today(),
    responsibleName: 'Nome digitado', storageType: 'REFRIGERADO', storageTemperature: 4, ...body,
  });
  const postLabel = (body: object = {}, token = asAdmin()) =>
    request(app).post('/api/labels').set('Authorization', token).send(labelBody(body));
  const newLabel = async (body: object = {}) => {
    const res = await postLabel(body);
    expect(res.status).toBe(201);
    return res.body.data as { id: string; shortCode: string };
  };

  beforeAll(async () => {
    asOperator = await loginAs(operatorEmail);
    // Prazos fictícios, só para o teste.
    const product = await request(app).post('/api/products').set('Authorization', asAdmin()).send({
      name: `Produto G1 ${suffix.slice(0, 8)}`, brand: 'Teste', daysValidRefrigerated: 5, daysValidFrozen: 30,
    });
    productId = product.body.data.id;
    productIds.push(productId);
    const created = await request(app).post('/api/users').set('Authorization', asAdmin()).send({
      name: pinUserName, email: `api-pin-${suffix}@example.test`, password: 'TestPassword123!', role: 'OPERATOR',
    }).expect(201);
    pinUserId = created.body.data.id;
    createdUserIds.push(pinUserId);
  });

  describe('PIN do operador', () => {
    it('only lets an admin set or remove a PIN and never exposes its hash', async () => {
      expect((await setPin(pinUserId, '1234', asOperator)).status).toBe(403);
      expect((await setPin(pinUserId, '12a4')).status).toBe(422);
      expect((await setPin(pinUserId, '123')).status).toBe(422);
      expect((await setPin(pinUserId, '1234567')).status).toBe(422);
      expect((await setPin(randomUUID(), '1234')).status).toBe(404);

      const set = await setPin(pinUserId, '4321');
      expect(set.status).toBe(200);
      expect(set.body.data).toMatchObject({ id: pinUserId, hasPin: true });
      expect(set.body.data.pinHash).toBeUndefined();

      const list = await request(app).get('/api/users').set('Authorization', asAdmin()).expect(200);
      expect(list.body.data.find((user: { id: string }) => user.id === pinUserId).hasPin).toBe(true);
      expect(list.body.data.find((user: { id: string }) => user.id === userId).hasPin).toBe(false);
      expect(JSON.stringify(list.body)).not.toContain('pinHash');

      const operators = await request(app).get('/api/totem/operators').set('Authorization', asOperator).expect(200);
      expect(operators.body.data).toContainEqual({ id: pinUserId, name: pinUserName });
      expect(operators.body.data.some((user: { id: string }) => user.id === userId)).toBe(false);

      const removed = await setPin(pinUserId, null);
      expect(removed.body.data.hasPin).toBe(false);
      const after = await request(app).get('/api/totem/operators').set('Authorization', asOperator).expect(200);
      expect(after.body.data.some((user: { id: string }) => user.id === pinUserId)).toBe(false);
      await setPin(pinUserId, '4321').expect(200);
    });

    it('verifies the PIN with the same answer for a wrong PIN and a user without PIN', async () => {
      const ok = await verify({ userId: pinUserId, pin: '4321' }, asOperator);
      expect(ok.status).toBe(200);
      expect(ok.body.data.operator).toEqual({ id: pinUserId, name: pinUserName });
      expect(typeof ok.body.data.handlerToken).toBe('string');
      const ttl = new Date(ok.body.data.expiresAt).getTime() - Date.now();
      expect(ttl).toBeGreaterThan(9.9 * 3_600_000);
      expect(ttl).toBeLessThanOrEqual(10 * 3_600_000);

      const wrong = await verify({ userId: pinUserId, pin: '0000' }, asOperator, '198.51.100.2');
      expect(wrong.status).toBe(401);
      expect(wrong.body.error).toEqual({ message: 'PIN incorreto.', code: 'INVALID_PIN' });
      const noPin = await verify({ userId, pin: '0000' }, asOperator, '198.51.100.2');
      expect(noPin.status).toBe(401);
      expect(noPin.body.error).toEqual(wrong.body.error);

      expect((await request(app).post('/api/totem/operators/verify').send({ userId: pinUserId, pin: '4321' })).status).toBe(401);
    });

    it('blocks the sixth failed PIN for the same device and operator', async () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        expect((await verify({ userId: pinUserId, pin: '9999' }, asOperator, '198.51.100.3')).status).toBe(401);
      }
      const blocked = await verify({ userId: pinUserId, pin: '4321' }, asOperator, '198.51.100.3');
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe('RATE_LIMITED');
      // Outro aparelho não fica bloqueado.
      expect((await verify({ userId: pinUserId, pin: '4321' }, asOperator, '198.51.100.4')).status).toBe(200);
    }, 30_000);

    it('records the confirmed operator on labels, children and closing', async () => {
      const { handlerToken } = (await verify({ userId: pinUserId, pin: '4321' }, asOperator, '198.51.100.5')).body.data;

      const created = await postLabel({ handlerToken, responsibleName: 'Ignorado' }, asOperator);
      expect(created.status).toBe(201);
      expect(created.body.data).toMatchObject({ handlerId: pinUserId, responsibleName: pinUserName, handlerVerified: true });
      // Com operador confirmado, o nome digitado não é obrigatório.
      const withoutName = await postLabel({ handlerToken, responsibleName: undefined }, asOperator);
      expect(withoutName.status).toBe(201);
      expect(withoutName.body.data.responsibleName).toBe(pinUserName);
      expect((await postLabel({ responsibleName: undefined }, asOperator)).status).toBe(422);

      const typed = await postLabel({}, asOperator);
      expect(typed.body.data).toMatchObject({ handlerId: null, responsibleName: 'Nome digitado', handlerVerified: false });

      const split = await request(app).post(`/api/labels/${created.body.data.id}/split`).set('Authorization', asOperator)
        .send({ count: 1, storageType: 'REFRIGERADO', storageTemperature: 4, handlerToken, closeParent: true });
      expect(split.status).toBe(201);
      expect(split.body.data.children[0]).toMatchObject({ handlerId: pinUserId, responsibleName: pinUserName, handlerVerified: true });
      expect(split.body.data.parent.closedByName).toBe(pinUserName);

      const closed = await request(app).post(`/api/labels/${typed.body.data.id}/close`).set('Authorization', asOperator)
        .send({ outcome: 'USADO', handlerToken, responsibleName: 'Ignorado' });
      expect(closed.status).toBe(200);
      expect(closed.body.data.closedByName).toBe(pinUserName);
      expect(closed.body.data.closedById).toBe(operatorId);
    });

    it('closes with the typed shift name, or with the logged account without one', async () => {
      const typed = await newLabel();
      const closed = await request(app).post(`/api/labels/${typed.id}/close`).set('Authorization', asOperator)
        .send({ outcome: 'DESCARTADO', discardReason: 'PRAZO_VENCIDO', responsibleName: '  Maria do turno ' });
      expect(closed.status).toBe(200);
      expect(closed.body.data).toMatchObject({ closedByName: 'Maria do turno', closedById: operatorId });

      const plain = await newLabel();
      const closedPlain = await request(app).post(`/api/labels/${plain.id}/close`).set('Authorization', asOperator)
        .send({ outcome: 'USADO' });
      expect(closedPlain.body.data.closedByName).toBe('Operador de integração');
      const tooLong = await newLabel();
      expect((await request(app).post(`/api/labels/${tooLong.id}/close`).set('Authorization', asOperator)
        .send({ outcome: 'USADO', responsibleName: 'x'.repeat(101) })).status).toBe(422);
    });

    it('rejects a handler token from another session, a forged one, a changed PIN and a deactivated user', async () => {
      const { handlerToken } = (await verify({ userId: pinUserId, pin: '4321' }, asOperator, '198.51.100.6')).body.data;
      const otherSession = await loginAs(operatorEmail);
      const fromOther = await postLabel({ handlerToken }, otherSession);
      expect(fromOther.status).toBe(401);
      expect(fromOther.body.error).toEqual({ message: 'Confirme o operador do turno novamente.', code: 'HANDLER_INVALID' });
      // O token de acesso não serve como token de operador.
      expect((await postLabel({ handlerToken: accessToken }, asAdmin())).body.error.code).toBe('HANDLER_INVALID');
      expect((await postLabel({ handlerToken: 'nao-e-um-token' }, asOperator)).body.error.code).toBe('HANDLER_INVALID');

      // Trocar o PIN invalida o token emitido com o anterior.
      await setPin(pinUserId, '5678').expect(200);
      expect((await postLabel({ handlerToken }, asOperator)).body.error.code).toBe('HANDLER_INVALID');
      const fresh = (await verify({ userId: pinUserId, pin: '5678' }, asOperator, '198.51.100.6')).body.data.handlerToken;
      expect((await postLabel({ handlerToken: fresh }, asOperator)).status).toBe(201);

      await request(app).put(`/api/users/${pinUserId}`).set('Authorization', asAdmin()).send({ active: false }).expect(200);
      const deactivated = await postLabel({ handlerToken: fresh }, asOperator);
      expect(deactivated.status).toBe(401);
      expect(deactivated.body.error.code).toBe('HANDLER_INVALID');
      expect((await verify({ userId: pinUserId, pin: '5678' }, asOperator, '198.51.100.6')).status).toBe(401);
      const operators = await request(app).get('/api/totem/operators').set('Authorization', asOperator).expect(200);
      expect(operators.body.data.some((user: { id: string }) => user.id === pinUserId)).toBe(false);
      await request(app).put(`/api/users/${pinUserId}`).set('Authorization', asAdmin()).send({ active: true }).expect(200);
    });
    it('returns the label and children already created for a resend even after the handler token became invalid', async () => {
      const { handlerToken } = (await verify({ userId: pinUserId, pin: '5678' }, asOperator, '198.51.100.7')).body.data;
      const requestId = randomUUID();
      const created = await postLabel({ handlerToken, requestId }, asOperator);
      expect(created.status).toBe(201);
      const splitRequestId = randomUUID();
      const splitBody = { count: 2, storageType: 'REFRIGERADO', storageTemperature: 4, handlerToken, requestId: splitRequestId };
      const splitLabel = (body: object) => request(app).post(`/api/labels/${created.body.data.id}/split`)
        .set('Authorization', asOperator).send(body);
      const split = await splitLabel(splitBody);
      expect(split.status).toBe(201);

      // PIN trocado: o token antigo deixa de valer, mas o reenvio do mesmo pedido devolve o que já existe.
      await setPin(pinUserId, '2468').expect(200);
      const resent = await postLabel({ handlerToken, requestId }, asOperator);
      expect(resent.status).toBe(200);
      expect(resent.body.data).toMatchObject({ id: created.body.data.id, handlerId: pinUserId });
      const resplit = await splitLabel(splitBody);
      expect(resplit.status).toBe(200);
      const ids = (res: { body: { data: { children: { id: string }[] } } }) => res.body.data.children.map((child) => child.id).sort();
      expect(ids(resplit)).toEqual(ids(split));

      // Pedido novo com o token antigo continua recusado.
      const fresh = await postLabel({ handlerToken, requestId: randomUUID() }, asOperator);
      expect(fresh.status).toBe(401);
      expect(fresh.body.error.code).toBe('HANDLER_INVALID');
      const freshSplit = await splitLabel({ ...splitBody, requestId: randomUUID() });
      expect(freshSplit.status).toBe(401);
      expect(freshSplit.body.error.code).toBe('HANDLER_INVALID');
    });
  });

  describe('limite da data de abertura', () => {
    it('reports the kitchen date and the backdate limit in /auth/me', async () => {
      const me = await request(app).get('/api/auth/me').set('Authorization', asOperator).expect(200);
      expect(me.body.data.sub).toBe(operatorId);
      expect(me.body.meta).toEqual({
        kitchenToday: today(), maxBackdateDays: 2, requireValidatedRule: false, labelTemplate: null,
      });
    });

    it('accepts an opening 2 days ago and rejects 3 days ago and the future', async () => {
      expect((await postLabel({ openedAt: daysFromToday(-2) })).status).toBe(201);
      const preview = await request(app).post('/api/labels/preview').set('Authorization', asAdmin()).send({
        productId, originalExpiryDate: daysFromToday(60), openedAt: daysFromToday(-2), storageType: 'REFRIGERADO',
      });
      expect(preview.status).toBe(200);

      const [y, m, d] = daysFromToday(-2).split('-');
      const tooOld = await postLabel({ openedAt: daysFromToday(-3) });
      expect(tooOld.status).toBe(422);
      expect(tooOld.body.error.message).toBe(`A data de abertura não pode ser anterior a ${d}/${m}/${y}.`);
      const tooOldPreview = await request(app).post('/api/labels/preview').set('Authorization', asAdmin()).send({
        productId, originalExpiryDate: daysFromToday(60), openedAt: daysFromToday(-3), storageType: 'REFRIGERADO',
      });
      expect(tooOldPreview.status).toBe(422);
      expect((await postLabel({ openedAt: daysFromToday(1) })).status).toBe(422);
    });

    it('does not apply the limit when splitting an older label', async () => {
      const parent = await newLabel();
      await prisma.label.update({ where: { id: parent.id }, data: { openedAt: new Date(`${daysFromToday(-5)}T00:00:00Z`) } });
      const split = await request(app).post(`/api/labels/${parent.id}/split`).set('Authorization', asAdmin())
        .send({ count: 1, storageType: 'REFRIGERADO', storageTemperature: 4, responsibleName: 'Fracionador' });
      expect(split.status).toBe(201);
      expect(split.body.data.children[0].openedAt.slice(0, 10)).toBe(daysFromToday(-5));
    });
  });

  describe('descarte do dia', () => {
    it('groups active labels by the kitchen date, not the UTC date', async () => {
      const kitchenDay = today();
      const setDiscard = (id: string, date: string) =>
        prisma.label.update({ where: { id }, data: { discardAt: new Date(`${date}T00:00:00Z`) } });
      const expired = await newLabel();
      await setDiscard(expired.id, daysFromToday(-1));
      const dueToday = await newLabel();
      await setDiscard(dueToday.id, kitchenDay);
      const tomorrow = await newLabel();
      await setDiscard(tomorrow.id, daysFromToday(1));
      const later = await newLabel();
      await setDiscard(later.id, daysFromToday(2));
      const closedToday = await newLabel();
      await setDiscard(closedToday.id, kitchenDay);
      await request(app).post(`/api/labels/${closedToday.id}/close`).set('Authorization', asAdmin()).send({ outcome: 'USADO' }).expect(200);

      // 23:30 em Manaus (UTC−4) já é o dia seguinte em UTC: o "hoje" tem de seguir a cozinha.
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        vi.setSystemTime(new Date(`${daysFromToday(1)}T03:30:00Z`));
        expect(new Date().toISOString().slice(0, 10)).not.toBe(kitchenDay);
        const token = await loginAs(operatorEmail);
        const due = await request(app).get('/api/labels/due').set('Authorization', token);
        expect(due.status).toBe(200);
        expect(due.body.meta.kitchenToday).toBe(kitchenDay);
        const ids = (group: 'expired' | 'today' | 'tomorrow') => due.body.data[group].map((label: { id: string }) => label.id);
        expect(ids('expired')).toContain(expired.id);
        expect(ids('today')).toContain(dueToday.id);
        expect(ids('today')).not.toContain(tomorrow.id);
        expect(ids('tomorrow')).toContain(tomorrow.id);
        for (const group of ['expired', 'today', 'tomorrow'] as const) {
          expect(ids(group)).not.toContain(later.id);
          expect(ids(group)).not.toContain(closedToday.id);
          expect(due.body.meta.counts[group]).toBeGreaterThanOrEqual(ids(group).length);
          const dates = due.body.data[group].map((label: { discardAt: string }) => label.discardAt);
          expect(dates).toEqual([...dates].sort());
        }
        expect(due.body.data.today.find((label: { id: string }) => label.id === dueToday.id))
          .toMatchObject({ status: 'ATIVA', handlerVerified: false, childrenCount: 0 });
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('exportação CSV', () => {
    const exportCsv = (query: Record<string, string>, token = asAdmin()) =>
      request(app).get('/api/labels/export.csv').query(query).set('Authorization', token)
        .buffer(true).parse((res, callback) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => callback(null, Buffer.concat(chunks)));
        });
    const rowsOf = (body: Buffer) => body.toString('utf8').replace(/^﻿/, '').split('\r\n').filter(Boolean);

    it('is only for admins', async () => {
      const res = await request(app).get('/api/labels/export.csv').set('Authorization', asOperator);
      expect(res.status).toBe(403);
    });

    it('exports a spreadsheet with BOM, semicolons, Brazilian dates and formula protection', async () => {
      const formula = await newLabel({ lot: '=1+1', responsibleName: 'Ana "Chefe"' });
      const frozen = await newLabel({ storageType: 'CONGELADO', storageTemperature: -18 });
      await request(app).post(`/api/labels/${formula.id}/close`).set('Authorization', asAdmin())
        .send({ outcome: 'DESCARTADO', discardReason: 'OUTRO', note: '@nota' }).expect(200);

      const res = await exportCsv({ productId });
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(res.headers['content-disposition']).toBe(`attachment; filename="etiquetas-${today()}.csv"`);
      const body = res.body as Buffer;
      expect([...body.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);

      const rows = rowsOf(body);
      expect(rows[0].split(';')).toHaveLength(25);
      expect(rows[0]).toContain('"Código";"Produto";"Marca";"Lote";"Lote cadastrado";"Validade do fabricante"');
      const row = rows.find((line) => line.startsWith(`"${formula.shortCode}"`))!;
      expect(row).toBeTruthy();
      expect(row).toContain(`"'=1+1"`);
      expect(row).toContain('"Ana ""Chefe"""');
      expect(row).toContain(`"'@nota"`);
      expect(row).toContain('"Encerrada";"Descartado";"Outro"');
      expect(row).toContain('"sem regra validada"');
      const [y, m, d] = today().split('-');
      expect(row).toContain(`"${d}/${m}/${y}"`);
      expect(row).toContain('"não"');
      // Temperatura negativa com o sinal de menos U+2212: sem apóstrofo e sem virar fórmula.
      const frozenRow = rows.find((line) => line.startsWith(`"${frozen.shortCode}"`))!;
      expect(frozenRow).toContain('"Congelado";"−18,0 °C"');
      expect(frozenRow).not.toContain("'-18");
      expect(frozenRow).not.toContain('"-18');
    });

    it('applies the list filters and the creation period', async () => {
      const active = await newLabel();
      const all = rowsOf((await exportCsv({ productId })).body);
      const closed = rowsOf((await exportCsv({ productId, status: 'ENCERRADA' })).body);
      expect(all.some((line) => line.startsWith(`"${active.shortCode}"`))).toBe(true);
      expect(closed.some((line) => line.startsWith(`"${active.shortCode}"`))).toBe(false);
      expect(closed.length).toBeLessThan(all.length);
      expect(rowsOf((await exportCsv({ productId, q: active.shortCode })).body)).toHaveLength(2);

      expect(rowsOf((await exportCsv({ productId, from: today(), to: today() })).body).length).toBe(all.length);
      expect(rowsOf((await exportCsv({ productId, from: daysFromToday(1) })).body)).toHaveLength(1);
      expect(rowsOf((await exportCsv({ productId, to: daysFromToday(-1) })).body)).toHaveLength(1);
      expect((await exportCsv({ from: today(), to: daysFromToday(-1) })).status).toBe(422);
      expect((await exportCsv({ due: 'ontem' })).status).toBe(422);
    });

    it('filters by lot source (registered lot or "Outra embalagem") in the list and the export', async () => {
      const lot = await request(app).post(`/api/products/${productId}/lots`).set('Authorization', asAdmin())
        .send({ code: `LOTE-CAD-${suffix.slice(0, 6)}`, expiryDate: daysFromToday(60) }).expect(201);
      const registered = await newLabel({ lot: undefined, originalExpiryDate: undefined, lotId: lot.body.data.id });
      const typed = await newLabel();
      // Etiqueta de antes da migração dos lotes: lot_id nulo e criada antes do fim da migração.
      const [migration] = await prisma.$queryRaw<{ finished_at: Date }[]>`
        SELECT finished_at FROM _prisma_migrations WHERE migration_name = '20261103000000_product_lots'`;
      expect(migration?.finished_at).toBeTruthy();
      const legacy = await newLabel();
      await prisma.label.update({
        where: { id: legacy.id }, data: { createdAt: new Date(migration.finished_at.getTime() - 86_400_000) },
      });
      // A filha do Dividir nasce depois do corte, mas herda a embalagem da origem anterior.
      const split = await request(app).post(`/api/labels/${legacy.id}/split`).set('Authorization', asAdmin())
        .send({ count: 1, storageType: 'REFRIGERADO', storageTemperature: 4, responsibleName: 'Fracionador' });
      expect(split.status).toBe(201);
      const legacyChild = split.body.data.children[0] as { id: string; shortCode: string };
      const legacyIds = [legacy.id, legacyChild.id];

      const list = (query: Record<string, string>) =>
        request(app).get('/api/labels').query({ productId, limit: '100', ...query }).set('Authorization', asAdmin());
      const idsOf = (res: { body: { data: { id: string }[] } }) => res.body.data.map((label: { id: string }) => label.id) as string[];

      const all = await list({});
      expect(all.status).toBe(200);
      const byId = (id: string) => all.body.data.find((label: { id: string }) => label.id === id);
      expect(byId(registered.id).lotId).toBe(lot.body.data.id);
      expect(byId(typed.id).lotId).toBeNull();
      expect(byId(registered.id).lotSource).toBe('cadastrado');
      expect(byId(typed.id).lotSource).toBe('informado');
      expect(byId(legacy.id)).toMatchObject({ lotId: null, lotSource: 'anterior' });
      expect(byId(legacyChild.id)).toMatchObject({ lotId: null, lotSource: 'anterior', parentLabelId: legacy.id });

      const cadastrado = await list({ lotSource: 'cadastrado' });
      const informado = await list({ lotSource: 'informado' });
      const anterior = await list({ lotSource: 'anterior' });
      expect(cadastrado.status).toBe(200);
      expect(informado.status).toBe(200);
      expect(anterior.status).toBe(200);
      expect(idsOf(cadastrado)).toContain(registered.id);
      expect(idsOf(cadastrado)).not.toContain(typed.id);
      expect(idsOf(informado)).toContain(typed.id);
      expect(idsOf(informado)).not.toContain(registered.id);
      expect(idsOf(anterior).sort()).toEqual([...legacyIds].sort());
      for (const id of legacyIds) {
        expect(idsOf(informado)).not.toContain(id);
        expect(idsOf(cadastrado)).not.toContain(id);
      }
      const sourcesOf = (res: { body: { data: { lotSource: string }[] } }) => new Set(res.body.data.map((l) => l.lotSource));
      expect([...sourcesOf(cadastrado)]).toEqual(['cadastrado']);
      expect([...sourcesOf(informado)]).toEqual(['informado']);
      expect([...sourcesOf(anterior)]).toEqual(['anterior']);
      // Sem o filtro, nada muda: os três grupos somam a lista inteira.
      expect(cadastrado.body.meta.total + informado.body.meta.total + anterior.body.meta.total)
        .toBe(all.body.meta.total);
      expect((await list({ lotSource: 'outro' })).status).toBe(422);
      expect((await list({ lotSource: 'Cadastrado' })).status).toBe(422);

      const csvAll = rowsOf((await exportCsv({ productId })).body);
      const csvCad = rowsOf((await exportCsv({ productId, lotSource: 'cadastrado' })).body);
      const csvInf = rowsOf((await exportCsv({ productId, lotSource: 'informado' })).body);
      const rowOf = (rows: string[], code: string) => rows.find((line) => line.startsWith(`"${code}"`));
      // Coluna "Lote cadastrado" (5ª), logo depois de "Lote".
      expect(rowOf(csvAll, registered.shortCode)!.split(';')[4]).toBe('"Sim"');
      expect(rowOf(csvAll, typed.shortCode)!.split(';')[4]).toBe('"Não"');
      expect(rowOf(csvAll, legacyChild.shortCode)!.split(';')[4]).toBe('"Anterior aos lotes"');
      // A origem anterior tem criação antes do corte: some do período de hoje, mas sai sem período.
      const csvAnt = rowsOf((await exportCsv({ lotSource: 'anterior', q: legacy.shortCode })).body);
      expect(csvAnt).toHaveLength(2);
      expect(csvAnt[1].split(';')[4]).toBe('"Anterior aos lotes"');
      expect(rowOf(rowsOf((await exportCsv({ productId, lotSource: 'informado' })).body), legacyChild.shortCode))
        .toBeUndefined();
      expect(rowOf(csvCad, registered.shortCode)).toBeTruthy();
      expect(rowOf(csvCad, typed.shortCode)).toBeUndefined();
      expect(rowOf(csvInf, typed.shortCode)).toBeTruthy();
      expect(rowOf(csvInf, registered.shortCode)).toBeUndefined();
      expect(csvCad.slice(1).every((line) => line.split(';')[4] === '"Sim"')).toBe(true);
      expect(csvInf.slice(1).every((line) => line.split(';')[4] === '"Não"')).toBe(true);
      const csvAntAll = rowsOf((await exportCsv({ productId, lotSource: 'anterior' })).body);
      expect(csvCad.length - 1 + csvInf.length - 1 + csvAntAll.length - 1).toBe(csvAll.length - 1);
      expect((await exportCsv({ lotSource: 'qualquer' })).status).toBe(422);
    });
  });

  describe('saúde', () => {
    it('answers ok when the database responds and 503 without details when it does not', async () => {
      const ok = await request(app).get('/health');
      expect(ok.status).toBe(200);
      expect(ok.body).toEqual({ status: 'ok', db: 'ok' });

      const outage = vi.spyOn(prisma, '$queryRaw').mockRejectedValueOnce(new Error('conexão recusada'));
      try {
        const down = await request(app).get('/health');
        expect(down.status).toBe(503);
        expect(down.body).toEqual({ status: 'error', db: 'error' });
      } finally {
        outage.mockRestore();
      }
    });

    it('no longer serves /uploads', async () => {
      expect((await request(app).get('/uploads/qualquer.png')).status).toBe(404);
    });
  });
});

describe('etapa G2a: e-mail sem diferenciar maiúsculas, admin no boot e mensagens do zod 4', () => {
  const asAdmin = () => `Bearer ${accessToken}`;

  describe('e-mail', () => {
    it('stores the e-mail in lowercase and logs in with any case', async () => {
      const mixed = `  Api-Caixa-${suffix}@Example.TEST `;
      const lower = mixed.trim().toLowerCase();
      const created = await request(app).post('/api/users').set('Authorization', asAdmin()).send({
        name: 'Operador caixa', email: mixed, password: 'TestPassword123!', role: 'OPERATOR',
      });
      expect(created.status).toBe(201);
      createdUserIds.push(created.body.data.id);
      expect(created.body.data.email).toBe(lower);

      const login = await request(app).post('/api/auth/login').set('X-Forwarded-For', '198.51.100.20')
        .send({ email: lower.toUpperCase(), password: 'TestPassword123!' });
      expect(login.status).toBe(200);
      expect(login.body.data.user.email).toBe(lower);

      const duplicate = await request(app).post('/api/users').set('Authorization', asAdmin()).send({
        name: 'Duplicado só na caixa', email: lower.toUpperCase(), password: 'TestPassword123!', role: 'OPERATOR',
      });
      expect(duplicate.status).toBe(409);
      expect(duplicate.body.error.code).toBe('CONFLICT');
    });

    it('rejects an update to an e-mail that only differs by case and normalizes updates', async () => {
      const first = `api-upd-a-${suffix}@example.test`;
      const second = `api-upd-b-${suffix}@example.test`;
      const ids: string[] = [];
      for (const userEmail of [first, second]) {
        const res = await request(app).post('/api/users').set('Authorization', asAdmin()).send({
          name: 'Operador atualização', email: userEmail, password: 'TestPassword123!', role: 'OPERATOR',
        }).expect(201);
        ids.push(res.body.data.id);
        createdUserIds.push(res.body.data.id);
      }
      const clash = await request(app).put(`/api/users/${ids[1]}`).set('Authorization', asAdmin())
        .send({ email: first.toUpperCase() });
      expect(clash.status).toBe(409);

      const renamed = `API-UPD-C-${suffix}@Example.test`;
      const ok = await request(app).put(`/api/users/${ids[1]}`).set('Authorization', asAdmin()).send({ email: renamed });
      expect(ok.status).toBe(200);
      expect(ok.body.data.email).toBe(renamed.toLowerCase());
    });

    it('verifies the admin with the e-mail in another case', async () => {
      const res = await request(app).post('/api/auth/verify-admin').set('Authorization', asAdmin())
        .set('X-Forwarded-For', '198.51.100.21').send({ email: email.toUpperCase(), password: 'TestPassword123!' });
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ valid: true });
    });
  });

  describe('admin no boot', () => {
    const bootEmail = `api-boot-${suffix}@example.test`;
    const password = 'SenhaDoBoot123!';
    const env = (extra: Record<string, string> = {}) => ({
      ADMIN_EMAIL: ` ${bootEmail.toUpperCase()} `, ADMIN_PASSWORD: password, ...extra,
    });
    const bootUser = () => prisma.user.findUniqueOrThrow({ where: { email: bootEmail } });

    afterAll(async () => {
      await prisma.user.deleteMany({ where: { email: bootEmail } });
    });

    it('does nothing without both variables and rejects a short password when creating', async () => {
      expect(await AdminBootstrapService.ensure({ ADMIN_EMAIL: bootEmail })).toBe('skipped');
      await expect(AdminBootstrapService.ensure({ ADMIN_EMAIL: bootEmail, ADMIN_PASSWORD: 'curta' }))
        .rejects.toThrow('12 caracteres');
      expect(await prisma.user.findUnique({ where: { email: bootEmail } })).toBeNull();
    });

    it('only creates the admin when missing and never changes it without ADMIN_SYNC_ON_BOOT', async () => {
      expect(await AdminBootstrapService.ensure(env())).toBe('created');
      const created = await bootUser();
      expect(created.role).toBe('ADMIN');

      // Conta desativada e rebaixada pelo painel: o boot não desfaz.
      await prisma.user.update({ where: { id: created.id }, data: { active: false, role: 'OPERATOR' } });
      expect(await AdminBootstrapService.ensure(env({ ADMIN_PASSWORD: 'OutraSenhaQualquer1!' }))).toBe('kept');
      expect(await AdminBootstrapService.ensure(env({ ADMIN_SYNC_ON_BOOT: 'false' }))).toBe('kept');
      const kept = await bootUser();
      expect(kept.active).toBe(false);
      expect(kept.role).toBe('OPERATOR');
      expect(kept.passwordHash).toBe(created.passwordHash);

      // Senha curta com a conta já existente e sem sync: sobe com aviso, sem alterar nada.
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
      try {
        expect(await AdminBootstrapService.ensure(env({ ADMIN_PASSWORD: 'curta' }))).toBe('kept');
        expect(warn.mock.calls.some(([message]) => String(message).includes('12 caracteres'))).toBe(true);
      } finally {
        warn.mockRestore();
      }
      expect((await bootUser()).passwordHash).toBe(created.passwordHash);
      // Com sync, a senha curta continua derrubando o boot.
      await expect(AdminBootstrapService.ensure(env({ ADMIN_PASSWORD: 'curta', ADMIN_SYNC_ON_BOOT: 'true' })))
        .rejects.toThrow('12 caracteres');
      expect((await bootUser()).active).toBe(false);
    });

    it('re-syncs password, role and active flag with ADMIN_SYNC_ON_BOOT=true', async () => {
      const newPassword = 'SenhaNovaDoBoot456!';
      const sync = env({ ADMIN_PASSWORD: newPassword, ADMIN_SYNC_ON_BOOT: 'true' });
      expect(await AdminBootstrapService.ensure(sync)).toBe('synced');
      const synced = await bootUser();
      expect(synced.active).toBe(true);
      expect(synced.role).toBe('ADMIN');
      const login = await request(app).post('/api/auth/login').set('X-Forwarded-For', '198.51.100.22')
        .send({ email: bootEmail, password: newPassword });
      expect(login.status).toBe(200);

      expect(await AdminBootstrapService.ensure(sync)).toBe('in_sync');
      // Sem mudança, a sessão continua valendo.
      const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${login.body.data.accessToken}`);
      expect(me.status).toBe(200);
    });
  });

  describe('mensagens de validação', () => {
    let productId = '';

    beforeAll(async () => {
      // Prazos fictícios, só para o teste.
      const product = await request(app).post('/api/products').set('Authorization', asAdmin()).send({
        name: `Produto G2a ${suffix.slice(0, 8)}`, brand: 'Teste', daysValidRefrigerated: 3, daysValidFrozen: 30,
      }).expect(201);
      productId = product.body.data.id;
      productIds.push(productId);
    });

    it('keeps the custom Portuguese messages after the zod 4 migration', async () => {
      const base = {
        productId, lot: 'LOT-G2A', originalExpiryDate: daysFromToday(30), responsibleName: 'Teste',
        storageType: 'REFRIGERADO',
      };
      const missing = await request(app).post('/api/labels').set('Authorization', asAdmin()).send(base);
      expect(missing.status).toBe(422);
      expect(missing.body.error.message).toBe('Informe a temperatura medida em °C.');

      const wrongType = await request(app).post('/api/labels').set('Authorization', asAdmin())
        .send({ ...base, storageTemperature: '4' });
      expect(wrongType.body.error.message).toBe('Informe a temperatura em número (°C).');

      const label = await request(app).post('/api/labels').set('Authorization', asAdmin())
        .send({ ...base, storageTemperature: 4 }).expect(201);
      const labelId = label.body.data.id as string;

      const close = await request(app).post(`/api/labels/${labelId}/close`).set('Authorization', asAdmin())
        .send({ outcome: 'PERDIDO' });
      expect(close.status).toBe(422);
      expect(close.body.error.message).toBe('Escolha o destino da etiqueta.');

      const reason = await request(app).post(`/api/labels/${labelId}/close`).set('Authorization', asAdmin())
        .send({ outcome: 'DESCARTADO', discardReason: 'NAO_SEI' });
      expect(reason.body.error.message).toBe('Motivo do descarte inválido.');

      const split = (body: object) => request(app).post(`/api/labels/${labelId}/split`).set('Authorization', asAdmin())
        .send({ storageType: 'REFRIGERADO', storageTemperature: 4, responsibleName: 'Teste', ...body });
      expect((await split({})).body.error.message).toBe('Informe a quantidade de etiquetas.');
      expect((await split({ count: 'dois' })).body.error.message).toBe('Quantidade inválida.');

      const pin = await request(app).patch(`/api/users/${operatorId}/pin`).set('Authorization', asAdmin()).send({ pin: 1234 });
      expect(pin.status).toBe(422);
      expect(pin.body.error.message).toBe('O PIN deve ter de 4 a 6 dígitos.');

      const rule = await request(app).post('/api/shelf-life-rules').set('Authorization', asAdmin()).send({
        ...ruleBody, productId, storageType: 'CONGELADO', shelfLifeDays: 10, minTemperature: 'frio',
      });
      expect(rule.status).toBe(422);
      expect(rule.body.error.message).toBe('Informe a temperatura em número (°C).');
    });
  });
});

describe('produtos sem regra validada', () => {
  const tag = suffix.slice(0, 8);
  const category = `Sem regra ${tag}`;
  let adminToken = '';
  const ids: Record<string, string> = {};
  const asAdmin = () => `Bearer ${adminToken}`;
  const withoutRule = (token = asAdmin()) =>
    request(app).get('/api/products/without-rule').set('Authorization', token);
  const createProduct = async (key: string, data: { category?: string; daysValidRefrigerated: number; daysValidFrozen: number }) => {
    const product = await prisma.product.create({ data: { name: `Sem regra ${tag} ${key}`, brand: 'Teste', ...data } });
    productIds.push(product.id);
    ids[key] = product.id;
  };
  const createRule = async (body: object) => {
    const res = await request(app).post('/api/shelf-life-rules').set('Authorization', asAdmin())
      .send({ ...ruleBody, shelfLifeDays: 5, ...body });
    expect(res.status).toBe(201);
    ruleIds.push(res.body.data.id);
    return res.body.data.id as string;
  };
  type Entry = { id: string; missing: { storageType: string; productDays: number }[] };
  const entry = (body: { data: Entry[] }, key: string) => body.data.find((item) => item.id === ids[key]);

  beforeAll(async () => {
    const login = await request(app).post('/api/auth/login').set('X-Forwarded-For', '198.51.100.40')
      .send({ email, password: 'TestPassword123!' });
    adminToken = login.body.data.accessToken;

    await createProduct('a-sem-regra', { daysValidRefrigerated: 3, daysValidFrozen: 30 });
    await createProduct('b-regra-produto', { daysValidRefrigerated: 3, daysValidFrozen: 30 });
    await createProduct('c-regra-categoria', { category, daysValidRefrigerated: 3, daysValidFrozen: 30 });
    await createProduct('d-regra-desativada', { daysValidRefrigerated: 3, daysValidFrozen: 30 });
    await createProduct('e-zero-dias', { daysValidRefrigerated: 4, daysValidFrozen: 0 });
    await createProduct('g-inativo', { daysValidRefrigerated: 3, daysValidFrozen: 30 });
    await createProduct('h-regra-so-refrigerado', { daysValidRefrigerated: 3, daysValidFrozen: 45 });
    await prisma.product.update({ where: { id: ids['g-inativo'] }, data: { active: false } });

    await createRule({ productId: ids['b-regra-produto'], storageType: 'REFRIGERADO' });
    await createRule({ productId: ids['b-regra-produto'], storageType: 'CONGELADO', shelfLifeDays: 20 });
    await createRule({ category, storageType: 'REFRIGERADO' });
    await createRule({ category, storageType: 'CONGELADO', shelfLifeDays: 20 });
    await createRule({ productId: ids['h-regra-so-refrigerado'], storageType: 'REFRIGERADO' });
    const deactivated = await createRule({ productId: ids['d-regra-desativada'], storageType: 'REFRIGERADO' });
    await request(app).delete(`/api/shelf-life-rules/${deactivated}`).set('Authorization', asAdmin()).expect(200);
    // Depois das regras: a regra de categoria usa o texto do cadastro, e este difere só na caixa.
    await createProduct('f-categoria-outra-caixa', { category: category.toUpperCase(), daysValidRefrigerated: 2, daysValidFrozen: 0 });
  });

  it('lists the storage types that fall back to the product days, with totals', async () => {
    const res = await withoutRule();
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(entry(res.body, 'a-sem-regra')).toEqual({
      id: ids['a-sem-regra'], name: `Sem regra ${tag} a-sem-regra`, brand: 'Teste', category: null,
      missing: [{ storageType: 'REFRIGERADO', productDays: 3 }, { storageType: 'CONGELADO', productDays: 30 }],
    });
    expect(res.body.meta).toEqual({
      total: res.body.data.length,
      missingCount: res.body.data.reduce((sum: number, item: { missing: unknown[] }) => sum + item.missing.length, 0),
    });
    expect(res.body.data.every((item: { missing: unknown[] }) => item.missing.length > 0)).toBe(true);
    const mine = res.body.data.filter((item: { name: string }) => item.name.startsWith(`Sem regra ${tag}`))
      .map((item: { name: string }) => item.name);
    expect(mine).toEqual([...mine].sort());
  });

  it('leaves out products covered by a product or category rule, and inactive products', async () => {
    const res = await withoutRule();
    expect(entry(res.body, 'b-regra-produto')).toBeUndefined();
    expect(entry(res.body, 'c-regra-categoria')).toBeUndefined();
    expect(entry(res.body, 'g-inativo')).toBeUndefined();
  });

  it('lists only the storage type the product rule does not cover', async () => {
    const res = await withoutRule();
    expect(entry(res.body, 'h-regra-so-refrigerado')?.missing).toEqual([{ storageType: 'CONGELADO', productDays: 45 }]);
  });

  it('does not count a deactivated rule', async () => {
    const res = await withoutRule();
    expect(entry(res.body, 'd-regra-desativada')?.missing).toEqual([
      { storageType: 'REFRIGERADO', productDays: 3 }, { storageType: 'CONGELADO', productDays: 30 },
    ]);
  });

  it('leaves out a storage type with 0 days, where the label is refused instead', async () => {
    const res = await withoutRule();
    expect(entry(res.body, 'e-zero-dias')?.missing).toEqual([{ storageType: 'REFRIGERADO', productDays: 4 }]);
    const preview = await request(app).post('/api/labels/preview').set('Authorization', asAdmin()).send({
      productId: ids['e-zero-dias'], originalExpiryDate: daysFromToday(30), storageType: 'CONGELADO',
    });
    expect(preview.status).toBe(422);
  });

  it('compares the category exactly, like the label calculation', async () => {
    const res = await withoutRule();
    expect(entry(res.body, 'f-categoria-outra-caixa')?.missing).toEqual([{ storageType: 'REFRIGERADO', productDays: 2 }]);
    const preview = await request(app).post('/api/labels/preview').set('Authorization', asAdmin()).send({
      productId: ids['f-categoria-outra-caixa'], originalExpiryDate: daysFromToday(30), storageType: 'REFRIGERADO',
    });
    expect(preview.status).toBe(200);
    expect(preview.body.data.rule.validated).toBe(false);
  });

  it('is only for administrators', async () => {
    const login = await request(app).post('/api/auth/login').set('X-Forwarded-For', '198.51.100.41')
      .send({ email: operatorEmail, password: 'TestPassword123!' });
    expect((await withoutRule(`Bearer ${login.body.data.accessToken}`)).status).toBe(403);
    expect((await request(app).get('/api/products/without-rule')).status).toBe(401);
  });
});

describe('categorias de produto', () => {
  const tag = suffix.slice(0, 8);
  let adminToken = '';
  // Categorias da lista padrão sem produto ativo nem regra ativa equivalente no início do bloco.
  let free = '';
  let free2 = '';
  let free3 = '';
  const asAdmin = () => `Bearer ${adminToken}`;
  const createViaApi = async (category: unknown) => {
    const res = await request(app).post('/api/products').set('Authorization', asAdmin()).send({
      name: `Categoria ${tag}`, brand: 'Teste', daysValidRefrigerated: 3, daysValidFrozen: 0,
      ...(category !== undefined && { category }),
    });
    expect(res.status).toBe(201);
    productIds.push(res.body.data.id);
    return res.body.data as { id: string; category: string | null };
  };
  const createLegacy = async (name: string, category: string) => {
    // Gravado direto no banco, como os produtos de antes da lista (grafia sem normalizar).
    const product = await prisma.product.create({ data: {
      name: `${name} ${tag}`, brand: 'Teste', category, daysValidRefrigerated: 3, daysValidFrozen: 0,
    } });
    productIds.push(product.id);
    return product;
  };
  const createCategoryRule = async (category: string) => {
    const res = await request(app).post('/api/shelf-life-rules').set('Authorization', asAdmin())
      .send({ ...ruleBody, category, storageType: 'REFRIGERADO', shelfLifeDays: 2 });
    expect(res.status).toBe(201);
    ruleIds.push(res.body.data.id);
    return res.body.data as { id: string; category: string };
  };
  const previewRule = async (productId: string) => {
    const res = await request(app).post('/api/labels/preview').set('Authorization', asAdmin()).send({
      productId, originalExpiryDate: daysFromToday(30), storageType: 'REFRIGERADO', storageTemperature: 4,
    });
    expect(res.status).toBe(200);
    return res.body.data.rule as { id: string | null; validated: boolean };
  };
  const categories = (query = '') =>
    request(app).get(`/api/products/categories${query}`).set('Authorization', asAdmin());
  const fold = (value: string) => categoryKey(value);

  beforeAll(async () => {
    const login = await request(app).post('/api/auth/login').set('X-Forwarded-For', '198.51.100.50')
      .send({ email, password: 'TestPassword123!' });
    adminToken = login.body.data.accessToken;

    // O banco descartável pode ter dados de outras execuções: escolhe categorias padrão ainda livres.
    const [used, rules] = await Promise.all([
      prisma.product.findMany({ where: { active: true, category: { not: null } }, select: { category: true } }),
      prisma.shelfLifeRule.findMany({ where: { active: true, category: { not: null } }, select: { category: true } }),
    ]);
    const taken = new Set([...used, ...rules].map((row) => fold(row.category!)));
    [free = '', free2 = '', free3 = ''] = DEFAULT_CATEGORIES.filter((item) => !taken.has(fold(item)));
    expect([free, free2, free3].every(Boolean)).toBe(true);
  });

  it('uses the default spelling when no active product has an equivalent category, then the one in use', async () => {
    expect((await createViaApi(fold(free))).category).toBe(free); // ex.: "laticinios" → "Laticínios"
    expect((await createViaApi(`  ${free.toUpperCase()} `)).category).toBe(free); // já em uso: mesma grafia
  });

  it('prefers the most used spelling among active products over the default list', async () => {
    for (const key of ['a', 'b', 'c']) await createLegacy(`Categoria legada ${key}`, fold(free).toUpperCase());
    // 3 com a grafia antiga contra 2 com a da lista: vale a mais usada.
    expect((await createViaApi(free.toLowerCase())).category).toBe(fold(free).toUpperCase());
  });

  it('keeps a new text with collapsed spaces, and empty or null means no category', async () => {
    expect((await createViaApi(`  Nova   categoria \t ${tag}  `)).category).toBe(`Nova categoria ${tag}`);
    expect((await createViaApi('')).category).toBeNull();
    expect((await createViaApi('   ')).category).toBeNull();
    expect((await createViaApi(null)).category).toBeNull();
    expect((await createViaApi(undefined)).category).toBeNull();
    const tooLong = await request(app).post('/api/products').set('Authorization', asAdmin()).send({
      name: `Categoria ${tag}`, brand: 'Teste', daysValidRefrigerated: 3, daysValidFrozen: 0, category: 'x'.repeat(61),
    });
    expect(tooLong.status).toBe(422);
  });

  it('normalizes on update too, keeping the current spelling when equivalent', async () => {
    const product = await createViaApi(`Única ${tag}`);
    const put = (body: object) => request(app).put(`/api/products/${product.id}`).set('Authorization', asAdmin()).send(body);

    const same = await put({ category: `  ÚNICA   ${tag} ` });
    expect(same.status).toBe(200);
    expect(same.body.data.category).toBe(`Única ${tag}`);

    expect((await put({ category: fold(free2) })).body.data.category).toBe(free2);
    expect((await put({ name: `Categoria ${tag} editada` })).body.data.category).toBe(free2); // sem category, não mexe
    expect((await put({ category: '' })).body.data.category).toBeNull();
  });

  it('keeps the old spelling of the only product with a category rule when it is edited', async () => {
    const legacySpelling = fold(free3).toUpperCase(); // diferente da grafia da lista padrão
    const product = await createLegacy('Categoria com regra', legacySpelling);
    const rule = await createCategoryRule(legacySpelling);
    expect(rule.category).toBe(legacySpelling);
    const put = (body: object) => request(app).put(`/api/products/${product.id}`).set('Authorization', asAdmin()).send(body);

    // O formulário manda a categoria junto; mesmo na grafia da lista, fica a atual.
    expect((await put({ name: `Categoria com regra ${tag} editado`, category: free3 })).body.data.category).toBe(legacySpelling);
    expect((await put({ name: `Categoria com regra ${tag} de novo` })).body.data.category).toBe(legacySpelling);
    expect(await previewRule(product.id)).toMatchObject({ id: rule.id, validated: true });
  });

  it('gives a new equivalent product the spelling of the active category rule, even if most products use another', async () => {
    const ruleSpelling = `mistura ${tag}`;
    await createLegacy('Mistura regra', ruleSpelling);
    const rule = await createCategoryRule(ruleSpelling);
    for (const key of ['a', 'b', 'c']) await createLegacy(`Mistura maioria ${key}`, `MISTURA ${tag}`);

    const created = await createViaApi(`Mistura ${tag}`);
    expect(created.category).toBe(ruleSpelling);
    expect(await previewRule(created.id)).toMatchObject({ id: rule.id, validated: true });
  });

  it('treats inner double spaces as the same category and keeps the stored spelling', async () => {
    const stored = `Dupla  ${tag}`; // dois espaços, de antes da limpeza
    await createLegacy('Espaço duplo', stored);
    const rule = await createCategoryRule(stored);
    expect(rule.category).toBe(stored);

    const created = await createViaApi(`dupla ${tag}`);
    expect(created.category).toBe(stored);
    expect(await previewRule(created.id)).toMatchObject({ id: rule.id, validated: true });

    const list = (await categories('?withDefaults=true')).body.data as string[];
    expect(list.filter((item) => fold(item) === fold(stored))).toEqual([stored]);
  });

  it('lists the default categories with ?withDefaults=true, without equivalent duplicates', async () => {
    const res = await categories('?withDefaults=true');
    expect(res.status).toBe(200);
    const list = res.body.data as string[];
    expect(new Set(list.map(fold)).size).toBe(list.length);
    expect(list).toEqual([...list].sort((a, b) => a.localeCompare(b, 'pt-BR')));
    const keys = new Set(list.map(fold));
    expect(DEFAULT_CATEGORIES.every((item) => keys.has(fold(item)))).toBe(true);
    expect(list).toContain(`Nova categoria ${tag}`);
    expect(list.filter((item) => fold(item) === fold(free))).toHaveLength(1);
  });

  it('keeps the previous behavior without the parameter, and validates the query', async () => {
    const res = await categories();
    expect(res.status).toBe(200);
    const rows = await prisma.product.findMany({
      where: { active: true, category: { not: null } }, select: { category: true }, distinct: ['category'], orderBy: { category: 'asc' },
    });
    expect(res.body.data).toEqual(rows.map((row) => row.category));
    expect(res.body.data).toEqual(expect.arrayContaining([free, fold(free).toUpperCase()]));
    expect((await categories('?withDefaults=false')).body.data).toEqual(res.body.data);
    expect((await categories('?withDefaults=sim')).status).toBe(422);
  });
});

describe('bloqueio de etiqueta sem regra validada', () => {
  const tag = suffix.slice(0, 8);
  const category = `Bloqueio ${tag}`;
  let adminToken = '';
  let operatorAuth = '';
  let noRuleId = '';
  let productRuleId = '';
  let categoryRuleId = '';
  const asAdmin = () => `Bearer ${adminToken}`;
  const turnOff = () => prisma.kitchenSettings.updateMany({ data: { requireValidatedRule: false } });
  const setRequire = (value: unknown, token = asAdmin()) =>
    request(app).put('/api/settings').set('Authorization', token).send({ requireValidatedRule: value });
  const labelBody = (productId: string, body: object = {}) => ({
    productId, lot: 'LOT-BLOQ', originalExpiryDate: daysFromToday(60), openedAt: today(),
    responsibleName: 'Turno de teste', storageType: 'REFRIGERADO', storageTemperature: 4, ...body,
  });
  const preview = (productId: string, body: object = {}) =>
    request(app).post('/api/labels/preview').set('Authorization', asAdmin()).send(labelBody(productId, body));
  const create = (productId: string, body: object = {}) =>
    request(app).post('/api/labels').set('Authorization', asAdmin()).send(labelBody(productId, body));
  const splitBody = { count: 1, storageType: 'REFRIGERADO', storageTemperature: 4, responsibleName: 'Fracionador' };
  const splitPreview = (id: string, body: object = {}) => request(app).post(`/api/labels/${id}/split/preview`)
    .set('Authorization', asAdmin()).send({ storageType: 'REFRIGERADO', storageTemperature: 4, ...body });
  const split = (id: string, body: object = {}) =>
    request(app).post(`/api/labels/${id}/split`).set('Authorization', asAdmin()).send({ ...splitBody, ...body });
  const newLabel = async (productId: string, body: object = {}) => {
    const res = await create(productId, body);
    expect(res.status).toBe(201);
    return res.body.data as { id: string };
  };
  const expectRuleRequired = (res: request.Response) => {
    expect(res.status).toBe(422);
    expect(res.body.error).toEqual({
      code: 'RULE_REQUIRED',
      message: 'Produto sem prazo validado para este armazenamento. Chame o gerente para cadastrar a regra.',
    });
  };

  beforeAll(async () => {
    const login = await request(app).post('/api/auth/login').set('X-Forwarded-For', '198.51.100.60')
      .send({ email, password: 'TestPassword123!' });
    adminToken = login.body.data.accessToken;
    const operatorLogin = await request(app).post('/api/auth/login').set('X-Forwarded-For', '198.51.100.61')
      .send({ email: operatorEmail, password: 'TestPassword123!' });
    operatorAuth = `Bearer ${operatorLogin.body.data.accessToken}`;
    // Prazos fictícios, só para o teste.
    const product = async (name: string, data: { category?: string } = {}) => {
      const created = await prisma.product.create({
        data: { name: `${name} ${tag}`, brand: 'Teste', daysValidRefrigerated: 3, daysValidFrozen: 30, ...data },
      });
      productIds.push(created.id);
      return created.id;
    };
    noRuleId = await product('Bloqueio sem regra');
    productRuleId = await product('Bloqueio regra produto');
    categoryRuleId = await product('Bloqueio regra categoria', { category });
    for (const body of [{ productId: productRuleId }, { category }]) {
      const res = await request(app).post('/api/shelf-life-rules').set('Authorization', asAdmin())
        .send({ ...ruleBody, shelfLifeDays: 5, storageType: 'REFRIGERADO', ...body });
      expect(res.status).toBe(201);
      ruleIds.push(res.body.data.id);
    }
  });

  // Cada teste que liga o bloqueio desliga no fim, para não mudar o resultado dos outros.
  afterEach(turnOff);
  afterAll(turnOff);

  it('keeps the current behavior while the option is off (the default)', async () => {
    const settings = await request(app).get('/api/settings').set('Authorization', operatorAuth);
    expect(settings.status).toBe(200);
    expect(settings.body.data.requireValidatedRule).toBe(false);

    const me = await request(app).get('/api/auth/me').set('Authorization', asAdmin());
    expect(me.body.meta).toMatchObject({ kitchenToday: today(), requireValidatedRule: false });

    const res = await preview(noRuleId);
    expect(res.status).toBe(200);
    expect(res.body.data.rule.validated).toBe(false);
    const label = await newLabel(noRuleId);
    expect((await splitPreview(label.id)).status).toBe(200);
    expect((await split(label.id)).status).toBe(201);
  });

  it('only lets an ADMIN change the option, with a strict body', async () => {
    expect((await setRequire(true, operatorAuth)).status).toBe(403);
    expect((await request(app).put('/api/settings').send({ requireValidatedRule: true })).status).toBe(401);
    expect((await request(app).get('/api/settings')).status).toBe(401);
    expect((await setRequire('true')).status).toBe(422);
    expect((await request(app).put('/api/settings').set('Authorization', asAdmin()).send({})).status).toBe(422);
    const extra = await request(app).put('/api/settings').set('Authorization', asAdmin())
      .send({ requireValidatedRule: true, updatedByName: 'Outro' });
    expect(extra.status).toBe(422);
    const settings = await request(app).get('/api/settings').set('Authorization', asAdmin());
    expect(settings.body.data.requireValidatedRule).toBe(false);
  });

  it('turns the option on with who changed it, the blocked counts and /auth/me', async () => {
    const res = await setRequire(true);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ requireValidatedRule: true, updatedByName: 'Teste de integração' });
    expect(typeof res.body.data.updatedAt).toBe('string');
    const withoutRule = await request(app).get('/api/products/without-rule').set('Authorization', asAdmin());
    expect(res.body.meta).toEqual({
      blockedProducts: withoutRule.body.meta.total, blockedCombinations: withoutRule.body.meta.missingCount,
    });
    // Os produtos deste bloco: sem regra (2 armazenamentos), regra só no refrigerado (1 cada).
    expect(res.body.meta.blockedProducts).toBeGreaterThanOrEqual(3);
    expect(res.body.meta.blockedCombinations).toBeGreaterThanOrEqual(4);
    expect(await prisma.kitchenSettings.findUnique({ where: { id: 1 } })).toMatchObject({ updatedById: userId });

    const me = await request(app).get('/api/auth/me').set('Authorization', operatorAuth);
    expect(me.body.meta.requireValidatedRule).toBe(true);
    const settings = await request(app).get('/api/settings').set('Authorization', operatorAuth);
    expect(settings.body.data).toMatchObject({ requireValidatedRule: true, updatedByName: 'Teste de integração' });
  });

  it('with the option on, refuses the 4 endpoints without a rule and accepts product or category rules', async () => {
    const parentNoRule = await newLabel(noRuleId);
    expect((await setRequire(true)).status).toBe(200);
    const before = await prisma.label.count({ where: { productId: noRuleId } });

    expectRuleRequired(await preview(noRuleId));
    expectRuleRequired(await preview(noRuleId, { storageTemperature: undefined }));
    expectRuleRequired(await create(noRuleId, { requestId: randomUUID() }));
    expectRuleRequired(await splitPreview(parentNoRule.id));
    expectRuleRequired(await split(parentNoRule.id, { requestId: randomUUID(), closeParent: true }));
    expect(await prisma.label.count({ where: { productId: noRuleId } })).toBe(before);
    expect((await prisma.label.findUniqueOrThrow({ where: { id: parentNoRule.id } })).status).toBe('ATIVA');
    // A regra vale por armazenamento: só refrigerado tem regra, congelado é recusado.
    expectRuleRequired(await preview(productRuleId, { storageType: 'CONGELADO', storageTemperature: -18 }));

    for (const productId of [productRuleId, categoryRuleId]) {
      const ok = await preview(productId);
      expect(ok.status).toBe(200);
      expect(ok.body.data.rule).toMatchObject({ validated: true, shelfLifeDays: 5 });
      const parent = await newLabel(productId);
      expect((await splitPreview(parent.id)).status).toBe(200);
      expect((await split(parent.id)).status).toBe(201);
    }

    expect((await setRequire(false)).status).toBe(200);
    expect((await preview(noRuleId)).status).toBe(200);
  });

  it('still resolves idempotent resends, close, reprint and list with the option on', async () => {
    const requestId = randomUUID();
    const label = await newLabel(noRuleId, { requestId });
    const splitRequestId = randomUUID();
    const first = await split(label.id, { requestId: splitRequestId });
    expect(first.status).toBe(201);
    const other = await newLabel(noRuleId);
    expect((await setRequire(true)).status).toBe(200);

    const resent = await create(noRuleId, { requestId });
    expect(resent.status).toBe(200);
    expect(resent.body.data.id).toBe(label.id);
    const resplit = await split(label.id, { requestId: splitRequestId });
    expect(resplit.status).toBe(200);
    expect(resplit.body.data.children.map((child: { id: string }) => child.id))
      .toEqual(first.body.data.children.map((child: { id: string }) => child.id));

    expect((await request(app).patch(`/api/labels/${other.id}/print`).set('Authorization', asAdmin())).status).toBe(200);
    const list = await request(app).get('/api/labels').query({ productId: noRuleId, limit: '100' }).set('Authorization', asAdmin());
    expect(list.status).toBe(200);
    expect(list.body.data.some((item: { id: string }) => item.id === other.id)).toBe(true);
    const closed = await request(app).post(`/api/labels/${other.id}/close`).set('Authorization', operatorAuth)
      .send({ outcome: 'USADO' });
    expect(closed.status).toBe(200);
    expect(closed.body.data).toMatchObject({ status: 'ENCERRADA', outcome: 'USADO' });
  });
});

describe('aviso de validade digitada muito distante', () => {
  const tag = suffix.slice(0, 8);
  let adminToken = '';
  const asAdmin = () => `Bearer ${adminToken}`;
  const reset = () => prisma.kitchenSettings.updateMany({
    data: { requireValidatedRule: false, expiryWarningMonths: null },
  });
  const putSettings = (body: object) => request(app).put('/api/settings').set('Authorization', asAdmin()).send(body);
  // Um produto por teste: cada um monta o próprio histórico e não depende da ordem.
  const newProduct = async () => {
    // Prazos fictícios, só para o teste.
    const product = await prisma.product.create({
      data: { name: `Aviso validade ${tag} ${randomUUID().slice(0, 6)}`, brand: 'Teste', daysValidRefrigerated: 3, daysValidFrozen: 30 },
    });
    productIds.push(product.id);
    return product.id;
  };
  const typedBody = (productId: string, expiryDays: number) => ({
    productId, lot: 'LOT-AVISO', originalExpiryDate: daysFromToday(expiryDays), openedAt: today(),
    responsibleName: 'Turno de teste', storageType: 'REFRIGERADO', storageTemperature: 4,
  });
  const preview = (body: object) => request(app).post('/api/labels/preview').set('Authorization', asAdmin()).send(body);
  const warningFor = async (productId: string, expiryDays: number) => {
    const res = await preview(typedBody(productId, expiryDays));
    expect(res.status).toBe(200);
    return res.body.data.expiryWarning;
  };
  // Lotes cadastrados hoje: entram no histórico com validade − dia do cadastro.
  const addLots = (productId: string, ...expiryDays: number[]) => Promise.all(expiryDays.map((days) =>
    prisma.productLot.create({ data: {
      productId, code: `AV-${days}-${randomUUID().slice(0, 6)}`,
      expiryDate: new Date(`${daysFromToday(days)}T00:00:00.000Z`),
    } })));
  const typedLabel = async (productId: string, expiryDays: number) => {
    const res = await request(app).post('/api/labels').set('Authorization', asAdmin()).send(typedBody(productId, expiryDays));
    expect(res.status).toBe(201);
    return res.body.data as { id: string };
  };
  const limitDays = (months: number) =>
    Math.round((addMonths(kitchenToday(), months).getTime() - kitchenToday().getTime()) / 86_400_000);

  beforeAll(async () => {
    const login = await request(app).post('/api/auth/login').set('X-Forwarded-For', '198.51.100.70')
      .send({ email, password: 'TestPassword123!' });
    adminToken = login.body.data.accessToken;
  });

  // Cada teste que muda a configuração volta ao padrão no fim.
  afterEach(reset);
  afterAll(reset);

  it('does not warn without history, nor with fewer than 3 records', async () => {
    const productId = await newProduct();
    expect(await warningFor(productId, 900)).toBeNull();
    await addLots(productId, 300, 300);
    expect(await warningFor(productId, 900)).toBeNull();
  });

  it('warns ABOVE_HISTORY above the median + 180 days, and not for normal variation', async () => {
    const productId = await newProduct();
    await addLots(productId, 300, 305);
    await typedLabel(productId, 310); // mediana de 300, 305, 310 = 305

    expect(await warningFor(productId, 486)).toEqual({
      reason: 'ABOVE_HISTORY', typedDays: 486, referenceDays: 305, limitMonths: null,
    });
    expect(await warningFor(productId, 485)).toBeNull();
    // Embalagem alguns dias mais nova que todas as anteriores: variação normal, sem aviso.
    expect(await warningFor(productId, 320)).toBeNull();
  });

  it('keeps warning after a label with the wrong year entered the history', async () => {
    const productId = await newProduct();
    await addLots(productId, 300, 300, 300);
    // Ano digitado errado: 665 dias em vez de 300. Com o máximo como referência, o aviso sumiria.
    const wrong = await typedLabel(productId, 665);
    expect(wrong.id).toBeTruthy();
    expect(await warningFor(productId, 665)).toEqual({
      reason: 'ABOVE_HISTORY', typedDays: 665, referenceDays: 300, limitMonths: null,
    });
  });

  it('ignores cancelled labels, split children and labels made from a registered lot', async () => {
    const productId = await newProduct();
    const [lot] = await addLots(productId, 300, 300);

    const cancelled = await typedLabel(productId, 300);
    const close = await request(app).post(`/api/labels/${cancelled.id}/close`).set('Authorization', asAdmin())
      .send({ outcome: 'CANCELADO' });
    expect(close.status).toBe(200);
    // Etiqueta do lote cadastrado: a validade já conta pelo lote.
    const fromLot = await request(app).post('/api/labels').set('Authorization', asAdmin()).send({
      productId, lotId: lot.id, openedAt: today(), responsibleName: 'Turno de teste',
      storageType: 'REFRIGERADO', storageTemperature: 4,
    });
    expect(fromLot.status).toBe(201);
    // Filha do Dividir repete a embalagem da origem (aqui, a do lote).
    const split = await request(app).post(`/api/labels/${fromLot.body.data.id}/split`).set('Authorization', asAdmin())
      .send({ count: 2, storageType: 'REFRIGERADO', storageTemperature: 4, responsibleName: 'Fracionador' });
    expect(split.status).toBe(201);
    // Só os 2 lotes contam: abaixo do mínimo.
    expect(await warningFor(productId, 900)).toBeNull();

    await typedLabel(productId, 300); // terceiro registro válido
    expect((await warningFor(productId, 900))?.reason).toBe('ABOVE_HISTORY');
  });

  it('warns ABOVE_LIMIT with the configured limit, which wins over ABOVE_HISTORY', async () => {
    const productId = await newProduct();
    await addLots(productId, 30, 30, 30);

    expect((await putSettings({ expiryWarningMonths: 1 })).status).toBe(200);
    expect(await warningFor(productId, 400)).toEqual({
      reason: 'ABOVE_LIMIT', typedDays: 400, referenceDays: limitDays(1), limitMonths: 1,
    });
    // Exatamente no limite não avisa por ele (e fica abaixo da mediana + 180).
    expect(await warningFor(productId, limitDays(1))).toBeNull();

    // Limite de 24 meses: 400 dias fica dentro dele, mas acima do histórico (30 + 180).
    expect((await putSettings({ expiryWarningMonths: 24 })).status).toBe(200);
    expect(await warningFor(productId, 400)).toEqual({
      reason: 'ABOVE_HISTORY', typedDays: 400, referenceDays: 30, limitMonths: 24,
    });
  });

  it('accepts a partial PUT and validates the limit', async () => {
    const initial = await request(app).get('/api/settings').set('Authorization', asAdmin());
    expect(initial.body.data).toMatchObject({ requireValidatedRule: false, expiryWarningMonths: null });

    for (const value of [0, 61, 1.5, '3', true]) {
      expect((await putSettings({ expiryWarningMonths: value })).status).toBe(422);
    }
    expect((await putSettings({ expiryWarningMonths: 6, extra: 1 })).status).toBe(422);

    const set = await putSettings({ expiryWarningMonths: 60 });
    expect(set.status).toBe(200);
    expect(set.body.data).toMatchObject({ requireValidatedRule: false, expiryWarningMonths: 60 });
    expect(set.body.meta).toEqual({ blockedProducts: expect.any(Number), blockedCombinations: expect.any(Number) });

    // Só o bloqueio: o limite fica como estava.
    const onlyRequire = await putSettings({ requireValidatedRule: true });
    expect(onlyRequire.status).toBe(200);
    expect(onlyRequire.body.data).toMatchObject({ requireValidatedRule: true, expiryWarningMonths: 60 });

    // null desliga o limite e não mexe no bloqueio.
    const off = await putSettings({ expiryWarningMonths: null });
    expect(off.status).toBe(200);
    expect(off.body.data).toMatchObject({ requireValidatedRule: true, expiryWarningMonths: null });
    const settings = await request(app).get('/api/settings').set('Authorization', asAdmin());
    expect(settings.body.data.expiryWarningMonths).toBeNull();
  });

  it('keeps creating the label when the preview warns, without storing the warning', async () => {
    const productId = await newProduct();
    expect((await putSettings({ expiryWarningMonths: 1 })).status).toBe(200);
    const body = typedBody(productId, 80);
    expect((await preview(body)).body.data.expiryWarning.reason).toBe('ABOVE_LIMIT');
    const res = await request(app).post('/api/labels').set('Authorization', asAdmin()).send(body);
    expect(res.status).toBe(201);
    expect(res.body.data).not.toHaveProperty('expiryWarning');
    expect(res.body.data.discardAt.slice(0, 10)).toBe(daysFromToday(2));
  });

  it('does not warn for a registered lot', async () => {
    const productId = await newProduct();
    expect((await putSettings({ expiryWarningMonths: 1 })).status).toBe(200);
    const [lot] = await addLots(productId, 400);
    const res = await preview({
      productId, lotId: lot.id, openedAt: today(), storageType: 'REFRIGERADO', storageTemperature: 4,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.lot.id).toBe(lot.id);
    expect(res.body.data.expiryWarning).toBeNull();
  });
});

describe('modelo de etiqueta padrão da cozinha', () => {
  let adminToken = '';
  let operatorAuth = '';
  const asAdmin = () => `Bearer ${adminToken}`;
  const reset = () => prisma.kitchenSettings.updateMany({
    data: { requireValidatedRule: false, expiryWarningMonths: null, labelTemplate: null },
  });
  const putSettings = (body: object, token = asAdmin()) =>
    request(app).put('/api/settings').set('Authorization', token).send(body);
  const getSettings = () => request(app).get('/api/settings').set('Authorization', asAdmin());

  beforeAll(async () => {
    const login = await request(app).post('/api/auth/login').set('X-Forwarded-For', '198.51.100.80')
      .send({ email, password: 'TestPassword123!' });
    adminToken = login.body.data.accessToken;
    const operatorLogin = await request(app).post('/api/auth/login').set('X-Forwarded-For', '198.51.100.81')
      .send({ email: operatorEmail, password: 'TestPassword123!' });
    operatorAuth = `Bearer ${operatorLogin.body.data.accessToken}`;
  });

  // Cada teste volta ao padrão no fim.
  afterEach(reset);
  afterAll(reset);

  it('starts undefined and only changes the template on a partial PUT', async () => {
    expect((await getSettings()).body.data.labelTemplate).toBeNull();

    expect((await putSettings({ requireValidatedRule: true, expiryWarningMonths: 12 })).status).toBe(200);
    const set = await putSettings({ labelTemplate: 't60x40' });
    expect(set.status).toBe(200);
    expect(set.body.data).toMatchObject({ requireValidatedRule: true, expiryWarningMonths: 12, labelTemplate: 't60x40' });
    expect(set.body.meta).toEqual({ blockedProducts: expect.any(Number), blockedCombinations: expect.any(Number) });

    // Os outros campos sozinhos não mexem no modelo.
    const others = await putSettings({ requireValidatedRule: false, expiryWarningMonths: null });
    expect(others.body.data).toMatchObject({ requireValidatedRule: false, expiryWarningMonths: null, labelTemplate: 't60x40' });

    // null limpa o modelo e não mexe no resto.
    expect((await putSettings({ expiryWarningMonths: 6 })).status).toBe(200);
    const cleared = await putSettings({ labelTemplate: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data).toMatchObject({ requireValidatedRule: false, expiryWarningMonths: 6, labelTemplate: null });
    expect((await getSettings()).body.data.labelTemplate).toBeNull();
  });

  it('refuses an unknown template and a non-ADMIN', async () => {
    expect((await putSettings({ labelTemplate: 't100x60' })).status).toBe(200);
    for (const value of ['A4', 'zebra', '', 1, true]) {
      const res = await putSettings({ labelTemplate: value });
      expect(res.status).toBe(422);
      expect(res.body.error.message).toBe('Modelo de etiqueta inválido.');
    }
    expect((await putSettings({ labelTemplate: 'a4' }, operatorAuth)).status).toBe(403);
    expect((await getSettings()).body.data.labelTemplate).toBe('t100x60');
  });

  it('returns the template on /auth/me and hides an unknown stored value', async () => {
    expect((await putSettings({ labelTemplate: 't50x30' })).status).toBe(200);
    const me = await request(app).get('/api/auth/me').set('Authorization', operatorAuth);
    expect(me.status).toBe(200);
    expect(me.body.meta.labelTemplate).toBe('t50x30');

    // Valor fora da lista gravado direto no banco: vira null, sem erro.
    await prisma.kitchenSettings.updateMany({ data: { labelTemplate: 'antigo' } });
    expect((await getSettings()).body.data.labelTemplate).toBeNull();
    const meUnknown = await request(app).get('/api/auth/me').set('Authorization', operatorAuth);
    expect(meUnknown.status).toBe(200);
    expect(meUnknown.body.meta.labelTemplate).toBeNull();
  });
});

describe('medição de tempo e origem da temperatura', () => {
  const tag = suffix.slice(0, 8);
  let adminToken = '';
  let operatorAuth = '';
  const asAdmin = () => `Bearer ${adminToken}`;
  // Um produto por teste: cada um conta só as próprias etiquetas e não depende da ordem.
  const newProduct = async () => {
    // Prazos fictícios, só para o teste.
    const product = await prisma.product.create({
      data: { name: `Medição ${tag} ${randomUUID().slice(0, 6)}`, brand: 'Teste', daysValidRefrigerated: 5, daysValidFrozen: 30 },
    });
    productIds.push(product.id);
    return product.id;
  };
  const labelBody = (productId: string, body: object = {}) => ({
    productId, lot: 'LOT-MED', originalExpiryDate: daysFromToday(60), openedAt: today(),
    responsibleName: 'Turno de teste', storageType: 'REFRIGERADO', storageTemperature: 4, ...body,
  });
  const postLabel = (productId: string, body: object = {}) =>
    request(app).post('/api/labels').set('Authorization', asAdmin()).send(labelBody(productId, body));
  const newLabel = async (productId: string, body: object = {}) => {
    const res = await postLabel(productId, body);
    expect(res.status).toBe(201);
    return res.body.data as { id: string; shortCode: string; flowMs: number | null; temperatureSource: string | null };
  };
  const split = (parentId: string, body: object = {}) =>
    request(app).post(`/api/labels/${parentId}/split`).set('Authorization', asAdmin())
      .send({ count: 2, storageType: 'REFRIGERADO', storageTemperature: 4, responsibleName: 'Fracionador', ...body });
  const metrics = (query: Record<string, string>, token = asAdmin()) =>
    request(app).get('/api/labels/metrics').query(query).set('Authorization', token);

  beforeAll(async () => {
    const login = await request(app).post('/api/auth/login').set('X-Forwarded-For', '198.51.100.80')
      .send({ email, password: 'TestPassword123!' });
    adminToken = login.body.data.accessToken;
    const operator = await request(app).post('/api/auth/login').set('X-Forwarded-For', '198.51.100.81')
      .send({ email: operatorEmail, password: 'TestPassword123!' });
    operatorAuth = `Bearer ${operator.body.data.accessToken as string}`;
  });

  it('stores flowMs and temperatureSource on create and returns them in the list', async () => {
    const productId = await newProduct();
    const measured = await newLabel(productId, { flowMs: 12_345, temperatureSource: 'SUGERIDO' });
    expect(measured).toMatchObject({ flowMs: 12_345, temperatureSource: 'SUGERIDO' });
    const typed = await newLabel(productId, { flowMs: 0, temperatureSource: 'DIGITADO' });
    expect(typed).toMatchObject({ flowMs: 0, temperatureSource: 'DIGITADO' });
    // Cliente antigo, sem os campos: ficam nulos.
    const plain = await newLabel(productId);
    expect(plain).toMatchObject({ flowMs: null, temperatureSource: null });

    const stored = await prisma.label.findUniqueOrThrow({ where: { id: measured.id } });
    expect(stored).toMatchObject({ flowMs: 12_345, temperatureSource: 'SUGERIDO' });

    const list = await request(app).get('/api/labels').query({ productId, limit: '100' }).set('Authorization', asAdmin());
    expect(list.status).toBe(200);
    const byId = (id: string) => list.body.data.find((label: { id: string }) => label.id === id);
    expect(byId(measured.id)).toMatchObject({ flowMs: 12_345, temperatureSource: 'SUGERIDO' });
    expect(byId(typed.id)).toMatchObject({ flowMs: 0, temperatureSource: 'DIGITADO' });
    expect(byId(plain.id)).toMatchObject({ flowMs: null, temperatureSource: null });
  });

  it('ignores an invalid flowMs without refusing the label and validates the temperatureSource enum', async () => {
    const productId = await newProduct();
    // A métrica nunca recusa a etiqueta: valor inválido não é gravado.
    for (const flowMs of [-1, 3_600_001, 1.5, '1000', null, Number.MAX_SAFE_INTEGER]) {
      const res = await postLabel(productId, { flowMs });
      expect(res.status).toBe(201);
      expect(res.body.data.flowMs).toBeNull();
      expect((await prisma.label.findUniqueOrThrow({ where: { id: res.body.data.id } })).flowMs).toBeNull();
    }
    for (const temperatureSource of ['sugerido', 'MEDIDO', '', 1]) {
      const res = await postLabel(productId, { temperatureSource });
      expect(res.status).toBe(201);
      expect((await prisma.label.findUniqueOrThrow({ where: { id: res.body.data.id } })).temperatureSource).toBeNull();
    }
    expect((await newLabel(productId, { flowMs: 3_600_000 })).flowMs).toBe(3_600_000);

    const parent = await newLabel(productId);
    const badSource = await split(parent.id, { count: 1, temperatureSource: 'X' });
    expect(badSource.status).toBe(201);
    expect((await prisma.label.findFirstOrThrow({ where: { parentLabelId: parent.id } })).temperatureSource).toBeNull();
    for (const flowMs of [3_600_001, -5, 2.5, 'abc', null]) {
      const res = await split(parent.id, { count: 1, flowMs });
      expect(res.status).toBe(201);
      expect(res.body.data.children[0].flowMs).toBeNull();
    }
  });

  it('a replayed create keeps the stored values', async () => {
    const productId = await newProduct();
    const requestId = randomUUID();
    const first = await postLabel(productId, { requestId, flowMs: 8_000, temperatureSource: 'SUGERIDO' });
    expect(first.status).toBe(201);
    const replay = await postLabel(productId, { requestId, flowMs: 99_000, temperatureSource: 'DIGITADO' });
    expect(replay.status).toBe(200);
    expect(replay.body.data).toMatchObject({ id: first.body.data.id, flowMs: 8_000, temperatureSource: 'SUGERIDO' });
    const stored = await prisma.label.findUniqueOrThrow({ where: { id: first.body.data.id } });
    expect(stored).toMatchObject({ flowMs: 8_000, temperatureSource: 'SUGERIDO' });
    expect(await prisma.label.count({ where: { productId } })).toBe(1);
  });

  it('stores the split measurement on every child, not on the source, and a replay keeps it', async () => {
    const productId = await newProduct();
    const parent = await newLabel(productId, { flowMs: 4_000, temperatureSource: 'DIGITADO' });
    const requestId = randomUUID();
    const res = await split(parent.id, { count: 3, requestId, flowMs: 6_500, temperatureSource: 'SUGERIDO' });
    expect(res.status).toBe(201);
    expect(res.body.data.children).toHaveLength(3);
    for (const child of res.body.data.children) {
      expect(child).toMatchObject({ flowMs: 6_500, temperatureSource: 'SUGERIDO', parentLabelId: parent.id });
    }
    expect(res.body.data.parent).toMatchObject({ flowMs: 4_000, temperatureSource: 'DIGITADO' });

    const replay = await split(parent.id, { count: 3, requestId, flowMs: 1, temperatureSource: 'DIGITADO' });
    expect(replay.status).toBe(200);
    expect(replay.body.data.children.map((child: { id: string }) => child.id).sort())
      .toEqual(res.body.data.children.map((child: { id: string }) => child.id).sort());
    const children = await prisma.label.findMany({ where: { parentLabelId: parent.id } });
    expect(children).toHaveLength(3);
    expect(children.every((child) => child.flowMs === 6_500 && child.temperatureSource === 'SUGERIDO')).toBe(true);
    expect(await prisma.label.findUniqueOrThrow({ where: { id: parent.id } }))
      .toMatchObject({ flowMs: 4_000, temperatureSource: 'DIGITADO' });

    // Sem os campos, as filhas ficam nulas.
    const plain = await split(parent.id);
    expect(plain.status).toBe(201);
    for (const child of plain.body.data.children) expect(child).toMatchObject({ flowMs: null, temperatureSource: null });
  });

  it('adds "Tempo (s)" and "Origem da temperatura" at the end of the CSV', async () => {
    const productId = await newProduct();
    const suggested = await newLabel(productId, { flowMs: 12_345, temperatureSource: 'SUGERIDO' });
    const typed = await newLabel(productId, { flowMs: 900, temperatureSource: 'DIGITADO' });
    const plain = await newLabel(productId);
    const res = await request(app).get('/api/labels/export.csv').query({ productId }).set('Authorization', asAdmin())
      .buffer(true).parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    const rows = (res.body as Buffer).toString('utf8').replace(/^﻿/, '').split('\r\n').filter(Boolean);
    const header = rows[0].split(';');
    expect(header).toHaveLength(25);
    expect(header.slice(-3)).toEqual(['"Criada em"', '"Tempo (s)"', '"Origem da temperatura"']);
    // Colunas anteriores no mesmo lugar.
    expect(header[4]).toBe('"Lote cadastrado"');
    expect(header[10]).toBe('"Temperatura"');
    const tail = (code: string) => rows.find((line) => line.startsWith(`"${code}"`))!.split(';').slice(-2);
    expect(tail(suggested.shortCode)).toEqual(['"12,3"', '"Sugerida"']);
    expect(tail(typed.shortCode)).toEqual(['"0,9"', '"Digitada"']);
    expect(tail(plain.shortCode)).toEqual(['""', '""']);
  });

  describe('relatório', () => {
    // Período antigo e produto próprio: nada que já exista no banco entra na conta.
    const day1 = '2001-03-10';
    const day2 = '2001-03-11';
    const day3 = '2001-03-12';
    // Meio-dia UTC: no mesmo dia em qualquer fuso de −11 a +11 h (a cozinha padrão é UTC−4).
    const moveTo = (ids: string[], day: string) =>
      prisma.label.updateMany({ where: { id: { in: ids } }, data: { createdAt: new Date(`${day}T12:00:00.000Z`) } });

    it('aggregates median, p90, counts and days, without cancelled labels', async () => {
      const productId = await newProduct();
      const a = await newLabel(productId, { flowMs: 1_000, temperatureSource: 'SUGERIDO' });
      const b = await newLabel(productId, { flowMs: 2_000, temperatureSource: 'DIGITADO' });
      const c = await newLabel(productId, { flowMs: 3_000, temperatureSource: 'SUGERIDO' });
      const d = await newLabel(productId);
      const cancelled = await newLabel(productId, { flowMs: 100_000, temperatureSource: 'DIGITADO' });
      await request(app).post(`/api/labels/${cancelled.id}/close`).set('Authorization', asAdmin())
        .send({ outcome: 'CANCELADO' }).expect(200);
      const parent = await newLabel(productId, { flowMs: 4_000, temperatureSource: 'DIGITADO' });
      // Dividir em 3: um tempo medido (conta uma vez) e três etiquetas impressas (contam três).
      const children = await split(parent.id, { count: 3, requestId: randomUUID(), flowMs: 5_000, temperatureSource: 'SUGERIDO' });
      expect(children.status).toBe(201);
      const childIds = children.body.data.children.map((child: { id: string }) => child.id) as string[];
      await moveTo([a.id, b.id, c.id, d.id, cancelled.id], day1);
      await moveTo([parent.id, ...childIds], day2);

      const res = await metrics({ productId, from: day1, to: day3 });
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({
        from: day1, to: day3,
        total: 8, withFlow: 5, discardedFlows: 0, flowMedianMs: 3_000,
        // percentile_cont(0.9) de 1, 2, 3, 4 e 5 s: 4 s + 0,6 × 1 s.
        flowP90Ms: 4_600,
        withTemperatureSource: 7, suggestedCount: 5, typedCount: 2,
        byDay: [
          { date: day1, total: 4, flowMedianMs: 2_000, suggestedCount: 2, typedCount: 1 },
          { date: day2, total: 4, flowMedianMs: 4_500, suggestedCount: 3, typedCount: 1 },
          { date: day3, total: 0, flowMedianMs: null, suggestedCount: 0, typedCount: 0 },
        ],
      });

      // Só o primeiro dia.
      const single = await metrics({ productId, from: day1, to: day1 });
      expect(single.body.data).toMatchObject({ total: 4, withFlow: 3, flowMedianMs: 2_000, byDay: [{ date: day1 }] });
      // Período sem nada.
      const empty = await metrics({ productId, from: '2001-04-01', to: '2001-04-02' });
      expect(empty.body.data).toMatchObject({
        total: 0, withFlow: 0, discardedFlows: 0, flowMedianMs: null, flowP90Ms: null,
        withTemperatureSource: 0, suggestedCount: 0, typedCount: 0,
      });
      expect(empty.body.data.byDay).toHaveLength(2);
    });

    it('defaults to the last 7 kitchen days and counts labels created today', async () => {
      const productId = await newProduct();
      await newLabel(productId, { flowMs: 7_000, temperatureSource: 'DIGITADO' });
      const res = await metrics({ productId });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        from: daysFromToday(-6), to: today(), total: 1, withFlow: 1, flowMedianMs: 7_000, flowP90Ms: 7_000, typedCount: 1,
      });
      expect(res.body.data.byDay).toHaveLength(7);
      expect(res.body.data.byDay[6]).toEqual({ date: today(), total: 1, flowMedianMs: 7_000, suggestedCount: 0, typedCount: 1 });
    });

    it('puts a label created at 03:30Z on the previous kitchen day', async () => {
      const productId = await newProduct();
      const label = await newLabel(productId, { flowMs: 2_000, temperatureSource: 'DIGITADO' });
      const instant = new Date('2001-05-02T03:30:00.000Z');
      await prisma.label.update({ where: { id: label.id }, data: { createdAt: instant } });
      // Dia da cozinha desse instante (em America/Manaus, UTC−4: 01/05 às 23:30).
      const timeZone = process.env.KITCHEN_TIME_ZONE || 'America/Manaus';
      const kitchenDay = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
        .format(instant);
      if (timeZone === 'America/Manaus') expect(kitchenDay).toBe('2001-05-01');

      const res = await metrics({ productId, from: '2001-04-30', to: '2001-05-03' });
      expect(res.status).toBe(200);
      expect(res.body.data.total).toBe(1);
      const days = res.body.data.byDay as { date: string; total: number; flowMedianMs: number | null }[];
      expect(days.filter((day) => day.total > 0)).toEqual([
        { date: kitchenDay, total: 1, flowMedianMs: 2_000, suggestedCount: 0, typedCount: 1 },
      ]);
    });

    it('counts two splits of the same source on the same day as two actions', async () => {
      const productId = await newProduct();
      const parent = await newLabel(productId);
      const first = await split(parent.id, { count: 2, requestId: randomUUID(), flowMs: 1_000 });
      const second = await split(parent.id, { count: 2, requestId: randomUUID(), flowMs: 3_000 });
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      const ids = [parent.id, ...[...first.body.data.children, ...second.body.data.children].map((child: { id: string }) => child.id)];
      await moveTo(ids, '2001-06-10');

      const res = await metrics({ productId, from: '2001-06-10', to: '2001-06-10' });
      expect(res.body.data).toMatchObject({ total: 5, withFlow: 2, discardedFlows: 0, flowMedianMs: 2_000 });
    });

    it('keeps counting a split as one action when one of its children was cancelled', async () => {
      const productId = await newProduct();
      const parent = await newLabel(productId);
      const res = await split(parent.id, { count: 3, requestId: randomUUID(), flowMs: 4_000, temperatureSource: 'SUGERIDO' });
      expect(res.status).toBe(201);
      const childIds = res.body.data.children.map((child: { id: string }) => child.id) as string[];
      await request(app).post(`/api/labels/${childIds[0]}/close`).set('Authorization', asAdmin())
        .send({ outcome: 'CANCELADO' }).expect(200);
      await moveTo([parent.id, ...childIds], '2001-07-10');

      const report = await metrics({ productId, from: '2001-07-10', to: '2001-07-10' });
      expect(report.body.data).toMatchObject({
        total: 3, withFlow: 1, discardedFlows: 0, flowMedianMs: 4_000, flowP90Ms: 4_000, suggestedCount: 2,
      });
    });

    it('leaves flows above FLOW_PLAUSIBLE_MAX_MS out of the time and counts them in discardedFlows', async () => {
      const productId = await newProduct();
      const labels = await Promise.all([1_000, 3_000, 600_000, 700_000].map((flowMs) => newLabel(productId, { flowMs })));
      await moveTo(labels.map((label) => label.id), '2001-08-10');

      const res = await metrics({ productId, from: '2001-08-10', to: '2001-08-10' });
      // 600 000 (no teto) entra; 700 000 fica de fora da mediana, mas continua gravado.
      expect(res.body.data).toMatchObject({ total: 4, withFlow: 3, discardedFlows: 1, flowMedianMs: 3_000 });
      expect(res.body.data.byDay[0].flowMedianMs).toBe(3_000);
      const outlier = await prisma.label.findUniqueOrThrow({ where: { id: labels[3].id } });
      expect(outlier.flowMs).toBe(700_000);
      const csv = await request(app).get('/api/labels/export.csv').query({ productId, q: labels[3].shortCode })
        .set('Authorization', asAdmin());
      expect(csv.status).toBe(200);
      expect(csv.text).toContain('"700,0";""');
    });

    it('is only for admins and validates the period', async () => {
      expect((await metrics({}, operatorAuth)).status).toBe(403);
      expect((await request(app).get('/api/labels/metrics')).status).toBe(401);
      // 92 dias contando os dois extremos: aceito; 93: recusado.
      expect((await metrics({ from: '2001-01-01', to: '2001-04-02' })).status).toBe(200);
      const tooLong = await metrics({ from: '2001-01-01', to: '2001-04-03' });
      expect(tooLong.status).toBe(422);
      expect(tooLong.body.error.code).toBe('VALIDATION_ERROR');
      expect((await metrics({ from: daysFromToday(-92) })).status).toBe(422);
      expect((await metrics({ from: day2, to: day1 })).status).toBe(422);
      expect((await metrics({ from: '2001-02-30' })).status).toBe(422);
      expect((await metrics({ to: '10/03/2001' })).status).toBe(422);
      expect((await metrics({ productId: 'x' })).status).toBe(422);
    });
  });
});

describe('relatório do período para imprimir', () => {
  const tag = suffix.slice(0, 8);
  let adminToken = '';
  let operatorAuth = '';
  const asAdmin = () => `Bearer ${adminToken}`;
  const resetSettings = () => prisma.kitchenSettings.updateMany({ data: { kitchenName: null, technicalResponsible: null } });
  const putSettings = (body: object, token = asAdmin()) =>
    request(app).put('/api/settings').set('Authorization', token).send(body);
  const report = (query: Record<string, string>, token = asAdmin()) =>
    request(app).get('/api/labels/report').query(query).set('Authorization', token);
  const newProduct = async () => {
    // Prazos fictícios, só para o teste.
    const product = await prisma.product.create({
      data: { name: `Relatório ${tag} ${randomUUID().slice(0, 6)}`, brand: 'Teste', daysValidRefrigerated: 5, daysValidFrozen: 30 },
    });
    productIds.push(product.id);
    return product.id;
  };
  const newLabel = async (productId: string, body: object = {}) => {
    const res = await request(app).post('/api/labels').set('Authorization', asAdmin()).send({
      productId, lot: 'LOT-REL', originalExpiryDate: daysFromToday(60), openedAt: today(),
      responsibleName: 'Turno do relatório', storageType: 'REFRIGERADO', storageTemperature: 4, ...body,
    });
    expect(res.status).toBe(201);
    return res.body.data as { id: string; shortCode: string };
  };
  const close = (id: string, body: object) =>
    request(app).post(`/api/labels/${id}/close`).set('Authorization', asAdmin()).send(body).expect(200);
  // Um dia antigo sorteado por execução: nenhuma outra etiqueta do banco cai nele.
  const randomOldDay = () => isoDate(new Date(Date.UTC(1980, 0, 1) + Math.floor(Math.random() * 7000) * 86_400_000));
  const nextDay = (day: string) => isoDate(new Date(Date.parse(`${day}T00:00:00.000Z`) + 86_400_000));
  // Horas UTC entre 10 e 14: no mesmo dia em qualquer fuso de −10 a +9 h (a cozinha padrão é UTC−4).
  const moveTo = (ids: string[], day: string, hour = 12) =>
    prisma.label.updateMany({
      where: { id: { in: ids } }, data: { createdAt: new Date(`${day}T${String(hour).padStart(2, '0')}:00:00.000Z`) },
    });

  beforeAll(async () => {
    const login = await request(app).post('/api/auth/login').set('X-Forwarded-For', '198.51.100.90')
      .send({ email, password: 'TestPassword123!' });
    adminToken = login.body.data.accessToken;
    const operator = await request(app).post('/api/auth/login').set('X-Forwarded-For', '198.51.100.91')
      .send({ email: operatorEmail, password: 'TestPassword123!' });
    operatorAuth = `Bearer ${operator.body.data.accessToken as string}`;
  });
  afterEach(() => { vi.restoreAllMocks(); });
  afterAll(resetSettings);

  it('stores the kitchen name and technical responsible: trim, empty → null, more than 80 → 422', async () => {
    const set = await putSettings({ kitchenName: '  Cozinha Central  ', technicalResponsible: 'Nutricionista de Teste' });
    expect(set.status).toBe(200);
    expect(set.body.data).toMatchObject({ kitchenName: 'Cozinha Central', technicalResponsible: 'Nutricionista de Teste' });
    const got = await request(app).get('/api/settings').set('Authorization', operatorAuth);
    expect(got.body.data).toMatchObject({ kitchenName: 'Cozinha Central', technicalResponsible: 'Nutricionista de Teste' });
    expect((await report({})).body.data.kitchen)
      .toEqual({ name: 'Cozinha Central', technicalResponsible: 'Nutricionista de Teste' });

    // Parcial: só o nome muda; só espaços vira null.
    const blank = await putSettings({ kitchenName: '   ' });
    expect(blank.status).toBe(200);
    expect(blank.body.data).toMatchObject({ kitchenName: null, technicalResponsible: 'Nutricionista de Teste' });
    const cleared = await putSettings({ technicalResponsible: null });
    expect(cleared.body.data).toMatchObject({ kitchenName: null, technicalResponsible: null });

    expect((await putSettings({ kitchenName: 'x'.repeat(80) })).status).toBe(200);
    const tooLong = await putSettings({ kitchenName: 'x'.repeat(81) });
    expect(tooLong.status).toBe(422);
    expect(tooLong.body.error.message).toBe('O nome da cozinha deve ter no máximo 80 caracteres.');
    // O trim vem antes da contagem: 81 letras com espaços em volta continuam passando do limite.
    const tooLongResp = await putSettings({ technicalResponsible: ` ${'y'.repeat(81)} ` });
    expect(tooLongResp.status).toBe(422);
    expect(tooLongResp.body.error.message).toBe('O responsável técnico deve ter no máximo 80 caracteres.');
    expect((await putSettings({ kitchenName: 12 })).status).toBe(422);
    expect((await putSettings({ kitchenName: 'Outra' }, operatorAuth)).status).toBe(403);
    expect((await request(app).get('/api/settings').set('Authorization', asAdmin())).body.data.kitchenName)
      .toBe('x'.repeat(80));
    await resetSettings();
  });

  it('defaults to the last 7 kitchen days, oldest first', async () => {
    const productId = await newProduct();
    const first = await newLabel(productId);
    const second = await newLabel(productId);
    const res = await report({});
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ from: daysFromToday(-6), to: today(), today: today() });
    expect(Number.isNaN(Date.parse(res.body.data.generatedAt))).toBe(false);
    const rows = res.body.data.rows as { id: string; createdAt: string }[];
    expect(res.body.data.summary.total).toBe(rows.length);
    const ids = rows.map((row) => row.id);
    expect(ids.indexOf(first.id)).toBeGreaterThanOrEqual(0);
    // Criada hoje com a validade digitada (sem lote cadastrado).
    expect(rows.find((row) => row.id === first.id)).toMatchObject({ lotSource: 'informado', noRule: true });
    expect(ids.indexOf(first.id)).toBeLessThan(ids.indexOf(second.id));
    expect(rows.map((row) => row.createdAt)).toEqual([...rows.map((row) => row.createdAt)].sort());

    // Só um extremo: o outro segue o padrão de metrics (to = hoje; from = to − 6).
    expect((await report({ to: '2001-03-10' })).body.data).toMatchObject({ from: '2001-03-04', to: '2001-03-10' });
    expect((await report({ from: daysFromToday(-2) })).body.data).toMatchObject({ from: daysFromToday(-2), to: today() });
  });

  it('counts every situation over the same rows, cancelled included', async () => {
    const productId = await newProduct();
    const ruleRes = await request(app).post('/api/shelf-life-rules').set('Authorization', asAdmin()).send({
      ...ruleBody, productId, storageType: 'CONGELADO', shelfLifeDays: 20, minTemperature: -30, maxTemperature: -12,
    });
    expect(ruleRes.status).toBe(201);
    ruleIds.push(ruleRes.body.data.id);

    const active = await newLabel(productId, { temperatureSource: 'SUGERIDO' });
    const expired = await newLabel(productId, { temperatureSource: 'DIGITADO' });
    const used = await newLabel(productId);
    const sensorial = await newLabel(productId, { temperatureSource: 'DIGITADO' });
    const other = await newLabel(productId);
    const cancelled = await newLabel(productId, { temperatureSource: 'SUGERIDO' });
    const frozen = await newLabel(productId, { storageType: 'CONGELADO', storageTemperature: -18 });
    await close(used.id, { outcome: 'USADO' });
    await close(sensorial.id, { outcome: 'DESCARTADO', discardReason: 'ALTERACAO_SENSORIAL' });
    await close(other.id, { outcome: 'DESCARTADO', discardReason: 'OUTRO', note: 'Caiu no chão' });
    await close(cancelled.id, { outcome: 'CANCELADO' });
    // Uma ativa com o descarte antes de hoje; e uma com operador confirmado por PIN.
    await prisma.label.update({ where: { id: expired.id }, data: { discardAt: new Date(`${daysFromToday(-1)}T00:00:00.000Z`) } });
    await prisma.label.update({ where: { id: frozen.id }, data: { handlerId: operatorId } });
    const split = await request(app).post(`/api/labels/${frozen.id}/split`).set('Authorization', asAdmin())
      .send({ count: 1, storageType: 'CONGELADO', storageTemperature: -18, responsibleName: 'Fracionador' });
    expect(split.status).toBe(201);
    const child = split.body.data.children[0] as { id: string; shortCode: string };

    const day = randomOldDay();
    const next = nextDay(day);
    await moveTo([active.id], day, 10);
    await moveTo([expired.id], day, 11);
    await moveTo([used.id], day, 12);
    await moveTo([sensorial.id], day, 13);
    await moveTo([other.id, cancelled.id, frozen.id], day, 14);
    await moveTo([child.id], next);

    // O dia sorteado é antigo: com o corte real (migração do encerramento aplicada hoje no banco de teste),
    // as ativas são "anteriores ao encerramento" e não contam como vencidas sem encerrar.
    const withRealCutoff = await report({ from: day, to: next });
    expect(withRealCutoff.body.data.summary).toMatchObject({ active: 0, activeExpired: 0, activeBeforeClosing: 4 });
    expect(withRealCutoff.body.data.rows.find((row: { id: string }) => row.id === expired.id).beforeClosing).toBe(true);

    // Com o corte antes do dia sorteado, as mesmas linhas contam como ativas de verdade.
    const closeMigration = '20261115000000_label_close_split';
    const [original] = await prisma.$queryRaw<{ finished_at: Date }[]>`
      SELECT finished_at FROM _prisma_migrations WHERE migration_name = ${closeMigration}`;
    await prisma.$executeRaw`UPDATE _prisma_migrations SET finished_at = '1970-01-02' WHERE migration_name = ${closeMigration}`;
    resetMigrationCutoffsForTests();
    let res: Awaited<ReturnType<typeof report>>;
    try {
      res = await report({ from: day, to: next });
    } finally {
      await prisma.$executeRaw`UPDATE _prisma_migrations SET finished_at = ${original.finished_at} WHERE migration_name = ${closeMigration}`;
      resetMigrationCutoffsForTests();
    }
    expect(res.status).toBe(200);
    expect(res.body.data.summary).toEqual({
      total: 8, active: 4, activeExpired: 1, activeBeforeClosing: 0, used: 1, discarded: 2, cancelled: 1,
      discardedByReason: { PRAZO_VENCIDO: 0, ALTERACAO_SENSORIAL: 1, EMBALAGEM_DANIFICADA: 0, OUTRO: 1 },
      handlerVerified: 1, withoutRule: 6,
      // Sem a cancelada (SUGERIDO): 1 sugerida, 2 digitadas, 4 sem registro.
      temperatureSuggested: 1, temperatureTyped: 2, temperatureUnknown: 4,
    });
    const rows = res.body.data.rows as Record<string, unknown>[];
    expect(rows).toHaveLength(8);
    // Ordem de criação; os três criados no mesmo instante ficam entre o 4º e a filha.
    expect(rows.slice(0, 4).map((row) => row.id)).toEqual([active.id, expired.id, used.id, sensorial.id]);
    expect(rows.slice(4, 7).map((row) => row.id).sort()).toEqual([other.id, cancelled.id, frozen.id].sort());
    expect(rows[7].id).toBe(child.id);

    const row = (id: string) => rows.find((item) => item.id === id)!;
    expect(row(other.id)).toMatchObject({
      shortCode: other.shortCode, status: 'ENCERRADA', outcome: 'DESCARTADO', discardReason: 'OUTRO',
      closeNote: 'Caiu no chão', noRule: true, handlerVerified: false,
      // Criada (pelo teste) antes da migração dos lotes, sem lote cadastrado: igual à lista, "anterior".
      lotSource: 'anterior', lot: 'LOT-REL',
      storageTemp: '4,0 °C', openedAt: today(), discardAt: daysFromToday(4), shelfLifeDays: 5, ruleVersion: null,
      parentShortCode: null, responsibleName: 'Turno do relatório', closedByName: 'Teste de integração',
      productBrand: 'Teste', storageType: 'REFRIGERADO',
    });
    expect(typeof row(other.id).closedAt).toBe('string');
    expect(row(cancelled.id)).toMatchObject({ status: 'ENCERRADA', outcome: 'CANCELADO' });
    expect(row(active.id)).toMatchObject({ status: 'ATIVA', outcome: null, closedAt: null, createdAt: `${day}T10:00:00.000Z` });
    expect(row(expired.id)).toMatchObject({ status: 'ATIVA', discardAt: daysFromToday(-1) });
    expect(row(frozen.id)).toMatchObject({ noRule: false, ruleVersion: 1, handlerVerified: true, storageType: 'CONGELADO' });
    expect(row(child.id)).toMatchObject({ parentShortCode: frozen.shortCode, noRule: false, status: 'ATIVA', lotSource: 'anterior' });

    // Só o segundo dia: só a filha.
    const single = await report({ from: next, to: next });
    expect(single.body.data.summary).toMatchObject({ total: 1, active: 0, activeBeforeClosing: 1, withoutRule: 0 });
  });

  it('is only for admins and validates the period', async () => {
    expect((await report({}, operatorAuth)).status).toBe(403);
    expect((await request(app).get('/api/labels/report')).status).toBe(401);
    // 31 dias contando os dois extremos: aceito; 32: recusado.
    expect((await report({ from: '2001-01-01', to: '2001-01-31' })).status).toBe(200);
    const tooLong = await report({ from: '2001-01-01', to: '2001-02-01' });
    expect(tooLong.status).toBe(422);
    expect(tooLong.body.error.message).toBe('O período do relatório é de no máximo 31 dias.');
    const reversed = await report({ from: '2001-01-10', to: '2001-01-09' });
    expect(reversed.status).toBe(422);
    expect(reversed.body.error.message).toBe('A data inicial deve ser menor ou igual à data final.');
    // Só o início, no futuro: o fim padrão (hoje) fica antes dele.
    expect((await report({ from: daysFromToday(1) })).status).toBe(422);
    expect((await report({ from: '2001-02-30' })).status).toBe(422);
  });

  it('refuses a period with more than 2,000 labels before fetching the rows', async () => {
    const count = vi.spyOn(prisma.label, 'count').mockResolvedValueOnce(2_001);
    const findMany = vi.spyOn(prisma.label, 'findMany');
    const res = await report({ from: '2001-01-01', to: '2001-01-02' });
    expect(count).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(422);
    expect(res.body.error.message).toBe('O período tem mais de 2.000 etiquetas. Escolha um período menor.');
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe('plano B: queda de conexão e registro de contingência', () => {
  const tag = suffix.slice(0, 8);
  let adminToken = '';
  let operatorAuth = '';
  let noRuleId = '';
  let ruleProductId = '';
  let inactiveId = '';
  let ruleId = '';
  const asAdmin = () => `Bearer ${adminToken}`;
  const HOUR = 3_600_000;
  const DAY = 86_400_000;
  const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
  const kitchenDayOf = (iso: string) => isoDate(kitchenToday(new Date(iso)));
  const plusDays = (day: string, days: number) => isoDate(new Date(Date.parse(`${day}T00:00:00.000Z`) + days * DAY));
  const reportOutage = (body: object, token = asAdmin()) =>
    request(app).post('/api/contingency/outages').set('Authorization', token).send(body);
  const recordBody = (productId: string, body: object = {}) => ({
    productId, storageType: 'REFRIGERADO', lot: 'LOT-PAPEL', originalExpiryDate: daysFromToday(60),
    openedAt: ago(60_000), responsibleName: 'Cozinheira do papel', paperRef: 'folha 3, linha 5', outcome: 'EM_USO',
    ...body,
  });
  const preview = (productId: string, body: object = {}, token = asAdmin()) =>
    request(app).post('/api/contingency/records/preview').set('Authorization', token).send(recordBody(productId, body));
  const create = (productId: string, body: object = {}, token = asAdmin()) =>
    request(app).post('/api/contingency/records').set('Authorization', token).send(recordBody(productId, body));
  const closeRecord = (id: string, body: object) =>
    request(app).post(`/api/contingency/records/${id}/close`).set('Authorization', asAdmin()).send(body);
  const listRecords = (status?: string) => request(app).get('/api/contingency/records')
    .query(status ? { status } : {}).set('Authorization', asAdmin());
  const resetSettings = () => prisma.kitchenSettings.updateMany({ data: { requireValidatedRule: false } });

  beforeAll(async () => {
    const login = await request(app).post('/api/auth/login').set('X-Forwarded-For', '198.51.100.120')
      .send({ email, password: 'TestPassword123!' });
    adminToken = login.body.data.accessToken;
    const operator = await request(app).post('/api/auth/login').set('X-Forwarded-For', '198.51.100.121')
      .send({ email: operatorEmail, password: 'TestPassword123!' });
    operatorAuth = `Bearer ${operator.body.data.accessToken as string}`;
    // Prazos fictícios, só para o teste.
    const product = async (name: string, data: { active?: boolean } = {}) => {
      const created = await prisma.product.create({
        data: { name: `${name} ${tag}`, brand: 'Teste', daysValidRefrigerated: 3, daysValidFrozen: 30, ...data },
      });
      productIds.push(created.id);
      return created.id;
    };
    noRuleId = await product('Contingência sem regra');
    ruleProductId = await product('Contingência com regra');
    inactiveId = await product('Contingência inativo', { active: false });
    const rule = await request(app).post('/api/shelf-life-rules').set('Authorization', asAdmin())
      .send({ ...ruleBody, shelfLifeDays: 5, storageType: 'REFRIGERADO', productId: ruleProductId });
    expect(rule.status).toBe(201);
    ruleId = rule.body.data.id;
    ruleIds.push(ruleId);
  });
  afterEach(resetSettings);
  afterAll(resetSettings);

  it('lets any logged-in device report an outage, but only admins list, review and record', async () => {
    expect((await request(app).post('/api/contingency/outages').send({ durationMs: 120_000 })).status).toBe(401);
    const reported = await reportOutage({ durationMs: 120_000 }, operatorAuth);
    expect(reported.status).toBe(201);
    expect(reported.body.data).toMatchObject({ durationMs: 120_000, reportedByName: 'Operador de integração', reviewedAt: null });
    const { reportedAt, startedAt } = reported.body.data;
    expect(Date.parse(reportedAt) - Date.parse(startedAt)).toBe(120_000);

    expect((await request(app).get('/api/contingency/outages').set('Authorization', operatorAuth)).status).toBe(403);
    expect((await request(app).post(`/api/contingency/outages/${reported.body.data.id}/review`)
      .set('Authorization', operatorAuth)).status).toBe(403);
    expect((await request(app).get('/api/contingency/records').set('Authorization', operatorAuth)).status).toBe(403);
    expect((await preview(noRuleId, {}, operatorAuth)).status).toBe(403);
    expect((await create(noRuleId, {}, operatorAuth)).status).toBe(403);
    expect((await request(app).post(`/api/contingency/records/${randomUUID()}/close`)
      .set('Authorization', operatorAuth).send({ outcome: 'USADO' })).status).toBe(403);
  });

  it('validates the outage duration and returns the same outage on a resend within 60 s', async () => {
    for (const body of [
      { durationMs: 59_999 }, { durationMs: 7 * DAY + 1 }, { durationMs: 90_000.5 }, { durationMs: '90000' },
      {}, { durationMs: 90_000, reportedAt: ago(0) },
    ]) {
      const res = await reportOutage(body);
      expect(res.status, JSON.stringify(body)).toBe(422);
    }
    const first = await reportOutage({ durationMs: 7 * DAY });
    expect(first.status).toBe(201);
    const resend = await reportOutage({ durationMs: 60_000 });
    expect(resend.status).toBe(200);
    expect(resend.body.data).toMatchObject({ id: first.body.data.id, durationMs: 7 * DAY });

    // Passado o intervalo, é uma queda nova.
    await prisma.connectivityOutage.update({ where: { id: first.body.data.id }, data: { reportedAt: new Date(Date.now() - 61_000) } });
    const later = await reportOutage({ durationMs: 60_000 });
    expect(later.status).toBe(201);
    expect(later.body.data.id).not.toBe(first.body.data.id);

    // Reenvio atrasado: o início desconta há quanto tempo a rede voltou (até 24 h).
    await prisma.connectivityOutage.update({ where: { id: later.body.data.id }, data: { reportedAt: new Date(Date.now() - 61_000) } });
    expect((await reportOutage({ durationMs: 60_000, endedAgoMs: DAY + 1 })).status).toBe(422);
    const delayed = await reportOutage({ durationMs: 300_000, endedAgoMs: 3_600_000 });
    expect(delayed.status).toBe(201);
    expect(Date.parse(delayed.body.data.reportedAt) - Date.parse(delayed.body.data.startedAt)).toBe(3_900_000);
  });

  it('lists outages (pending filter, pendingCount) and reviews them idempotently', async () => {
    const mine = await prisma.connectivityOutage.findFirstOrThrow({ where: { reportedById: operatorId } });
    const list = (query: Record<string, string> = {}) =>
      request(app).get('/api/contingency/outages').query(query).set('Authorization', asAdmin());
    const pending = await list({ pending: 'true' });
    expect(pending.status).toBe(200);
    expect(pending.body.data.some((item: { id: string }) => item.id === mine.id)).toBe(true);
    expect(pending.body.data.every((item: { reviewedAt: string | null }) => item.reviewedAt === null)).toBe(true);
    const pendingCount = pending.body.meta.pendingCount as number;
    expect(pendingCount).toBeGreaterThanOrEqual(1);

    const review = () => request(app).post(`/api/contingency/outages/${mine.id}/review`).set('Authorization', asAdmin());
    const reviewed = await review();
    expect(reviewed.status).toBe(200);
    expect(reviewed.body.data).toMatchObject({ id: mine.id, reviewedByName: 'Teste de integração' });
    expect(reviewed.body.data.reviewedAt).not.toBeNull();
    const again = await review();
    expect(again.status).toBe(200);
    expect(again.body.data.reviewedAt).toBe(reviewed.body.data.reviewedAt);

    const after = await list({ pending: 'true' });
    expect(after.body.data.some((item: { id: string }) => item.id === mine.id)).toBe(false);
    expect(after.body.meta.pendingCount).toBe(pendingCount - 1);
    const done = await list({ pending: 'false' });
    expect(done.body.data.some((item: { id: string }) => item.id === mine.id)).toBe(true);
    const all = await list();
    expect(all.body.data.length).toBeLessThanOrEqual(100);
    expect((await list({ pending: 'talvez' })).status).toBe(422);
    expect((await request(app).post(`/api/contingency/outages/${randomUUID()}/review`)
      .set('Authorization', asAdmin())).status).toBe(404);
  });

  it('uses the same rule resolution as the label and is never blocked by RULE_REQUIRED', async () => {
    const on = await request(app).put('/api/settings').set('Authorization', asAdmin()).send({ requireValidatedRule: true });
    expect(on.status).toBe(200);
    // A etiqueta seria recusada; o registro de contingência não.
    const labelPreview = await request(app).post('/api/labels/preview').set('Authorization', asAdmin()).send({
      productId: noRuleId, originalExpiryDate: daysFromToday(60), openedAt: today(), storageType: 'REFRIGERADO',
    });
    expect(labelPreview.body.error.code).toBe('RULE_REQUIRED');

    const openedAt = ago(60_000);
    const openedDate = kitchenDayOf(openedAt);
    const noRule = await preview(noRuleId, { openedAt });
    expect(noRule.status).toBe(200);
    expect(noRule.body.data).toMatchObject({
      shelfLifeDays: 3, openedDate, discardAt: plusDays(openedDate, 2), cappedByOriginalExpiry: false, expired: false,
      rule: { id: null, version: null, validated: false, source: 'Prazo cadastrado no produto (sem regra validada)' },
    });
    const created = await create(noRuleId, { openedAt, note: 'Folha achada no balcão' });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      productId: noRuleId, productName: `Contingência sem regra ${tag}`, productBrand: 'Teste', lot: 'LOT-PAPEL',
      openedAt, openedDate, discardAt: plusDays(openedDate, 2), shelfLifeDays: 3, ruleId: null, ruleVersion: null,
      ruleSource: 'Prazo cadastrado no produto (sem regra validada)', ruleValidated: false, outcome: 'EM_USO',
      responsibleName: 'Cozinheira do papel', paperRef: 'folha 3, linha 5', note: 'Folha achada no balcão',
      closedAt: null, closedByName: null, createdByName: 'Teste de integração', createdById: userId, expired: false,
    });

    const withRule = await create(ruleProductId, { openedAt });
    expect(withRule.status).toBe(201);
    expect(withRule.body.data).toMatchObject({
      shelfLifeDays: 5, discardAt: plusDays(openedDate, 4), ruleId, ruleVersion: 1,
      ruleSource: 'Regra de teste de integração', ruleValidated: true,
    });
    const rulePreview = await preview(ruleProductId, { openedAt });
    expect(rulePreview.body.data.rule).toEqual({ id: ruleId, version: 1, source: 'Regra de teste de integração', validated: true });

    // Não é etiqueta: nada foi criado em /labels.
    // SQL direto: um teste anterior espiona `prisma.label.count`.
    const labels = await prisma.$queryRaw<{ n: number }[]>`
      SELECT COUNT(*)::int AS n FROM labels WHERE product_id IN (${noRuleId}, ${ruleProductId})`;
    expect(labels[0].n).toBe(0);
  });

  it('accepts an opening 3 days ago (beyond MAX_BACKDATE_DAYS) and refuses the future and more than 30 days', async () => {
    const threeDaysAgo = ago(3 * DAY);
    const openedDate = kitchenDayOf(threeDaysAgo);
    const labelPreview = await request(app).post('/api/labels/preview').set('Authorization', asAdmin()).send({
      productId: ruleProductId, originalExpiryDate: daysFromToday(60), openedAt: openedDate, storageType: 'REFRIGERADO',
    });
    expect(labelPreview.status).toBe(422);

    const res = await create(ruleProductId, { openedAt: threeDaysAgo });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ openedDate, discardAt: plusDays(openedDate, 4), expired: false });

    const future = await preview(ruleProductId, { openedAt: new Date(Date.now() + 10 * 60_000).toISOString() });
    expect(future.status).toBe(422);
    expect(future.body.error.message).toBe('A abertura não pode ser no futuro.');
    const tooOld = await create(ruleProductId, { openedAt: ago(31 * DAY), outcome: 'USADO' });
    expect(tooOld.status).toBe(422);
    expect(tooOld.body.error.message).toBe('A abertura não pode ser de mais de 30 dias atrás.');
    expect((await preview(ruleProductId, { openedAt: ago(29 * DAY) })).status).toBe(200);
  });

  it('caps at the manufacturer expiry and refuses EM_USO when the deadline has passed', async () => {
    const capped = await preview(ruleProductId, { originalExpiryDate: today() });
    expect(capped.status).toBe(200);
    expect(capped.body.data).toMatchObject({ discardAt: today(), cappedByOriginalExpiry: true, expired: false });

    // Sem regra, 3 dias: aberto há 3 dias vence ontem.
    const openedAt = ago(3 * DAY);
    const expiredPreview = await preview(noRuleId, { openedAt });
    expect(expiredPreview.body.data).toMatchObject({ discardAt: daysFromToday(-1), expired: true });
    const inUse = await create(noRuleId, { openedAt });
    expect(inUse.status).toBe(422);
    expect(inUse.body.error.message).toBe('O prazo já venceu: registre como descartado ou usado.');

    const used = await create(noRuleId, { openedAt, outcome: 'USADO' });
    expect(used.status).toBe(201);
    expect(used.body.data).toMatchObject({ outcome: 'USADO', closedByName: 'Teste de integração', expired: true });
    expect(used.body.data.closedAt).not.toBeNull();
    const discarded = await create(noRuleId, { openedAt, outcome: 'DESCARTADO', discardReason: 'PRAZO_VENCIDO' });
    expect(discarded.status).toBe(201);
    expect(discarded.body.data).toMatchObject({ outcome: 'DESCARTADO', discardReason: 'PRAZO_VENCIDO' });
  });

  it('validates the record body', async () => {
    const invalid = [
      { outcome: 'DESCARTADO' },
      { outcome: 'DESCARTADO', discardReason: 'OUTRO', note: 'ab' },
      { outcome: 'USADO', discardReason: 'PRAZO_VENCIDO' },
      { outcome: 'CANCELADO' },
      { openedAt: today() },
      { openedAt: '2026-11-20T10:00:00' },
      { lot: '' }, { lot: 'x'.repeat(61) }, { lot: 'a\u0000b' },
      { responsibleName: 'A' }, { responsibleName: 'x'.repeat(81) },
      { paperRef: 'x'.repeat(81) }, { note: 'x'.repeat(301) },
      { originalExpiryDate: '2026-02-30' },
      { outageId: 'abc' },
      { storageTemperature: 4 },
      { lotId: randomUUID() },
    ];
    for (const body of invalid) {
      const res = await create(noRuleId, body);
      expect(res.status, JSON.stringify(body)).toBe(422);
    }
    const other = await create(noRuleId, { outcome: 'DESCARTADO', discardReason: 'OUTRO', note: 'Caiu no chão' });
    expect(other.status).toBe(201);
    // Abertura depois da validade do fabricante: mesmo cálculo da etiqueta.
    expect((await create(noRuleId, { originalExpiryDate: daysFromToday(-5) })).status).toBe(422);
  });

  it('accepts an inactive product, refuses an unknown one and links the outage', async () => {
    const inactive = await create(inactiveId);
    expect(inactive.status).toBe(201);
    expect((await create(randomUUID())).status).toBe(404);
    expect((await create(noRuleId, { outageId: randomUUID() })).status).toBe(404);

    const outage = await prisma.connectivityOutage.findFirstOrThrow({ where: { reportedById: userId } });
    const linked = await create(noRuleId, { outageId: outage.id });
    expect(linked.status).toBe(201);
    expect(linked.body.data.outageId).toBe(outage.id);
  });

  it('closes only from EM_USO, idempotent for the same outcome, 409 otherwise', async () => {
    const open = await create(ruleProductId, { note: 'Aberto no turno da noite' });
    expect(open.status).toBe(201);
    const id = open.body.data.id as string;

    expect((await closeRecord(id, { outcome: 'EM_USO' })).status).toBe(422);
    expect((await closeRecord(id, { outcome: 'DESCARTADO' })).status).toBe(422);
    expect((await closeRecord(id, { outcome: 'USADO', extra: true })).status).toBe(422);

    const closed = await closeRecord(id, { outcome: 'DESCARTADO', discardReason: 'ALTERACAO_SENSORIAL', note: 'Cheiro alterado' });
    expect(closed.status).toBe(200);
    expect(closed.body.data).toMatchObject({
      outcome: 'DESCARTADO', discardReason: 'ALTERACAO_SENSORIAL', closedByName: 'Teste de integração',
      note: 'Aberto no turno da noite\nEncerramento: Cheiro alterado',
    });
    const again = await closeRecord(id, { outcome: 'DESCARTADO', discardReason: 'ALTERACAO_SENSORIAL' });
    expect(again.status).toBe(200);
    expect(again.body.data.closedAt).toBe(closed.body.data.closedAt);
    expect((await closeRecord(id, { outcome: 'USADO' })).status).toBe(409);
    expect((await closeRecord(id, { outcome: 'DESCARTADO', discardReason: 'OUTRO', note: 'Outro motivo' })).status).toBe(409);
    expect((await closeRecord(randomUUID(), { outcome: 'USADO' })).status).toBe(404);
  });

  it('lists EM_USO first by discard date, then closed ones newest first, each with expired', async () => {
    const later = await create(ruleProductId);
    const sooner = await create(ruleProductId, { originalExpiryDate: today() });
    const closedOld = await create(noRuleId, { outcome: 'USADO' });
    const closedNew = await create(noRuleId, { outcome: 'USADO' });
    for (const res of [later, sooner, closedOld, closedNew]) expect(res.status).toBe(201);
    await prisma.contingencyRecord.update({ where: { id: closedOld.body.data.id }, data: { createdAt: new Date(Date.now() - HOUR) } });

    type Item = { id: string; outcome: string; discardAt: string; createdAt: string; expired: boolean };
    const all = await listRecords('all');
    expect(all.status).toBe(200);
    const items = all.body.data as Item[];
    expect(items.length).toBeLessThanOrEqual(200);
    const firstClosed = items.findIndex((item) => item.outcome !== 'EM_USO');
    const lastOpen = items.map((item) => item.outcome).lastIndexOf('EM_USO');
    if (firstClosed !== -1) expect(lastOpen).toBeLessThan(firstClosed);
    const open = items.filter((item) => item.outcome === 'EM_USO');
    expect(open.map((item) => item.discardAt)).toEqual([...open.map((item) => item.discardAt)].sort());
    const closed = items.filter((item) => item.outcome !== 'EM_USO');
    expect(closed.map((item) => item.createdAt)).toEqual([...closed.map((item) => item.createdAt)].sort().reverse());
    const position = (id: string) => items.findIndex((item) => item.id === id);
    expect(position(sooner.body.data.id)).toBeLessThan(position(later.body.data.id));
    expect(position(closedNew.body.data.id)).toBeLessThan(position(closedOld.body.data.id));
    expect(items.every((item) => typeof item.expired === 'boolean')).toBe(true);

    const onlyOpen = await listRecords('open');
    expect(onlyOpen.body.data.every((item: Item) => item.outcome === 'EM_USO')).toBe(true);
    expect(onlyOpen.body.data.some((item: Item) => item.id === later.body.data.id)).toBe(true);
    expect((await listRecords('closed')).status).toBe(422);
  });
});
