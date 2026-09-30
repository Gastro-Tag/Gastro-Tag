import jwt from 'jsonwebtoken';
import { AppError, Errors } from './errors';

const ACCESS_SECRET = readSecret('JWT_ACCESS_SECRET');
const REFRESH_SECRET = readSecret('JWT_REFRESH_SECRET');
const ACCESS_EXPIRES = '8h';
const REFRESH_EXPIRES = '7d';

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
  type: 'access' | 'refresh';
}

export function signAccessToken(payload: Omit<TokenPayload, 'type'>): string {
  return jwt.sign({ ...payload, type: 'access' }, ACCESS_SECRET, { expiresIn: ACCESS_EXPIRES });
}

export function signRefreshToken(payload: Omit<TokenPayload, 'type'>): string {
  return jwt.sign({ ...payload, type: 'refresh' }, REFRESH_SECRET, { expiresIn: REFRESH_EXPIRES });
}

function verifyToken(token: string, secret: string, expectedType: TokenPayload['type']): TokenPayload {
  try {
    const payload = jwt.verify(token, secret);
    if (
      typeof payload !== 'object' ||
      payload.type !== expectedType ||
      typeof payload.sub !== 'string' ||
      typeof payload.name !== 'string' ||
      typeof payload.role !== 'string'
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