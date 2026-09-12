export const ZHIHU_OAUTH_AUTHORIZE_URL = 'https://openapi.zhihu.com/authorize';
export const ZHIHU_OAUTH_TOKEN_URL = 'https://openapi.zhihu.com/access_token';
export const ZHIHU_OAUTH_PROFILE_URL = 'https://openapi.zhihu.com/user';
const STATE_TTL_MS = 10 * 60 * 1000;

export interface ZhihuOAuthConfig {
  ready: boolean;
  appId?: string;
  appKey?: string;
  redirectUri?: string;
  accessSecretConfigured: boolean;
  missing: string[];
}

export interface AuthorizedZhihuProfile {
  id: string;
  name: string;
  avatarUrl: string | null;
  headline: string | null;
}

interface PendingAuthorization {
  ownerId: string;
  expiresAt: number;
}

interface AuthorizedSession {
  accessToken: string;
  profile: AuthorizedZhihuProfile;
}

export function readZhihuOAuthConfig(
  env: Record<string, string | undefined> = process.env
): ZhihuOAuthConfig {
  const appId = env.ZHIHU_OAUTH_APP_ID?.trim();
  const appKey = env.ZHIHU_OAUTH_APP_KEY?.trim();
  const redirectUri = env.ZHIHU_OAUTH_REDIRECT_URI?.trim();
  const missing = [
    !appId && 'ZHIHU_OAUTH_APP_ID',
    !appKey && 'ZHIHU_OAUTH_APP_KEY',
    !redirectUri && 'ZHIHU_OAUTH_REDIRECT_URI',
  ].filter((value): value is string => Boolean(value));

  return {
    ready: missing.length === 0,
    appId,
    appKey,
    redirectUri,
    accessSecretConfigured: Boolean(env.ZHIHU_ACCESS_SECRET?.trim()),
    missing,
  };
}

export class ZhihuOAuthProvider {
  private readonly config: ZhihuOAuthConfig;
  private readonly now: () => number;
  private readonly randomBytes: () => Uint8Array;
  private readonly pending = new Map<string, PendingAuthorization>();
  private readonly sessions = new Map<string, AuthorizedSession>();

  constructor(options: {
    env?: Record<string, string | undefined>;
    now?: () => number;
    randomBytes?: () => Uint8Array;
  } = {}) {
    this.config = readZhihuOAuthConfig(options.env);
    this.now = options.now ?? Date.now;
    this.randomBytes = options.randomBytes ?? (() => crypto.getRandomValues(new Uint8Array(32)));
  }

  getStatus(ownerId: string): {
    configured: boolean;
    accessSecretConfigured: boolean;
    missing: string[];
    authorized: boolean;
    profile?: AuthorizedZhihuProfile;
  } {
    const session = this.sessions.get(ownerId);
    return {
      configured: this.config.ready,
      accessSecretConfigured: this.config.accessSecretConfigured,
      missing: this.config.missing,
      authorized: Boolean(session),
      ...(session ? { profile: session.profile } : {}),
    };
  }

  beginAuthorization(ownerId: string):
    | { ok: true; state: string; authorizationUrl: string }
    | { ok: false; missing: string[] } {
    if (!this.config.ready || !this.config.appId || !this.config.redirectUri) {
      return { ok: false, missing: this.config.missing };
    }
    const state = Buffer.from(this.randomBytes()).toString('base64url');
    this.pending.set(state, { ownerId, expiresAt: this.now() + STATE_TTL_MS });
    const url = new URL(ZHIHU_OAUTH_AUTHORIZE_URL);
    url.searchParams.set('redirect_uri', this.config.redirectUri);
    url.searchParams.set('app_id', this.config.appId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('state', state);
    return { ok: true, state, authorizationUrl: url.toString() };
  }

  consumeAuthorization(state: string, ownerId: string): { ok: true } | { ok: false; reason: 'invalid_state' } {
    const pending = this.pending.get(state);
    if (!pending || pending.ownerId !== ownerId || pending.expiresAt < this.now()) {
      return { ok: false, reason: 'invalid_state' };
    }
    this.pending.delete(state);
    return { ok: true };
  }

  async exchangeCode(code: string): Promise<{ accessToken: string } | null> {
    if (!this.config.ready || !this.config.appId || !this.config.appKey || !this.config.redirectUri) return null;
    const body = new URLSearchParams({
      app_id: this.config.appId,
      app_key: this.config.appKey,
      grant_type: 'authorization_code',
      redirect_uri: this.config.redirectUri,
      code,
    });
    const response = await fetch(ZHIHU_OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!response.ok) return null;
    const payload = await response.json() as { access_token?: unknown };
    return typeof payload.access_token === 'string' && payload.access_token ? { accessToken: payload.access_token } : null;
  }

  async fetchProfile(accessToken: string): Promise<AuthorizedZhihuProfile | null> {
    const response = await fetch(ZHIHU_OAUTH_PROFILE_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;
    const payload = await response.json() as Record<string, unknown>;
    const rawId = payload.hash_id ?? payload.uid;
    if ((typeof rawId !== 'string' && typeof rawId !== 'number') || typeof payload.fullname !== 'string' || !payload.fullname.trim()) return null;
    return {
      id: String(rawId),
      name: payload.fullname.trim(),
      avatarUrl: typeof payload.avatar_path === 'string' ? payload.avatar_path : null,
      headline: typeof payload.headline === 'string' ? payload.headline : null,
    };
  }

  bindAuthorizedUser(ownerId: string, accessToken: string, profile: AuthorizedZhihuProfile): void {
    this.sessions.set(ownerId, { accessToken, profile });
  }

  getAuthorizedAccessToken(ownerId: string): string | null {
    return this.sessions.get(ownerId)?.accessToken ?? null;
  }

  async readUserData(ownerId: string, resource: 'contents' | 'followees' | 'favorites' | 'recent_favorites' | 'favorite_contents', favlistUrlToken?: string): Promise<{ ok: true; data: unknown } | { ok: false; reason: 'not_authorized' | 'access_secret_missing' | 'invalid_favlist' | 'upstream_error' }> {
    const session = this.sessions.get(ownerId);
    if (!session) return { ok: false, reason: 'not_authorized' };
    const accessSecret = process.env.ZHIHU_ACCESS_SECRET?.trim();
    if (!accessSecret) return { ok: false, reason: 'access_secret_missing' };
    if (resource === 'favorite_contents' && !/^\d+$/.test(favlistUrlToken ?? '')) {
      return { ok: false, reason: 'invalid_favlist' };
    }
    const paths = {
      contents: '/api/v1/user/contents?ContentType=all&Limit=20',
      followees: '/api/v1/user/followees?Limit=20',
      favorites: '/api/v1/user/favlists?Limit=20',
      recent_favorites: '/api/v1/user/collections?Limit=20',
      favorite_contents: `/api/v1/user/favlist_contents?FavlistUrlToken=${favlistUrlToken}&Limit=20`,
    } as const;
    const response = await fetch(`https://developer.zhihu.com${paths[resource]}`, {
      headers: {
        Authorization: `Bearer ${accessSecret}`,
        'X-OAuth-Token': session.accessToken,
        'X-Request-Timestamp': String(Math.floor(this.now() / 1000)),
        'Content-Type': 'application/json',
      },
    });
    if (!response.ok) return { ok: false, reason: 'upstream_error' };
    return { ok: true, data: await response.json() };
  }
  clearAuthorization(ownerId: string): void {
    this.sessions.delete(ownerId);
  }
}

let sharedProvider: ZhihuOAuthProvider | null = null;
export function getZhihuOAuthProvider(): ZhihuOAuthProvider {
  if (!sharedProvider) sharedProvider = new ZhihuOAuthProvider();
  return sharedProvider;
}

export function resetZhihuOAuthProvider(): void {
  sharedProvider = null;
}

