import axios, { AxiosError } from 'axios';
import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, extractError } from './api';

type Reply = { status: number; data?: unknown };
type Handler = (config: InternalAxiosRequestConfig) => Reply | Promise<Reply>;

function makeAdapter(handler: Handler): AxiosAdapter {
  return async (config) => {
    const { status, data } = await handler(config);
    const response = { data, status, statusText: String(status), headers: {}, config, request: {} };
    if (status >= 200 && status < 300) return response;
    throw new AxiosError(`status ${status}`, String(status), config, {}, response as any);
  };
}

const hrefSetter = vi.fn();
let refreshCalls: number;

function install(handler: Handler) {
  const adapter = makeAdapter(handler);
  api.defaults.adapter = adapter;
  axios.defaults.adapter = adapter; // o refresh usa o axios global
}

function fakeLocation(pathname: string) {
  return { pathname, set href(v: string) { hrefSetter(v); } };
}

beforeEach(() => {
  refreshCalls = 0;
  hrefSetter.mockReset();
  vi.stubGlobal('location', fakeLocation('/painel'));
  localStorage.setItem('accessToken', 'old');
  localStorage.setItem('refreshToken', 'r1');
});

describe('interceptor de 401', () => {
  it('anexa o token de acesso', async () => {
    let auth: unknown;
    install((c) => { auth = c.headers.Authorization; return { status: 200, data: {} }; });
    await api.get('/x');
    expect(auth).toBe('Bearer old');
  });

  it('401 paralelos fazem um único refresh e repetem com o novo token', async () => {
    install(async (c) => {
      if (c.url?.includes('/auth/refresh')) {
        refreshCalls++;
        await new Promise((r) => setTimeout(r, 20));
        return { status: 200, data: { data: { accessToken: 'new', refreshToken: 'r2' } } };
      }
      return c.headers.Authorization === 'Bearer new'
        ? { status: 200, data: { ok: c.url } }
        : { status: 401 };
    });
    const results = await Promise.all([api.get('/a'), api.get('/b'), api.get('/c')]);
    expect(refreshCalls).toBe(1);
    expect(results.map((r) => r.data.ok)).toEqual(['/a', '/b', '/c']);
    expect(localStorage.getItem('accessToken')).toBe('new');
    expect(localStorage.getItem('refreshToken')).toBe('r2');
    expect(hrefSetter).not.toHaveBeenCalled();
  });

  it('refresh recusado (401) faz logout e rejeita', async () => {
    install(() => ({ status: 401 }));
    await expect(api.get('/a')).rejects.toBeTruthy();
    expect(localStorage.getItem('accessToken')).toBeNull();
    expect(localStorage.getItem('refreshToken')).toBeNull();
    expect(hrefSetter).toHaveBeenCalledWith('/login');
  });

  it('no totem o logout vai para /totem/login', async () => {
    vi.stubGlobal('location', fakeLocation('/totem/home'));
    install(() => ({ status: 401 }));
    await expect(api.get('/a')).rejects.toBeTruthy();
    expect(hrefSetter).toHaveBeenCalledWith('/totem/login');
  });

  it('sem refresh token faz logout sem chamar o refresh', async () => {
    localStorage.removeItem('refreshToken');
    install((c) => { if (c.url?.includes('/auth/refresh')) refreshCalls++; return { status: 401 }; });
    await expect(api.get('/a')).rejects.toBeTruthy();
    expect(refreshCalls).toBe(0);
    expect(hrefSetter).toHaveBeenCalledWith('/login');
  });

  it('falha de rede no refresh não desconecta', async () => {
    install((c) => {
      if (c.url?.includes('/auth/refresh')) throw new AxiosError('Network Error', 'ERR_NETWORK', c);
      return { status: 401 };
    });
    await expect(api.get('/a')).rejects.toBeTruthy();
    expect(localStorage.getItem('refreshToken')).toBe('r1');
    expect(hrefSetter).not.toHaveBeenCalled();
  });

  it('401 de /auth/login não tenta refresh', async () => {
    install((c) => { if (c.url?.includes('/auth/refresh')) refreshCalls++; return { status: 401 }; });
    await expect(api.post('/auth/login', {})).rejects.toBeTruthy();
    expect(refreshCalls).toBe(0);
  });

  it('não repete indefinidamente se continua 401 após o refresh', async () => {
    let calls = 0;
    install((c) => {
      if (c.url?.includes('/auth/refresh')) return { status: 200, data: { data: { accessToken: 'n', refreshToken: 'r' } } };
      calls++;
      return { status: 401 };
    });
    await expect(api.get('/a')).rejects.toBeTruthy();
    expect(calls).toBe(2);
  });
  it.each(['HANDLER_INVALID', 'INVALID_PIN'])('401 com code %s não faz refresh, não repete e não desloga', async (code) => {
    let calls = 0;
    install((c) => {
      if (c.url?.includes('/auth/refresh')) refreshCalls++;
      else calls++;
      return { status: 401, data: { success: false, error: { message: 'x', code } } };
    });
    await expect(api.post('/labels', {})).rejects.toBeTruthy();
    expect(refreshCalls).toBe(0);
    expect(calls).toBe(1);
    expect(hrefSetter).not.toHaveBeenCalled();
    expect(localStorage.getItem('refreshToken')).toBe('r1');
  });

  it('401 INVALID_TOKEN em /totem/operators/verify segue o fluxo normal (faz refresh)', async () => {
    install((c) => {
      if (c.url?.includes('/auth/refresh')) {
        refreshCalls++;
        return { status: 200, data: { data: { accessToken: 'new', refreshToken: 'r2' } } };
      }
      return c.headers.Authorization === 'Bearer new'
        ? { status: 200, data: { ok: true } }
        : { status: 401, data: { success: false, error: { message: 'x', code: 'INVALID_TOKEN' } } };
    });
    const res = await api.post('/totem/operators/verify', { userId: 'u', pin: '1234' });
    expect(refreshCalls).toBe(1);
    expect(res.data.ok).toBe(true);
  });
});

describe('extractError', () => {
  it('usa a mensagem da API', () => {
    const err = new AxiosError('x', '400', undefined, {}, { status: 400, data: { error: { message: 'Inválido' } } } as any);
    expect(extractError(err)).toBe('Inválido');
  });
  it('rede indisponível', () => {
    expect(extractError(new AxiosError('Network Error'))).toMatch(/Sem conexão/);
  });
  it('5xx sem mensagem', () => {
    const err = new AxiosError('x', '500', undefined, {}, { status: 503, data: {} } as any);
    expect(extractError(err)).toMatch(/indisponível/);
  });
  it('erro desconhecido', () => {
    expect(extractError(new Error('x'))).toBe('Erro desconhecido.');
  });
});
