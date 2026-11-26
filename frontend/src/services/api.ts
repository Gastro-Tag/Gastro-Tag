import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { clearVerifiedOperator } from '@/utils/totem';
import { loginUrl } from '@/utils/redirect';

export const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
  timeout: 10_000,
});

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = localStorage.getItem('accessToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

/** Inscrição mínima no resultado das chamadas (plano B do totem): só avisa, nunca altera a resposta nem o refresh. */
export type ApiActivity = 'success' | 'network-error';
type ApiActivityListener = (activity: ApiActivity) => void;
const activityListeners = new Set<ApiActivityListener>();
export function subscribeApiActivity(listener: ApiActivityListener): () => void {
  activityListeners.add(listener);
  return () => { activityListeners.delete(listener); };
}
function notifyActivity(activity: ApiActivity) {
  activityListeners.forEach((listener) => { try { listener(activity); } catch { /* o ouvinte nunca afeta a requisição */ } });
}

let refreshPromise: Promise<string> | null = null;

api.interceptors.response.use(
  (response) => { notifyActivity('success'); return response; },
  async (error: AxiosError) => {
    // Sem resposta, ou o nginx/túnel respondendo que a API não está lá: conta como queda para o plano B.
    const status = error.response?.status;
    if ((!error.response || status === 502 || status === 503 || status === 504 || status === 530) && !axios.isCancel(error)) {
      notifyActivity('network-error');
    }
    const original = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;
    const url = original?.url ?? '';
    // Login, refresh e logout devolvem 401 por motivo próprio. PIN errado e token de operador recusado são 401 do
    // operador, não da sessão: renovar e repetir não adianta e contaria uma falha a mais no limite de tentativas.
    // Identificados pelo código; um 401 de sessão (INVALID_TOKEN etc.) segue o fluxo normal de refresh/logout.
    const code = (error.response?.data as { error?: { code?: string } } | undefined)?.error?.code;
    const isAuthRequest = ['/auth/login', '/auth/refresh', '/auth/logout'].some((path) => url.includes(path))
      || code === 'INVALID_PIN' || code === 'HANDLER_INVALID';

    if (error.response?.status !== 401 || !original || original._retry || isAuthRequest) {
      return Promise.reject(error);
    }

    const refreshToken = localStorage.getItem('refreshToken');
    if (!refreshToken) {
      logout();
      return Promise.reject(error);
    }

    original._retry = true;
    if (!refreshPromise) {
      refreshPromise = axios.post('/api/auth/refresh', { refreshToken }, { timeout: 10_000 })
        .then(({ data }) => {
          const accessToken = data.data.accessToken as string;
          const nextRefreshToken = data.data.refreshToken as string;
          localStorage.setItem('accessToken', accessToken);
          localStorage.setItem('refreshToken', nextRefreshToken);
          return accessToken;
        })
        .catch((refreshError) => {
          // Só o servidor recusando o token encerra a sessão; queda de rede não desconecta.
          const status = axios.isAxiosError(refreshError) ? refreshError.response?.status : undefined;
          if (status === 401 || status === 403) logout();
          throw refreshError;
        })
        .finally(() => { refreshPromise = null; });
    }

    try {
      const accessToken = await refreshPromise;
      original.headers.Authorization = `Bearer ${accessToken}`;
      return api(original);
    } catch (refreshError) {
      return Promise.reject(refreshError);
    }
  },
);

function logout() {
  clearVerifiedOperator();
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('gastrotag-auth');
  const { pathname, search } = window.location;
  window.location.href = pathname.startsWith('/totem') ? '/totem/login' : loginUrl(pathname, search);
}

/** Código do erro da API (`error.code`), ex.: RULE_REQUIRED; undefined sem resposta. */
export function extractErrorCode(err: unknown): string | undefined {
  if (axios.isAxiosError(err)) return (err.response?.data as any)?.error?.code;
  return undefined;
}

export function extractError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    if (!err.response) return 'Sem conexão com o servidor. Verifique a rede e tente novamente.';
    const message = (err.response.data as any)?.error?.message;
    if (message) return message;
    return err.response.status >= 500 ? 'Servidor indisponível. Tente novamente em instantes.' : err.message;
  }
  return 'Erro desconhecido.';
}
