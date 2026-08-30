// Hotlist provider — fetches Zhihu hotlist topics with localStorage caching.
// Client-side only; do not import in server code.

export interface HotlistItem {
  id: string;
  title: string;
  url: string;
}

export interface HotlistResult {
  items: HotlistItem[];
  source: 'live' | 'cache' | 'demo';
  updatedAt: number;
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

  /** Try to fetch from a live API (always fails in MVP — throws). */
  private async fetchLive(): Promise<HotlistResult> {
    // MVP: live endpoint intentionally unreachable.
    throw new Error('Live API not available in MVP');
  }

  /** Read cached result from localStorage. Returns null if no cache or stale. */
  private readCache(): HotlistResult | null {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const cached: HotlistResult = JSON.parse(raw);
      if (Date.now() - cached.updatedAt > TTL_MS) return null;
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

  /** Fetch hotlist with fallback: live → cache → demo. */
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

    // 2. Try cache
    const cached = this.readCache();
    if (cached) {
      return cached;
    }

    // 3. Fall back to demo
    const demo = this.buildDemo();
    this.writeCache(demo);
    return demo;
  }
}

export const hotlistProvider = new HotlistProvider();
