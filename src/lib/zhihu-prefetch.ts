import type { HotlistItem } from './hotlist-providers';
import {
  createZhihuSearchProvider,
  normalizeQuery,
  type RetrievalResult,
} from './zhihu-retrieval';

/** Process-local cache for material prepared from the current hotlist. */
const PREFETCH_TTL_MS = 45 * 60 * 1000;
const MAX_CONCURRENCY = 2;
const prefetched = new Map<string, { result: RetrievalResult; expiresAt: number }>();
const inFlight = new Map<string, Promise<void>>();

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
  if (!key || prefetched.has(key) || inFlight.has(key)) return {};
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
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('20001') || msg.includes('Authorization failed') || msg.includes('401') || msg.includes('403')) {
        isAuthFailed = true;
      }
      console.warn('[zhihu-prefetch] topic failed:', title, msg);
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
  const titles = Array.from(new Set(items.map((item) => normalizeQuery(item.title)).filter(Boolean)));
  void (async () => {
    let cursor = 0;
    let authFailed = false;
    const worker = async () => {
      while (cursor < titles.length && !authFailed) {
        const title = titles[cursor++];
        const res = await prefetchOne(title);
        if (res.authFailed) {
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
