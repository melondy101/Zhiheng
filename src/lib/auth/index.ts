import { cookies } from 'next/headers';
import { signSessionToken, verifySessionToken, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from './jwt';
import { MemoryUserStore, PostgresUserStore, type UserStore } from './user-store';
import type { SafeUser, SessionPayload, User } from './types';
import { readServerStorageConfig } from '../server-storage';
import { isValidOwnerId } from '../owner-id';

export { signSessionToken, verifySessionToken, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS };
export type { SafeUser, SessionPayload, User, UserStore };

let cachedUserStore: Promise<UserStore> | null = null;
const memoryStoreInstance = new MemoryUserStore();

export async function getUserStore(): Promise<UserStore> {
  if (cachedUserStore) return cachedUserStore;

  cachedUserStore = (async () => {
    const config = readServerStorageConfig();
    if (!config) {
      return memoryStoreInstance;
    }
    try {
      const { createNeonExecutor } = await import('../db/pg-executor');
      const executor = await createNeonExecutor(config.databaseUrl);
      return new PostgresUserStore(executor);
    } catch (err) {
      console.warn('[auth] DB unavailable for UserStore, falling back to memory store:', err);
      return memoryStoreInstance;
    }
  })();

  return cachedUserStore;
}

export function generateGuestIdentity(): { id: string; name: string; email: string } {
  const hex = Math.random().toString(16).slice(2, 6);
  const uuid = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    id: uuid,
    name: `访客 ${hex}`,
    email: `temp-${uuid.slice(0, 8)}@anon.local`,
  };
}

export async function createGuestSession(): Promise<{ user: SafeUser; token: string }> {
  const identity = generateGuestIdentity();
  const now = Date.now();
  const guestUser: User = {
    id: identity.id,
    name: identity.name,
    email: identity.email,
    emailLower: identity.email.toLowerCase(),
    passwordHash: '',
    isGuest: true,
    createdAt: now,
    updatedAt: now,
  };

  const store = await getUserStore();
  await store.createUser(guestUser);

  const token = await signSessionToken({
    userId: guestUser.id,
    name: guestUser.name,
    email: guestUser.email,
    isGuest: true,
  });

  return {
    user: {
      id: guestUser.id,
      name: guestUser.name,
      email: guestUser.email,
      emailLower: guestUser.emailLower,
      isGuest: true,
      createdAt: now,
      updatedAt: now,
    },
    token,
  };
}

export function parseCookieHeader(cookieHeader: string | null): Record<string, string> {
  if (!cookieHeader) return {};
  const cookies: Record<string, string> = {};
  cookieHeader.split(';').forEach((cookie) => {
    const [name, ...rest] = cookie.split('=');
    if (name) {
      cookies[name.trim()] = rest.join('=').trim();
    }
  });
  return cookies;
}

export async function extractSessionFromRequest(request: Request): Promise<SessionPayload | null> {
  // 1. Check Cookie header
  const cookieHeader = request.headers.get('cookie');
  const parsedCookies = parseCookieHeader(cookieHeader);
  const token = parsedCookies[SESSION_COOKIE_NAME] || parsedCookies['__Host-session'];

  if (token) {
    const verified = await verifySessionToken(token);
    if (verified) return verified;
  }

  // 2. Check Authorization Bearer header
  const authHeader = request.headers.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const bearerToken = authHeader.slice(7).trim();
    const verified = await verifySessionToken(bearerToken);
    if (verified) return verified;
  }

  // 3. Fallback for x-zhiyan-owner header (for legacy/test backward compatibility)
  const legacyOwner = request.headers.get('x-zhiyan-owner')?.trim();
  if (legacyOwner && isValidOwnerId(legacyOwner)) {
    return {
      userId: legacyOwner,
      name: `访客 ${legacyOwner.slice(0, 4)}`,
      email: `temp-${legacyOwner}@anon.local`,
      isGuest: true,
    };
  }

  return null;
}

export async function requireAuth(request: Request): Promise<{
  userId: string;
  isGuest: boolean;
  name: string;
  email: string;
  user: SafeUser | null;
}> {
  const session = await extractSessionFromRequest(request);
  if (session) {
    const store = await getUserStore();
    const userRecord = await store.findUserById(session.userId);
    return {
      userId: session.userId,
      isGuest: session.isGuest,
      name: userRecord?.name || session.name,
      email: userRecord?.email || session.email,
      user: userRecord
        ? {
            id: userRecord.id,
            name: userRecord.name,
            email: userRecord.email,
            emailLower: userRecord.emailLower,
            isGuest: userRecord.isGuest,
            createdAt: userRecord.createdAt,
            updatedAt: userRecord.updatedAt,
          }
        : null,
    };
  }

  // Auto create guest if not present
  const guest = await createGuestSession();
  return {
    userId: guest.user.id,
    isGuest: true,
    name: guest.user.name,
    email: guest.user.email,
    user: guest.user,
  };
}

export function buildSessionCookieString(token: string, isProduction: boolean = process.env.NODE_ENV === 'production'): string {
  const cookieName = SESSION_COOKIE_NAME;
  const secure = isProduction ? '; Secure' : '';
  return `${cookieName}=${token}; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}; SameSite=Lax; HttpOnly${secure}`;
}

export function buildClearCookieString(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly`;
}
