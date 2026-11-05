import jwt from 'jsonwebtoken';
import type { TokenPayload } from './auth.types.js';

/** the value shipped in rename-to-dot-env.txt — public, so never accepted on a live server */
const EXAMPLE_SECRET = '44366d089efc17bbd8c0b32acebd3deaa0a90c27ada0fb6c5a22fdb71037b98998cb6d92f0f583ba4950ada32d758ce4';

function secret(): string {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 16 || s === EXAMPLE_SECRET) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET must be your own long random value on a live server (make one with: openssl rand -hex 48)');
    }
    return s && s.length >= 16 ? s : 'dev-only-secret-change-me-please';
  }
  return s;
}

/** checked when the API starts, so a live server with a weak secret stops at once (not at the first login) */
export function assertJwtSecret() {
  secret();
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
