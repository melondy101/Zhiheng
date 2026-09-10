// Minimal anonymous ownership identity (#21).
//
// The client generates a random owner id once, persists it in localStorage
// under `zhiyan_owner_id`, and sends it with every storage-touching API call
// in the `x-zhiyan-owner` header. The server validates its presence and
// scopes every storage query by it, so different anonymous devices never see
// each other's records. There is no registration, login or OAuth.
//
// This module is shared by client and server: `isValidOwnerId` is pure and
// used by the server routes; `getOrCreateOwnerId` touches localStorage and
// is only meaningful in the browser (it never runs at module load).

export const OWNER_ID_HEADER = 'x-zhiyan-owner';
export const OWNER_ID_STORAGE_KEY = 'zhiyan_owner_id';

/** Owner ids are opaque tokens: UUIDs from the client, fixed ids in tests. */
const OWNER_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export function isValidOwnerId(value: unknown): value is string {
  return typeof value === 'string' && OWNER_ID_PATTERN.test(value);
}

/** Fallback for environments without crypto.randomUUID (older browsers). */
function randomOwnerId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const hex = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < 32; i++) {
    if (i === 8 || i === 12 || i === 16 || i === 20) out += '-';
    out += hex[Math.floor(Math.random() * 16)];
  }
  return out;
}

let cachedOwnerId: string | null = null;

/**
 * Set the current browser owner id (e.g. after login/register or logout)
 * and update cache and localStorage.
 */
export function setOwnerId(id: string): void {
  cachedOwnerId = id;
  try {
    localStorage.setItem(OWNER_ID_STORAGE_KEY, id);
  } catch {
    // quota exceeded / storage blocked
  }
}

/**
 * Get (or create and persist) this browser's owner id.
 * Checks localStorage first so updates via login/logout are immediately honored;
 * falls back to a per-load random id when localStorage is unavailable.
 */
export function getOrCreateOwnerId(): string {
  try {
    const existing = localStorage.getItem(OWNER_ID_STORAGE_KEY);
    if (existing && isValidOwnerId(existing)) {
      cachedOwnerId = existing;
      return cachedOwnerId;
    }
  } catch {
    // localStorage unavailable — fall through to memory cache or new id.
  }
  if (cachedOwnerId) return cachedOwnerId;
  const id = randomOwnerId();
  try {
    localStorage.setItem(OWNER_ID_STORAGE_KEY, id);
  } catch {
    // quota exceeded / storage blocked — keep the per-load id.
  }
  cachedOwnerId = id;
  return id;
}

/** Browser-only convenience: headers every client API call must carry. */
export function ownerHeaders(): Record<string, string> {
  return { [OWNER_ID_HEADER]: getOrCreateOwnerId() };
}

/**
 * Server side: extract and validate the ownership header from a request.
 * Returns null when the header is missing or malformed — routes must reject
 * such requests instead of falling back to a shared identity, so records are
 * always scoped to exactly one anonymous owner.
 */
export function readOwnerId(request: Request): string | null {
  const value = request.headers.get(OWNER_ID_HEADER)?.trim();
  return isValidOwnerId(value) ? value : null;
}
