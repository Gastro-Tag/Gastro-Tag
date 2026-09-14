import jwt from 'jsonwebtoken';
import { AppError } from './errors';

const SECRET = process.env.JWT_SECRET ?? 'dev_secret_change_me';
const ACCESS_EXPIRES  = '8h';
const REFRESH_EXPIRES = '7d';

export interface TokenPayload {
  sub: string;   // user id
  name: string;
  role: string;
  type: 'access' | 'refresh';
}

export function signAccessToken(payload: Omit<TokenPayload, 'type'>): string {
  return jwt.sign({ ...payload, type: 'access' }, SECRET, { expiresIn: ACCESS_EXPIRES });
}

export function signRefreshToken(payload: Omit<TokenPayload, 'type'>): string {
  return jwt.sign({ ...payload, type: 'refresh' }, SECRET, { expiresIn: REFRESH_EXPIRES });
}

export function verifyToken(token: string): TokenPayload {
  try {
    return jwt.verify(token, SECRET) as TokenPayload;
  } catch {
    throw new AppError('Token inválido ou expirado.', 401, 'INVALID_TOKEN');
  }
}
