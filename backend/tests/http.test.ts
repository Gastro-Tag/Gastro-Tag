import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import app from '../src/app';
import { accessLog } from '../src/middlewares/accessLog';
import { logger } from '../src/utils/logger';

// Sem banco: tudo aqui falha antes de chegar ao Prisma.

describe('corpo da requisição', () => {
  it('answers 400 INVALID_JSON for malformed JSON instead of 500', async () => {
    const res = await request(app).post('/api/auth/login')
      .set('Content-Type', 'application/json').send('{"email": "a@b.test",');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, error: { message: 'JSON inválido.', code: 'INVALID_JSON' } });
  });

  it('answers 413 for a body above the limit', async () => {
    const res = await request(app).post('/api/auth/login')
      .set('Content-Type', 'application/json').send(JSON.stringify({ email: 'a@b.test', password: 'x'.repeat(200_000) }));
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });
});

describe('validação (zod 4)', () => {
  it('keeps the 422 format and the custom messages', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'sem-arroba', password: 'abcdefgh' });
    expect(res.status).toBe(422);
    expect(res.body).toEqual({ success: false, error: { message: 'E-mail inválido.', code: 'VALIDATION_ERROR' } });
  });

  it('uses Portuguese default messages when the schema has none', async () => {
    const res = await request(app).post('/api/auth/refresh').send({});
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toContain('Entrada inválida');
  });
});

describe('log de acesso', () => {
  afterEach(() => vi.restoreAllMocks());

  it('logs method, path, status, time and IP without query string or body', async () => {
    const info = vi.spyOn(logger, 'info').mockImplementation(() => logger);
    const mini = express();
    mini.use(accessLog);
    mini.use(express.json());
    mini.post('/api/x', (_req, res) => { res.status(201).json({ ok: true }); });
    mini.get('/health', (_req, res) => { res.json({ status: 'ok' }); });

    await request(mini).post('/api/x?token=segredo-na-query').send({ password: 'segredo-no-corpo' }).expect(201);
    await request(mini).get('/health').expect(200);

    expect(info).toHaveBeenCalledTimes(1);
    const [message, meta] = info.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(meta).toMatchObject({ type: 'access', method: 'POST', path: '/api/x', status: 201 });
    expect(typeof meta.durationMs).toBe('number');
    expect(typeof meta.ip).toBe('string');
    expect(message).toMatch(/^POST \/api\/x 201 /);
    const logged = JSON.stringify(info.mock.calls);
    expect(logged).not.toContain('segredo');
  });
});
