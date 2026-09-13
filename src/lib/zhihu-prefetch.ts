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

async function prefetchOne(title: string): Promise<void> {
  const key = normalizeQuery(title);
  if (!key || prefetched.has(key) || inFlight.has(key)) return;
  const task = (async () => {
    try {
      const result = await createZhihuSearchProvider({ count: 10 }).search(title);
      // Never promote fixture/demo material into the prefetch cache; cached
      // hot topics must remain attributable to real Zhihu retrieval.
      if (result.sources.length > 0 && result.source !== 'demo' && result.source !== 'unavailable') {
        prefetched.set(key, { result, expiresAt: Date.now() + PREFETCH_TTL_MS });
      }
    } catch (error) {
      console.warn('[zhihu-prefetch] topic failed:', title, error instanceof Error ? error.message : String(error));
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, task);
  await task;
}

/** Best-effort background preparation; never blocks the hotlist response. */
export function prefetchHotlistTopics(items: HotlistItem[]): void {
  const titles = Array.from(new Set(items.map((item) => normalizeQuery(item.title)).filter(Boolean)));
  void (async () => {
    let cursor = 0;
    const worker = async () => {
      while (cursor < titles.length) {
        const title = titles[cursor++];
        await prefetchOne(title);
      }
    };
    await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENCY, titles.length) }, worker));
  })().catch((error) => console.warn('[zhihu-prefetch] background run failed:', error));
}

export function clearZhihuPrefetchCache(): void {
  prefetched.clear();
}
