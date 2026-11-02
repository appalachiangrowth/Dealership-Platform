import jwt from 'jsonwebtoken';
import type { TokenPayload } from './auth.types.js';

function secret(): string {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 16) {
    if (process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET must be set (16+ characters)');
    return 'dev-only-secret-change-me-please';
  }
  return s;
}

export function signToken(payload: TokenPayload, expiresIn?: string): string {
  return jwt.sign(payload, secret(), { expiresIn: (expiresIn || process.env.JWT_EXPIRES_IN || '7d') as jwt.SignOptions['expiresIn'] });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    const p = jwt.verify(token, secret());
    if (typeof p !== 'object' || !p || !('sub' in p) || !('kind' in p)) return null;
    return p as unknown as TokenPayload;
  } catch {
    return null;
  }
}
