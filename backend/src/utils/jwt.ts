import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { AppError, Errors } from './errors';

const ACCESS_SECRET = readSecret('JWT_ACCESS_SECRET');
const REFRESH_SECRET = readSecret('JWT_REFRESH_SECRET');
const ACCESS_EXPIRES = '8h';
export const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function readSecret(name: string): string {
  const secret = process.env[name];
  if (!secret || secret.length < 32) {
    throw new Error(`${name} precisa estar definido e ter pelo menos 32 caracteres.`);
  }
  return secret;
}

export interface TokenPayload {
  sub: string;
  name: string;
  role: string;
  /** Sessão do aparelho em `user_sessions`; encerrá-la invalida os dois tokens. */
  sid: string;
  type: 'access' | 'refresh';
}

export function signAccessToken(payload: Omit<TokenPayload, 'type'>): string {
  return jwt.sign({ ...payload, type: 'access' }, ACCESS_SECRET, { expiresIn: ACCESS_EXPIRES });
}

export function signRefreshToken(payload: Omit<TokenPayload, 'type'>): string {
  // jti deixa cada renovação única, mesmo duas no mesmo segundo.
  return jwt.sign({ ...payload, type: 'refresh' }, REFRESH_SECRET, {
    expiresIn: Math.floor(REFRESH_TTL_MS / 1000),
    jwtid: randomUUID(),
  });
}

function verifyToken(token: string, secret: string, expectedType: TokenPayload['type']): TokenPayload {
  try {
    const payload = jwt.verify(token, secret);
    if (
      typeof payload !== 'object' ||
      payload.type !== expectedType ||
      typeof payload.sub !== 'string' ||
      typeof payload.name !== 'string' ||
      typeof payload.role !== 'string' ||
      typeof payload.sid !== 'string'
    ) {
      throw Errors.unauthorized();
    }
    return payload as TokenPayload;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('Token inválido ou expirado.', 401, 'INVALID_TOKEN');
  }
}

export function verifyAccessToken(token: string): TokenPayload {
  return verifyToken(token, ACCESS_SECRET, 'access');
}

export function verifyRefreshToken(token: string): TokenPayload {
  return verifyToken(token, REFRESH_SECRET, 'refresh');
}

/** Turno do operador confirmado com PIN no totem. */
export const HANDLER_TTL_MS = 10 * 60 * 60 * 1000;

export interface HandlerTokenPayload {
  typ: 'handler';
  /** Usuário que digitou o PIN. */
  hid: string;
  /** Sessão do aparelho que conferiu o PIN: o token só vale nela. */
  sid: string;
  /** Impressão do PIN em uso: trocar ou remover o PIN invalida o token. */
  pv: string;
}

export const handlerInvalid = () =>
  new AppError('Confirme o operador do turno novamente.', 401, 'HANDLER_INVALID');

export function signHandlerToken(payload: Omit<HandlerTokenPayload, 'typ'>): { token: string; expiresAt: Date } {
  const expiresAt = new Date(Date.now() + HANDLER_TTL_MS);
  const token = jwt.sign({ ...payload, typ: 'handler' }, ACCESS_SECRET, {
    expiresIn: Math.floor(HANDLER_TTL_MS / 1000),
  });
  return { token, expiresAt };
}

/** Confere assinatura, validade e formato. Sessão e usuário são conferidos por quem chama. */
export function verifyHandlerToken(token: string): HandlerTokenPayload {
  try {
    const payload = jwt.verify(token, ACCESS_SECRET);
    if (
      typeof payload !== 'object' ||
      payload.typ !== 'handler' ||
      typeof payload.hid !== 'string' ||
      typeof payload.sid !== 'string' ||
      typeof payload.pv !== 'string'
    ) {
      throw handlerInvalid();
    }
    return payload as unknown as HandlerTokenPayload;
  } catch {
    throw handlerInvalid();
  }
}
