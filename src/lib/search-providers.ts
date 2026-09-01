// Search providers with honest degradation (#18): cache → demo.
// #19: real retrieval now lives in src/lib/zhihu-retrieval.ts (server-side,
// injectable transport). THIS module remains the fixture-only provider path:
// its fetch serves hardcoded fixture content, which must be labeled 'demo',
// never 'live' — only the real providers in zhihu-retrieval.ts may emit 'live'.
// Supports simulateFailure flag for testing degradation paths.

import type { Source } from './providers';
import { getDemoSources } from './demo-sources';

// ---------------------------------------------------------------------------
// Result wrapper with source tracking
// ---------------------------------------------------------------------------

export type SearchSourceState = 'live' | 'cache' | 'demo';

export interface SearchResult {
  sources: Source[];
  source: SearchSourceState;
  stale?: boolean;
}

// ---------------------------------------------------------------------------
// Cache helpers (client-side localStorage)
// ---------------------------------------------------------------------------

const CACHE_PREFIX = 'zhiyan_search_cache_';
const TTL_MS = 86_400_000; // 24 hours

function cacheKey(question: string): string {
  return CACHE_PREFIX + hashQuestion(question);
}

function hashQuestion(question: string): string {
  let hash = 0;
  const normalized = question.trim().toLowerCase();
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function readCache(question: string): { sources: Source[]; updatedAt: number } | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(cacheKey(question));
    if (!raw) return null;
    return JSON.parse(raw) as { sources: Source[]; updatedAt: number };
  } catch {
    return null;
  }
}

function writeCache(question: string, sources: Source[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(
      cacheKey(question),
      JSON.stringify({ sources, updatedAt: Date.now() })
    );
  } catch {
    // quota exceeded — silent
  }
}

// ---------------------------------------------------------------------------
// ZhihuSearchProvider with degradation
// ---------------------------------------------------------------------------

const ZHIHU_DEMO_SOURCES: Omit<Source, 'id'>[] = [
  {
    type: 'zhihu',
    author: '张三',
    title: 'AI 会取代程序员吗？——从历史技术演进角度分析',
    url: 'https://www.zhihu.com/question/10001',
    excerpt: '回顾历次技术浪潮，每次都会创造新的岗位而非消灭所有旧岗位。AI 编程助手本质上是工具升级，程序员需要从"写代码"转向"管理 AI 写代码"。',
  },
  {
    type: 'zhihu',
    author: '李四',
    title: '大模型时代，普通开发者如何保持竞争力',
    url: 'https://www.zhihu.com/question/10002',
    excerpt: '核心观点是：理解业务场景和系统架构的能力比手写代码速度更重要。AI 擅长的是语法层面的生成，人类擅长的是需求拆解和决策判断。',
  },
  {
    type: 'zhihu',
    author: '王五',
    title: '我对 AI 生成代码质量的实际观察',
    url: 'https://www.zhihu.com/question/10003',
    excerpt: '经过半年使用 AI 辅助编程，发现代码质量高度依赖提示词工程。简单需求 AI 完成度高，但复杂业务逻辑仍需人工审查和重构。',
  },
  {
    type: 'zhihu',
    author: '赵六',
    title: '从招聘角度看 AI 对程序员岗位的影响',
    url: 'https://www.zhihu.com/question/10004',
    excerpt: '公司招聘初级工程师的标准正在变化：不再考察语法记忆，而是考察问题定义能力和 AI 工具使用熟练度。',
  },
];

export interface ZhihuSearchProviderOptions {
  simulateFailure?: boolean;
}

export class ZhihuSearchProvider {
  private simulateFailure: boolean;

  constructor(private options: ZhihuSearchProviderOptions = {}) {
    this.simulateFailure = options.simulateFailure ?? false;
  }

  /** Search with degradation: fresh cache → stale cache → demo (fixture content is never labeled 'live' — #18). */
  async search(question: string): Promise<SearchResult> {
    // 1. Check fresh cache first
    const cached = readCache(question);
    if (cached) {
      const age = Date.now() - cached.updatedAt;
      const stale = age > TTL_MS;
      if (!stale) {
        return { sources: cached.sources, source: 'cache' };
      }
      // Stale cache — trigger background refresh and return stale
      this.refreshInBackground(question);
      return { sources: cached.sources, source: 'cache', stale: true };
    }

    // 2. Simulated fetch (#18 honesty, fixture-only path since #19): this
    //    provider class has no real retrieval — fetchLive serves hardcoded
    //    fixture content. Labeling it 'live' would disguise fixture data as
    //    real-time retrieval, so it is reported as demo data.
    if (!this.simulateFailure) {
      try {
        const sources = await this.fetchLive(question);
        writeCache(question, sources);
        return { sources, source: 'demo' };
      } catch {
        // fall through to demo
      }
    }

    // 3. Fall back to demo
    const demoSources = getDemoSources(question, 'zhihu');
    return { sources: demoSources, source: 'demo' };
  }

  /** Simulated fetch: serves fixture content after a short delay (#18 — labeled demo, never live). */
  private async fetchLive(question: string): Promise<Source[]> {
    // Simulate network delay (200-400ms)
    const delay = 200 + Math.abs(this.hashCode(question)) % 200;
    await new Promise<void>(resolve => setTimeout(resolve, delay));

    if (this.simulateFailure) {
      throw new Error('Simulated live failure');
    }

    const normalized = question.trim().toLowerCase();
    const count = 3 + (Math.abs(this.hashCode(normalized)) % 3);
    const selected = ZHIHU_DEMO_SOURCES.slice(0, count);
    return selected.map((s, i) => ({
      ...s,
      id: `zhihu_${Math.abs(this.hashCode(normalized))}_${i}`,
    }));
  }

  private hashCode(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return hash;
  }

  private refreshInBackground(question: string): void {
    this.fetchLive(question)
      .then(sources => writeCache(question, sources))
      .catch(() => { /* silent — stale data still shown */ });
  }
}

// ---------------------------------------------------------------------------
// WebSearchProvider with degradation
// ---------------------------------------------------------------------------

const WEB_DEMO_SOURCES: Omit<Source, 'id'>[] = [
  {
    type: 'web',
    author: 'GitHub Blog',
    title: 'How GitHub Copilot Changes Developer Workflow',
    url: 'https://github.blog/2024-ai-developer-workflow/',
    excerpt: 'A study of 1M+ Copilot users shows 55% reduction in time spent on boilerplate code, with mixed results on architectural decision tasks.',
  },
  {
    type: 'web',
    author: 'ACM TechReport',
    title: 'Assessing AI-Generated Code: A Comparative Study',
    url: 'https://dl.acm.org/doi/example/ai-code-quality-2024',
    excerpt: 'Benchmark of GPT-4 and Claude 3 on real-world codebases shows AI excels at pattern matching but struggles with cross-cutting concerns.',
  },
  {
    type: 'web',
    author: 'IEEE Spectrum',
    title: 'The Future of Software Engineering in an AI-First World',
    url: 'https://spectrum.ieee.org/software-engineering-ai-2024',
    excerpt: 'Industry survey of 500 CTOs: 78% have integrated AI tools, but only 12% have reduced headcount. The role is transforming, not disappearing.',
  },
];

export interface WebSearchProviderOptions {
  simulateFailure?: boolean;
}

export class WebSearchProvider {
  private simulateFailure: boolean;

  constructor(private options: WebSearchProviderOptions = {}) {
    this.simulateFailure = options.simulateFailure ?? false;
  }

  /** Search with degradation: fresh cache → stale cache → demo (fixture content is never labeled 'live' — #18). */
  async search(question: string): Promise<SearchResult> {
    // 1. Check fresh cache first
    const cached = readCache(question);
    if (cached) {
      const age = Date.now() - cached.updatedAt;
      const stale = age > TTL_MS;
      if (!stale) {
        return { sources: cached.sources, source: 'cache' };
      }
      // Stale cache — trigger background refresh and return stale
      this.refreshInBackground(question);
      return { sources: cached.sources, source: 'cache', stale: true };
    }

    // 2. Simulated fetch (#18 honesty, fixture-only path since #19): this
    //    provider class has no real retrieval — fetchLive serves hardcoded
    //    fixture content. Labeling it 'live' would disguise fixture data as
    //    real-time retrieval, so it is reported as demo data.
    if (!this.simulateFailure) {
      try {
        const sources = await this.fetchLive(question);
        writeCache(question, sources);
        return { sources, source: 'demo' };
      } catch {
        // fall through to demo
      }
    }

    // 3. Fall back to demo
    const demoSources = getDemoSources(question, 'web');
    return { sources: demoSources, source: 'demo' };
  }

  private async fetchLive(question: string): Promise<Source[]> {
    const delay = 300 + Math.abs(this.hashCode(question)) % 200;
    await new Promise<void>(resolve => setTimeout(resolve, delay));

    if (this.simulateFailure) {
      throw new Error('Simulated live failure');
    }

    const normalized = question.trim().toLowerCase();
    const count = 2 + (Math.abs(this.hashCode(normalized + '_web')) % 2);
    const selected = WEB_DEMO_SOURCES.slice(0, count);
    return selected.map((s, i) => ({
      ...s,
      id: `web_${Math.abs(this.hashCode(normalized + '_web'))}_${i}`,
    }));
  }

  private hashCode(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return hash;
  }

  private refreshInBackground(question: string): void {
    this.fetchLive(question)
      .then(sources => writeCache(question, sources))
      .catch(() => { /* silent */ });
  }
}
