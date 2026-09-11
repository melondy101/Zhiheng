// Beijing-time (UTC+8) hourly cache helpers & manual refresh rate limiter.

export const BEIJING_TIMEZONE_OFFSET_MS = 8 * 60 * 60 * 1000;
export const ONE_HOUR_MS = 60 * 60 * 1000;
export const DEFAULT_MANUAL_REFRESH_LIMIT_PER_HOUR = 10;

/**
 * Returns the Beijing-time hour slot index for a given epoch millisecond timestamp.
 * Any two timestamps within the same Beijing hour (e.g. 08:00:00.000 to 08:59:59.999)
 * will produce the identical integer slot.
 */
export function getBeijingHourSlot(timestamp: number): number {
  return Math.floor((timestamp + BEIJING_TIMEZONE_OFFSET_MS) / ONE_HOUR_MS);
}

/**
 * Returns the epoch timestamp of the start of the current Beijing hour (e.g. 08:00:00.000).
 */
export function getBeijingHourStart(timestamp: number): number {
  return getBeijingHourSlot(timestamp) * ONE_HOUR_MS - BEIJING_TIMEZONE_OFFSET_MS;
}

/**
 * Returns the epoch timestamp of the next top of the hour in Beijing time (e.g. 09:00:00.000).
 */
export function getNextBeijingHourStart(timestamp: number): number {
  return (getBeijingHourSlot(timestamp) + 1) * ONE_HOUR_MS - BEIJING_TIMEZONE_OFFSET_MS;
}

/**
 * Returns milliseconds until the next top of the hour (Beijing time).
 */
export function getMsUntilNextBeijingHour(now: number = Date.now()): number {
  const next = getNextBeijingHourStart(now);
  return Math.max(1000, next - now);
}

/**
 * Checks if a hotlist snapshot's `updatedAt` belongs to the same Beijing hour slot as `now`.
 * (e.g. if now is 08:30 and snapshot was taken at 08:00, it returns true;
 * once now reaches 09:00, it returns false).
 */
export function isHotlistSnapshotFresh(snapshotUpdatedAt: number, now: number): boolean {
  if (!snapshotUpdatedAt || snapshotUpdatedAt > now) return false;
  return getBeijingHourSlot(snapshotUpdatedAt) === getBeijingHourSlot(now);
}

export interface RefreshLimitStatus {
  allowed: boolean;
  currentCount: number;
  maxLimit: number;
  remaining: number;
  resetAt: number;
  resetInSeconds: number;
}

// In-memory tracker for server-side rate-limiting by owner/client.
const serverRefreshCounters = new Map<string, { hourSlot: number; count: number }>();

/** Reset server refresh rate limit counters (for testing). */
export function clearServerRefreshLimiter(): void {
  serverRefreshCounters.clear();
}

/**
 * Checks and updates rate limit for manual refreshes for an identifier (e.g. ownerId or IP).
 */
export function checkAndUpdateServerRefreshLimit(
  ownerId: string,
  now: number = Date.now(),
  maxLimit: number = DEFAULT_MANUAL_REFRESH_LIMIT_PER_HOUR,
  increment: boolean = true
): RefreshLimitStatus {
  const currentSlot = getBeijingHourSlot(now);
  const resetAt = getNextBeijingHourStart(now);
  const resetInSeconds = Math.max(1, Math.ceil((resetAt - now) / 1000));

  const record = serverRefreshCounters.get(ownerId);
  const currentCount = record && record.hourSlot === currentSlot ? record.count : 0;

  if (currentCount >= maxLimit) {
    return {
      allowed: false,
      currentCount,
      maxLimit,
      remaining: 0,
      resetAt,
      resetInSeconds,
    };
  }

  if (increment) {
    serverRefreshCounters.set(ownerId, {
      hourSlot: currentSlot,
      count: currentCount + 1,
    });
  }

  return {
    allowed: true,
    currentCount: increment ? currentCount + 1 : currentCount,
    maxLimit,
    remaining: maxLimit - (increment ? currentCount + 1 : currentCount),
    resetAt,
    resetInSeconds,
  };
}

export const CLIENT_REFRESH_STORAGE_KEY = 'zhiyan_hotlist_manual_refreshes';

/**
 * Client-side helper to check/record manual refresh count from localStorage.
 */
export function getClientRefreshStatus(
  now: number = Date.now(),
  maxLimit: number = DEFAULT_MANUAL_REFRESH_LIMIT_PER_HOUR
): RefreshLimitStatus {
  const currentSlot = getBeijingHourSlot(now);
  const resetAt = getNextBeijingHourStart(now);
  const resetInSeconds = Math.max(1, Math.ceil((resetAt - now) / 1000));

  let currentCount = 0;
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const raw = localStorage.getItem(CLIENT_REFRESH_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { hourSlot: number; count: number };
        if (parsed && parsed.hourSlot === currentSlot && typeof parsed.count === 'number') {
          currentCount = parsed.count;
        }
      }
    } catch {
      // ignore localStorage errors
    }
  }

  return {
    allowed: currentCount < maxLimit,
    currentCount,
    maxLimit,
    remaining: Math.max(0, maxLimit - currentCount),
    resetAt,
    resetInSeconds,
  };
}

/**
 * Client-side helper to record one manual refresh.
 */
export function recordClientManualRefresh(
  now: number = Date.now(),
  maxLimit: number = DEFAULT_MANUAL_REFRESH_LIMIT_PER_HOUR
): RefreshLimitStatus {
  const status = getClientRefreshStatus(now, maxLimit);
  const nextCount = status.currentCount + 1;
  const currentSlot = getBeijingHourSlot(now);

  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      localStorage.setItem(
        CLIENT_REFRESH_STORAGE_KEY,
        JSON.stringify({ hourSlot: currentSlot, count: nextCount })
      );
    } catch {
      // ignore localStorage errors
    }
  }

  return {
    allowed: nextCount < maxLimit,
    currentCount: nextCount,
    maxLimit,
    remaining: Math.max(0, maxLimit - nextCount),
    resetAt: status.resetAt,
    resetInSeconds: status.resetInSeconds,
  };
}
