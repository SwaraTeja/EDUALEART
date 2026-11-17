import jwt from 'jsonwebtoken';
import { createHash } from 'node:crypto';
import { env } from '../config/env.js';

/**
 * Three token kinds, each with its own signing secret AND a `typ` claim, so a token minted for one
 * purpose can never be replayed for another (e.g. a password-reset link cannot be used as a refresh token).
 */
export type TokenType = 'access' | 'refresh' | 'reset';

export interface TokenPayload {
  id: string;
  typ: TokenType;
  /** User.tokenVersion at issue time — bumping it on the user revokes every outstanding token. */
  tv?: number;
  /** Fingerprint of the password hash at issue time — makes reset links single-use. */
  ph?: string;
}

const secrets: Record<TokenType, string> = {
  access: env.JWT_SECRET,
  refresh: env.JWT_REFRESH_SECRET,
  reset: createHash('sha256').update(`${env.JWT_REFRESH_SECRET}:reset`).digest('hex'),
};

export function signToken(type: TokenType, claims: { id: string; tv?: number; ph?: string }, expiresIn: string): string {
  return jwt.sign({ ...claims, typ: type }, secrets[type], {
    algorithm: 'HS256',
    expiresIn: expiresIn as jwt.SignOptions['expiresIn'],
  });
}

export function verifyToken(type: TokenType, token: string): TokenPayload {
  const payload = jwt.verify(token, secrets[type], { algorithms: ['HS256'] }) as TokenPayload;
  if (payload.typ !== type || typeof payload.id !== 'string') {
    throw new jwt.JsonWebTokenError('wrong token type');
  }
  return payload;
}

export const passwordFingerprint = (hash: string | null | undefined): string =>
  createHash('sha256').update(hash ?? '').digest('hex').slice(0, 16);
