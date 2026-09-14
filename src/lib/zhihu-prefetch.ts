import type { HotlistItem } from './hotlist-providers';
import {
  createZhihuSearchProvider,
  normalizeQuery,
  readZhihuApiConfig,
  type RetrievalResult,
} from './zhihu-retrieval';

/** Process-local cache for material prepared from the current hotlist. */
const PREFETCH_TTL_MS = 45 * 60 * 1000;
const MAX_CONCURRENCY = 2;
const prefetched = new Map<string, { result: RetrievalResult; expiresAt: number }>();
const inFlight = new Map<string, Promise<void>>();

let authFailedSecret: string | null = null;

/** Check if the currently configured Zhihu secret is known to have failed authentication */
export function isZhihuAuthFailed(): boolean {
  const current = process.env.ZHIHU_ACCESS_SECRET?.trim();
  if (!current) return false;
  return current === authFailedSecret;
}

/** Record that a specific Zhihu secret failed upstream authentication (e.g. 20001) */
export function recordZhihuAuthFailure(secret?: string): void {
  const s = secret ?? process.env.ZHIHU_ACCESS_SECRET?.trim();
  if (s) {
    authFailedSecret = s;
  }
}

/** Reset recorded auth failure state (e.g. for testing or when secret is updated) */
export function clearZhihuAuthFailure(): void {
  authFailedSecret = null;
}

export function getPrefetchedZhihuSources(question: string): RetrievalResult | null {
  const key = normalizeQuery(question);
  const entry = prefetched.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    prefetched.delete(key);
    return null;
  }
  return { ...entry.result, source: 'cache' };
}

async function prefetchOne(title: string): Promise<{ authFailed?: boolean }> {
  const key = normalizeQuery(title);
  if (!key || prefetched.has(key) || inFlight.has(key) || isZhihuAuthFailed()) {
    return { authFailed: isZhihuAuthFailed() };
  }
  let isAuthFailed = false;
  const task = (async () => {
    try {
      const result = await createZhihuSearchProvider({ count: 10 }).search(title);
      // Never promote fixture/demo material into the prefetch cache; cached
      // hot topics must remain attributable to real Zhihu retrieval.
      if (result.sources.length > 0 && result.source !== 'demo' && result.source !== 'unavailable') {
        prefetched.set(key, { result, expiresAt: Date.now() + PREFETCH_TTL_MS });
      }
      if (result.diagnostic?.reason === 'auth_failed') {
        isAuthFailed = true;
        recordZhihuAuthFailure();
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('20001') || msg.includes('Authorization failed') || msg.includes('401') || msg.includes('403')) {
        isAuthFailed = true;
        recordZhihuAuthFailure();
        console.info('[zhihu-prefetch] topic auth failed, stopping prefetch:', title);
      } else {
        console.warn('[zhihu-prefetch] topic failed:', title, msg);
      }
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, task);
  await task;
  return { authFailed: isAuthFailed };
}

/** Best-effort background preparation; never blocks the hotlist response. */
export function prefetchHotlistTopics(items: HotlistItem[]): void {
  const config = readZhihuApiConfig();
  if (!config || isZhihuAuthFailed()) {
    return;
  }

  const titles = Array.from(new Set(items.map((item) => normalizeQuery(item.title)).filter(Boolean)));
  if (titles.length === 0) return;

  void (async () => {
    let cursor = 0;
    let authFailed = false;
    const worker = async () => {
      while (cursor < titles.length && !authFailed && !isZhihuAuthFailed()) {
        const title = titles[cursor++];
        if (!title) break;
        const res = await prefetchOne(title);
        if (res.authFailed || isZhihuAuthFailed()) {
          authFailed = true;
          break;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENCY, titles.length) }, worker));
  })().catch((error) => console.warn('[zhihu-prefetch] background run failed:', error));
}

export function clearZhihuPrefetchCache(): void {
  prefetched.clear();
}
