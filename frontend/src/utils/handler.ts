import axios from 'axios';

/** O servidor recusou o handlerToken (vencido, de outra sessão ou usuário sem PIN). */
export function isHandlerInvalid(err: unknown): boolean {
  return axios.isAxiosError(err)
    && err.response?.status === 401
    && (err.response.data as { error?: { code?: string } } | undefined)?.error?.code === 'HANDLER_INVALID';
}
