// Hotlist provider — fetches Zhihu hotlist topics with localStorage caching.
// Client-side only; do not import in server code (server code imports the
// HotlistItem *type* from here, never the runtime — #19).
//
// #19: real live retrieval runs server-side in src/lib/zhihu-retrieval.ts
// (/api/hotlist). This browser-side class keeps the honest degradation chain
// cache → demo; its live path intentionally throws, so the fixture data below
// can never be labeled 'live'.

export interface HotlistItem {
  id: string;
  title: string;
  /** Null when the provider record carried no URL — never fabricated (#19). */
  url: string | null;
}

export interface HotlistResult {
  items: HotlistItem[];
  source: 'live' | 'cache' | 'demo';
  updatedAt: number;
  stale?: boolean;
}

const CACHE_KEY = 'zhiyan_hotlist_cache';
const TTL_MS = 86_400_000; // 24 hours

export class HotlistProvider {
  private demoItems: HotlistItem[];

  constructor() {
    this.demoItems = [
      { id: 'd1', title: '2026年AI大模型竞争格局：谁是最后的赢家？', url: 'https://www.zhihu.com/question/1' },
      { id: 'd2', title: '为什么越来越多的人开始学习Rust？', url: 'https://www.zhihu.com/question/2' },
      { id: 'd3', title: '如何评价OpenAI最新发布的推理模型？', url: 'https://www.zhihu.com/question/3' },
      { id: 'd4', title: '程序员35岁之后的职业出路在哪里？', url: 'https://www.zhihu.com/question/4' },
      { id: 'd5', title: '自动驾驶距离真正落地还有多远？', url: 'https://www.zhihu.com/question/5' },
      { id: 'd6', title: '量子计算距离实用化还有哪些核心瓶颈？', url: 'https://www.zhihu.com/question/6' },
      { id: 'd7', title: 'WebAssembly能否取代JavaScript成为前端主流？', url: 'https://www.zhihu.com/question/7' },
      { id: 'd8', title: 'AI生成内容对原创写作生态的影响', url: 'https://www.zhihu.com/question/8' },
      { id: 'd9', title: '为什么国内云厂商纷纷押注大模型？', url: 'https://www.zhihu.com/question/9' },
      { id: 'd10', title: '微服务架构是否正在走向终结？', url: 'https://www.zhihu.com/question/10' },
    ];
  }

  /** Client-side live attempt — intentionally unreachable (#19: live retrieval
   *  is server-side only, so this browser path always throws and the chain
   *  degrades to cache → demo; the demo items below are never labeled 'live'). */
  private async fetchLive(): Promise<HotlistResult> {
    throw new Error('Live API not available client-side');
  }

  /** Read cached result from localStorage.
   *  Returns fresh cache, stale cache (with stale:true), or null if empty. */
  private readCache(): HotlistResult | null {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const cached: HotlistResult = JSON.parse(raw);
      const age = Date.now() - cached.updatedAt;
      if (age > TTL_MS) {
        // Return stale cache so the caller can surface last-known data;
        // also fire-and-forget a background refresh attempt.
        const stale = { ...cached, source: 'cache' as const, stale: true };
        this.refreshInBackground();
        return stale;
      }
      return { ...cached, source: 'cache' };
    } catch {
      return null;
    }
  }

  /** Persist result to localStorage. */
  private writeCache(result: HotlistResult): void {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(result));
    } catch {
      // quota exceeded — silent
    }
  }

  /** Build demo result. */
  private buildDemo(): HotlistResult {
    return {
      items: this.demoItems,
      source: 'demo',
      updatedAt: Date.now(),
    };
  }

  /** Fetch hotlist with fallback: live → fresh cache → stale cache → demo. */
  async fetchHotlist(): Promise<HotlistResult> {
    // 1. Try live (always fails in MVP, but keep the path)
    try {
      const live = await this.fetchLive();
      if (live) {
        this.writeCache(live);
        return live;
      }
    } catch {
      // fall through to cache
    }

    // 2. Try fresh cache
    const cached = this.readCache();
    if (cached && !cached.stale) {
      return cached;
    }

    // 3. Try stale cache (last-success fallback)
    if (cached && cached.stale) {
      // Background refresh was already triggered inside readCache().
      return cached;
    }

    // 4. Fall back to demo
    const demo = this.buildDemo();
    this.writeCache(demo);
    return demo;
  }

  /** Fire-and-forget: attempt a live fetch to refresh the cache silently. */
  private refreshInBackground(): void {
    // Don't await — we don't want to block the caller.
    this.fetchLive()
      .then(live => {
        if (live) this.writeCache(live);
      })
      .catch(() => {
        // Silently swallow — stale data is still shown.
      });
  }
}

export const hotlistProvider = new HotlistProvider();
