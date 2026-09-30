import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';

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

let refreshPromise: Promise<string> | null = null;

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;
    const url = original?.url ?? '';
    const isAuthRequest = url.includes('/auth/login') || url.includes('/auth/refresh');

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
          logout();
          throw refreshError;
        })
        .finally(() => { refreshPromise = null; });
    }

    try {
      const accessToken = await refreshPromise;
      original.headers.Authorization = `Bearer ${accessToken}`;
      return api(original);
    } catch {
      return Promise.reject(error);
    }
  },
);

function logout() {
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
  window.location.href = '/login';
}

export function extractError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    return (err.response?.data as any)?.error?.message ?? err.message;
  }
  return 'Erro desconhecido.';
}
