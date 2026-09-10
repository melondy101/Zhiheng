import { SignJWT, jwtVerify } from 'jose';
import type { SessionPayload } from './types';

export const SESSION_COOKIE_NAME = 'zhiyan_session';
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days

function getSecretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET || 'zhiyan-secure-auth-secret-key-min-32-chars!';
  return new TextEncoder().encode(secret);
}

export async function signSessionToken(payload: Omit<SessionPayload, 'exp' | 'iat'>): Promise<string> {
  const key = getSecretKey();
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(key);
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const key = getSecretKey();
    const { payload } = await jwtVerify(token, key, {
      algorithms: ['HS256'],
    });

    if (typeof payload.userId !== 'string') return null;

    return {
      userId: payload.userId,
      name: typeof payload.name === 'string' ? payload.name : '访客',
      email: typeof payload.email === 'string' ? payload.email : '',
      isGuest: Boolean(payload.isGuest),
      exp: payload.exp,
      iat: payload.iat,
    };
  } catch {
    return null;
  }
}
