import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  BrowserStorageProvider,
  StaticReportRenderer,
  buildResultCard,
} from '../../src/lib/demo-providers';
import {
  AnonymousIdentityProvider,
  FixtureLLMProvider,
  FixtureRetrievalProvider,
} from '../../src/lib/fixture-providers';
import {
  HotlistProvider,
} from '../../src/lib/hotlist-providers';
import {
  ZhihuSearchProvider,
  WebSearchProvider,
} from '../../src/lib/search-providers';
import { HistorySearchProvider, toHistorySessionSnapshots } from '../../src/lib/history-search';
import { getDemoSources } from '../../src/lib/demo-sources';
import { buildReport } from '../../src/lib/report-builder';
import { buildGraph } from '../../src/lib/knowledge-graph';
import { type Message, type Session, type Source } from '../../src/lib/providers';

// Minimal localStorage mock for Node.js environment
type Store = Record<string, string>;

// Module-level storage shared across search provider tests
const storage = new Map<string, string>();

// Global storage object that mimics localStorage interface
const mockLocalStorage = {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => { storage.set(k, v); },
  removeItem: (k: string) => { storage.delete(k); },
  clear: () => { storage.clear(); },
  get length() { return storage.size; },
  key: (i: number) => Array.from(storage.keys())[i] ?? null,
};

function makeProvider(): { provider: BrowserStorageProvider; store: Store } {
  const store: Store = {};
  // BrowserStorageProvider needs its own isolated store for each test
  const isolatedLS = {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  };
  // Use direct assignment to set globalThis.localStorage
  (globalThis as any).localStorage = isolatedLS;
  return { provider: new BrowserStorageProvider(), store };
}

function clearCache(): void {
  storage.clear();
}

// For search provider tests: set up localStorage mock pointing to shared storage
function setupSearchProviderStorage(): void {
  (globalThis as any).localStorage = mockLocalStorage;
}

// ---------------------------------------------------------------------------
// ZhihuSearchProvider contract (#4 + #5 degradation)
// ---------------------------------------------------------------------------
describe('ZhihuSearchProvider', () => {
  beforeEach(() => {
    clearCache();
  });

  afterEach(() => {
    clearCache();
  });

  it('returns 3-5 sources with type zhihu and all fields populated', async () => {
    const provider = new ZhihuSearchProvider();
    const result = await provider.search('AI 会取代程序员吗');
    assert.ok(result.sources.length >= 3, `expected >= 3, got ${result.sources.length}`);
    assert.ok(result.sources.length <= 5, `expected <= 5, got ${result.sources.length}`);
    for (const s of result.sources) {
      assert.strictEqual(s.type, 'zhihu');
      assert.ok(typeof s.id === 'string' && s.id.length > 0, 'missing id');
      assert.ok(typeof s.author === 'string' && s.author.length > 0, 'missing author');
      assert.ok(typeof s.title === 'string' && s.title.length > 0, 'missing title');
      assert.ok(typeof s.url === 'string' && s.url.length > 0, 'missing url');
      assert.ok(typeof s.excerpt === 'string' && s.excerpt.length > 0, 'missing excerpt');
      assert.ok(s.url!.startsWith('https://www.zhihu.com'), `bad url: ${s.url}`);
    }
  });

  it('is deterministic: same question => same sources', async () => {
    const provider = new ZhihuSearchProvider();
    const a = await provider.search('确定性测试');
    const b = await provider.search('确定性测试');
    assert.deepStrictEqual(a.sources, b.sources);
  });

  // Honesty contract (#18, restated for #19): this fixture-only provider path
  // has no real retrieval, so its hardcoded fixture content must never be
  // reported as 'live' — only the real providers in zhihu-retrieval.ts may.
  it('reports demo on the first uncached call — fixture content is never labeled live', async () => {
    setupSearchProviderStorage();
    const provider = new ZhihuSearchProvider();
    const result = await provider.search('live test');
    assert.strictEqual(result.source, 'demo');
  });

  it('returns source=cache when cache is fresh', async () => {
    setupSearchProviderStorage();

    const p1 = new ZhihuSearchProvider();
    await p1.search('cached question');
    const p2 = new ZhihuSearchProvider();
    const result = await p2.search('cached question');
    assert.strictEqual(result.source, 'cache');
    assert.strictEqual(result.stale, undefined);
  });

  it('returns demo when live fails and no cache exists', async () => {
    // In this test environment, live doesn't actually fail (no real API),
    // so we use simulateFailure=true to simulate live failure
    setupSearchProviderStorage();
    const provider = new ZhihuSearchProvider({ simulateFailure: true });
    const result = await provider.search('no cache demo test');
    // With simulateFailure, live throws, no cache exists, so demo is returned
    assert.strictEqual(result.source, 'demo');
  });

  it('returns demo when simulateFailure=true and no cache', async () => {
    setupSearchProviderStorage();
    const provider = new ZhihuSearchProvider({ simulateFailure: true });
    const result = await provider.search('simulated failure test');
    assert.strictEqual(result.source, 'demo');
    assert.ok(result.sources.length > 0);
    assert.ok(result.sources.every(s => s.type === 'zhihu'));
  });

  it('stale cache returns with stale=true', async () => {
    const key = 'zhiyan_search_cache_' + hashQuestion('stale question');
    storage.set(key, JSON.stringify({
      sources: [{ id: 'old_1', type: 'zhihu', author: 'Old', title: 'Old Title', url: 'https://old.com', excerpt: 'Old excerpt' }],
      updatedAt: Date.now() - 86_400_001, // older than 24h + 1ms
    }));
    setupSearchProviderStorage();

    const provider = new ZhihuSearchProvider();
    const result = await provider.search('stale question');
    assert.strictEqual(result.source, 'cache');
    assert.strictEqual(result.stale, true);
  });

  // Ticket #18: the chain starts at demo — the fetch that serves fixture
  // content must be labeled demo, so 'live' is never emitted for fixtures.
  it('fallback chain order: demo → fresh cache → stale cache → demo', async () => {
    setupSearchProviderStorage();

    // Step 1: First call — uncached fixture content, honestly labeled demo
    const p1 = new ZhihuSearchProvider();
    const r1 = await p1.search('chain question');
    assert.strictEqual(r1.source, 'demo');

    // Step 2: Second call — fresh cache
    const p2 = new ZhihuSearchProvider();
    const r2 = await p2.search('chain question');
    assert.strictEqual(r2.source, 'cache');
    assert.strictEqual(r2.stale, undefined);

    // Step 3: Stale cache
    const staleKey = 'zhiyan_search_cache_' + hashQuestion('chain question');
    storage.set(staleKey, JSON.stringify({
      sources: r1.sources,
      updatedAt: Date.now() - 86_400_001,
    }));
    const p3 = new ZhihuSearchProvider();
    const r3 = await p3.search('chain question');
    assert.strictEqual(r3.source, 'cache');
    assert.strictEqual(r3.stale, true);

    // Step 4: Clear cache + simulateFailure — demo
    storage.delete(staleKey);
    const p4 = new ZhihuSearchProvider({ simulateFailure: true });
    const r4 = await p4.search('chain question');
    assert.strictEqual(r4.source, 'demo');
  });
});

// ---------------------------------------------------------------------------
// WebSearchProvider contract (#4 + #5 degradation)
// ---------------------------------------------------------------------------
describe('WebSearchProvider', () => {
  it('returns 2-3 sources with type web and all fields populated', async () => {
    const provider = new WebSearchProvider();
    const result = await provider.search('AI 会取代程序员吗');
    assert.ok(result.sources.length >= 2, `expected >= 2, got ${result.sources.length}`);
    assert.ok(result.sources.length <= 3, `expected <= 3, got ${result.sources.length}`);
    for (const s of result.sources) {
      assert.strictEqual(s.type, 'web');
      assert.ok(typeof s.id === 'string' && s.id.length > 0, 'missing id');
      assert.ok(typeof s.author === 'string' && s.author.length > 0, 'missing author');
      assert.ok(typeof s.title === 'string' && s.title.length > 0, 'missing title');
      assert.ok(typeof s.url === 'string' && s.url.length > 0, 'missing url');
      assert.ok(typeof s.excerpt === 'string' && s.excerpt.length > 0, 'missing excerpt');
      assert.ok(s.url!.startsWith('https://'), `bad url: ${s.url}`);
    }
  });

  it('is deterministic: same question => same sources', async () => {
    const provider = new WebSearchProvider();
    const a = await provider.search('确定性测试');
    const b = await provider.search('确定性测试');
    assert.deepStrictEqual(a.sources, b.sources);
  });

  // Ticket #18 honesty contract: this fixture-only provider path must never
  // report its hardcoded fixture content as 'live' (#19: only the real
  // providers in zhihu-retrieval.ts may emit 'live').
  it('reports demo on the first uncached call — fixture content is never labeled live', async () => {
    setupSearchProviderStorage();
    const provider = new WebSearchProvider();
    const result = await provider.search('web live test');
    assert.strictEqual(result.source, 'demo');
  });

  it('returns source=cache when cache is fresh', async () => {
    setupSearchProviderStorage();

    const p1 = new WebSearchProvider();
    await p1.search('web cached question');
    const p2 = new WebSearchProvider();
    const result = await p2.search('web cached question');
    assert.strictEqual(result.source, 'cache');
  });

  it('returns demo when simulateFailure=true and no cache', async () => {
    setupSearchProviderStorage();
    const provider = new WebSearchProvider({ simulateFailure: true });
    const result = await provider.search('web simulated failure test');
    assert.strictEqual(result.source, 'demo');
    assert.ok(result.sources.every(s => s.type === 'web'));
  });

  it('stale cache returns with stale=true', async () => {
    const key = 'zhiyan_search_cache_' + hashQuestion('stale web question');
    storage.set(key, JSON.stringify({
      sources: [{ id: 'web_stale_1', type: 'web', author: 'Web Stale', title: 'Web Stale Title', url: 'https://webstale.com', excerpt: 'Web stale excerpt' }],
      updatedAt: Date.now() - 86_400_001,
    }));
    setupSearchProviderStorage();

    const provider = new WebSearchProvider();
    const result = await provider.search('stale web question');
    assert.strictEqual(result.source, 'cache');
    assert.strictEqual(result.stale, true);
  });
});

// ---------------------------------------------------------------------------
// getDemoSources contract (#5)
// ---------------------------------------------------------------------------
describe('getDemoSources', () => {
  it('returns at least 3 zhihu + 2 web demo sources', () => {
    const all = getDemoSources('test question', 'all');
    const zhihu = all.filter(s => s.type === 'zhihu');
    const web = all.filter(s => s.type === 'web');
    assert.ok(zhihu.length >= 3, `expected >= 3 zhihu, got ${zhihu.length}`);
    assert.ok(web.length >= 2, `expected >= 2 web, got ${web.length}`);
  });

  it('returns zhihu-only sources when type is zhihu', () => {
    const sources = getDemoSources('test', 'zhihu');
    assert.ok(sources.every(s => s.type === 'zhihu'));
    assert.ok(sources.length >= 3);
  });

  it('returns web-only sources when type is web', () => {
    const sources = getDemoSources('test', 'web');
    assert.ok(sources.every(s => s.type === 'web'));
    assert.ok(sources.length >= 2);
  });

  it('generates deterministic ids based on question', () => {
    const sources1 = getDemoSources('same question', 'zhihu');
    const sources2 = getDemoSources('same question', 'zhihu');
    assert.deepStrictEqual(sources1.map(s => s.id), sources2.map(s => s.id));

    const different = getDemoSources('different question', 'zhihu');
    assert.notStrictEqual(
      sources1.map(s => s.id).join(','),
      different.map(s => s.id).join(',')
    );
  });
});

// ---------------------------------------------------------------------------
// Source state reporting (#5)
// ---------------------------------------------------------------------------
describe('Source state reporting', () => {
  it('ZhihuSearchProvider reports correct source state', async () => {
    setupSearchProviderStorage();

    // demo (first uncached call — fixture content, never 'live') (#18)
    const first = new ZhihuSearchProvider();
    const firstResult = await first.search('source state test');
    assert.strictEqual(firstResult.source, 'demo');

    // cache
    const cache = new ZhihuSearchProvider();
    const cacheResult = await cache.search('source state test');
    assert.strictEqual(cacheResult.source, 'cache');

    // demo — need to clear cache first so demo provider has no cache to find
    clearCache();
    const demo = new ZhihuSearchProvider({ simulateFailure: true });
    const demoResult = await demo.search('source state test');
    assert.strictEqual(demoResult.source, 'demo');
  });

  it('WebSearchProvider reports correct source state', async () => {
    setupSearchProviderStorage();

    // demo (first uncached call — fixture content, never 'live') (#18)
    const first = new WebSearchProvider();
    const firstResult = await first.search('web source state test');
    assert.strictEqual(firstResult.source, 'demo');

    const cache = new WebSearchProvider();
    const cacheResult = await cache.search('web source state test');
    assert.strictEqual(cacheResult.source, 'cache');

    // demo — need to clear cache first
    clearCache();
    const demo = new WebSearchProvider({ simulateFailure: true });
    const demoResult = await demo.search('web source state test');
    assert.strictEqual(demoResult.source, 'demo');
  });
});

// ---------------------------------------------------------------------------
// Parallel search behavior (#4)
// ---------------------------------------------------------------------------
describe('Parallel search behavior', () => {
  it('ZhihuSearchProvider and WebSearchProvider run concurrently', async () => {
    setupSearchProviderStorage();

    const start = Date.now();
    const zhihu = new ZhihuSearchProvider();
    const web = new WebSearchProvider();
    await Promise.all([
      zhihu.search('并行测试'),
      web.search('并行测试'),
    ]);
    const elapsed = Date.now() - start;
    // Serial would be ~400-1000ms; parallel should be faster
    assert.ok(elapsed < 800, `expected parallel < 800ms, got ${elapsed}ms`);
  });
});

// ---------------------------------------------------------------------------
// Remaining existing tests (unchanged from #4 baseline)
// ---------------------------------------------------------------------------

const makeHotlistProvider = (store?: Record<string, string>): { provider: HotlistProvider; ls: Store } => {
  const ls: Store = store ?? {};
  // HotlistProvider uses its own isolated localStorage mock
  const isolatedLS = {
    getItem: (k: string) => ls[k] ?? null,
    setItem: (k: string, v: string) => { ls[k] = v; },
    removeItem: (k: string) => { delete ls[k]; },
    clear: () => { Object.keys(ls).forEach(k => delete ls[k]); },
    get length() { return Object.keys(ls).length; },
    key(i: number) { return Object.keys(ls)[i] ?? null; },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: isolatedLS, configurable: true });
  return { provider: new HotlistProvider(), ls };
};

describe('HotlistProvider', () => {
  it('returns demo items when no cache exists', async () => {
    const { provider } = makeHotlistProvider();
    const result = await provider.fetchHotlist();
    assert.strictEqual(result.source, 'demo');
    assert.ok(result.items.length > 0);
    assert.ok(result.items.every(item => item.id && item.title && item.url));
  });

  it('returns cached items before falling back to demo', async () => {
    const store: Record<string, string> = {};
    const { provider: p1 } = makeHotlistProvider(store);
    const first = await p1.fetchHotlist();
    assert.strictEqual(first.source, 'demo');
    const { provider: p2 } = makeHotlistProvider(store);
    const second = await p2.fetchHotlist();
    assert.strictEqual(second.source, 'cache');
    assert.deepStrictEqual(second.items, first.items);
  });

  it('returns stale cache with stale:true instead of demo', async () => {
    const store: Record<string, string> = {};
    const { provider: p1 } = makeHotlistProvider(store);
    const first = await p1.fetchHotlist();
    assert.strictEqual(first.source, 'demo');
    const stale = { ...first, updatedAt: Date.now() - 86_400_001 };
    store['zhiyan_hotlist_cache'] = JSON.stringify(stale);
    const { provider: p2 } = makeHotlistProvider(store);
    const second = await p2.fetchHotlist();
    assert.strictEqual(second.source, 'cache');
    assert.strictEqual(second.stale, true);
    assert.deepStrictEqual(second.items, first.items);
  });

  it('returns stale cache with stale flag', async () => {
    const store: Record<string, string> = {};
    const { provider: p1 } = makeHotlistProvider(store);
    const first = await p1.fetchHotlist();
    assert.strictEqual(first.source, 'demo');
    const staleEntry = { ...first, updatedAt: Date.now() - 100_000_000 };
    store['zhiyan_hotlist_cache'] = JSON.stringify(staleEntry);
    const { provider: p2 } = makeHotlistProvider(store);
    const result = await p2.fetchHotlist();
    assert.strictEqual(result.source, 'cache');
    assert.strictEqual(result.stale, true);
    assert.deepStrictEqual(result.items, first.items);
  });

  it('roundtrips cache correctly', async () => {
    const store: Record<string, string> = {};
    const { provider: p1 } = makeHotlistProvider(store);
    await p1.fetchHotlist();
    assert.ok(store['zhiyan_hotlist_cache']);
    const parsed = JSON.parse(store['zhiyan_hotlist_cache']);
    assert.strictEqual(parsed.source, 'demo');
    assert.ok(Array.isArray(parsed.items));
    assert.ok(typeof parsed.updatedAt === 'number');
  });

  it('has exactly 10 demo items', async () => {
    const { provider } = makeHotlistProvider();
    const result = await provider.fetchHotlist();
    assert.strictEqual(result.items.length, 10);
  });
});

describe('FixtureRetrievalProvider', () => {
  it('generates a report with all required fields', async () => {
    const provider = new FixtureRetrievalProvider();
    const report = await provider.generateReport('AI创造力?');
    assert.ok(report.title);
    assert.ok(report.knowledgePoints.length > 0);
    assert.ok(report.content.length > 0);
    assert.ok(report.viewpoints.length > 0);
  });

  it('report has references and citations fields', async () => {
    const provider = new FixtureRetrievalProvider();
    const report = await provider.generateReport('test');
    assert.ok(Array.isArray(report.references));
    assert.deepStrictEqual(report.references, []);
    assert.ok(!('graph' in report));
    assert.ok(Object.keys(report.citations).length === 0);
  });

  it('is deterministic: same input => same output', async () => {
    const provider = new FixtureRetrievalProvider();
    const a = await provider.generateReport('q');
    const b = await provider.generateReport('q');
    assert.deepStrictEqual(a, b);
  });
});

// Ticket #18 dead-code cleanup: the two tests for FixtureLLMProvider.
// generateQuestion were removed together with that method — it was dropped
// from the LLMProvider contract in #15 and has zero production callers.
// generateStrategyQuestion (the live contract) is covered further below.

describe('BrowserStorageProvider', () => {
  it('roundtrips a session', async () => {
    const { provider } = makeProvider();
    const session: Session = {
      id: 's1', question: 'test?', initialOpinion: null, report: null,
      selectedViewpoint: null, messages: [], resultCard: null, completed: false,
      createdAt: 0, updatedAt: 0,
    };
    await provider.saveSession(session);
    const loaded = await provider.loadSession('s1');
    assert.ok(loaded);
    assert.strictEqual(loaded!.id, 's1');
    assert.strictEqual(loaded!.question, 'test?');
  });

  it('returns null for missing session', async () => {
    const { provider } = makeProvider();
    assert.strictEqual(await provider.loadSession('nope'), null);
  });

  it('lists sessions sorted by updatedAt desc', async () => {
    const { provider } = makeProvider();
    const store = (provider as unknown as { store: Store }).store;
    const makeSession = (id: string, updatedAt: number): Session => ({
      id,
      question: id,
      initialOpinion: null,
      report: null,
      selectedViewpoint: null,
      messages: [],
      resultCard: null,
      completed: false,
      createdAt: updatedAt,
      updatedAt,
    });
    await provider.saveSession(makeSession('old', 100));
    await provider.saveSession(makeSession('new', 200));
    const list = await provider.listSessions();
    assert.strictEqual(list[0]!.id, 'new');
    assert.strictEqual(list[1]!.id, 'old');
  });

  it('deletes a session', async () => {
    const { provider } = makeProvider();
    const makeSession = (id: string, updatedAt: number): Session => ({
      id,
      question: id,
      initialOpinion: null,
      report: null,
      selectedViewpoint: null,
      messages: [],
      resultCard: null,
      completed: false,
      createdAt: updatedAt,
      updatedAt,
    });
    await provider.saveSession(makeSession('del', 1));
    await provider.deleteSession('del');
    assert.strictEqual(await provider.loadSession('del'), null);
  });
});

describe('AnonymousIdentityProvider', () => {
  it('returns anonymous identity', async () => {
    const provider = new AnonymousIdentityProvider();
    const identity = await provider.getCurrentIdentity();
    assert.strictEqual(identity.type, 'anonymous');
    assert.ok(identity.id.length > 0);
  });
});

describe('StaticReportRenderer', () => {
  it('returns stable presentation models without mutating provider data', async () => {
    const report = await new FixtureRetrievalProvider().generateReport('q');
    const rendered = await new StaticReportRenderer().renderReport(report);
    assert.deepStrictEqual(rendered, report);
    assert.notStrictEqual(rendered, report);
  });
});

describe('buildResultCard', () => {
  it('preserves user_authored initial stance', () => {
    const card = buildResultCard({
      id: 's', question: 'q', initialOpinion: 'I think X',
      report: null, selectedViewpoint: null, messages: [],
      resultCard: null, completed: false, createdAt: 0, updatedAt: 0,
    });
    assert.ok(card.initialStance);
    assert.strictEqual(card.initialStance!.source, 'user_authored');
    assert.strictEqual(card.initialStance!.text, 'I think X');
  });

  it('preserves source on selectedStartingStance', () => {
    const card = buildResultCard({
      id: 's', question: 'q', initialOpinion: null,
      selectedViewpoint: { id: 'v1', text: 'selected', source: 'ai_suggested_and_selected' },
      messages: [{ id: 'u1', role: 'user', text: 'reply', timestamp: 0 }],
      report: null, resultCard: null, completed: false, createdAt: 0, updatedAt: 0,
    });
    assert.ok(card.selectedStartingStance);
    assert.strictEqual(card.selectedStartingStance!.source, 'ai_suggested_and_selected');
  });

  it('excludes assistant messages from messageIds', () => {
    const card = buildResultCard({
      id: 's', question: 'q', initialOpinion: null, selectedViewpoint: null,
      messages: [
        { id: 'u1', role: 'user', text: 'a', timestamp: 0 },
        { id: 'a1', role: 'assistant', text: 'q?', timestamp: 0 },
        { id: 'u2', role: 'user', text: 'b', timestamp: 0 },
      ],
      report: null, resultCard: null, completed: false, createdAt: 0, updatedAt: 0,
    });
    assert.ok(card.messageIds.includes('u1'));
    assert.ok(card.messageIds.includes('u2'));
    assert.ok(!card.messageIds.includes('a1'));
  });
});

describe('ReportBuilder', () => {
  it('produces references count equal to input sources', async () => {
    const zhihuSources: Source[] = [
      { id: 'zh_1', type: 'zhihu', author: '张三', title: 'T1', url: 'https://www.zhihu.com/q/1', excerpt: 'E1' },
    ];
    const webSources: Source[] = [
      { id: 'web_1', type: 'web', author: 'Blog', title: 'T2', url: 'https://example.com/1', excerpt: 'E2' },
    ];
    const { report } = await buildReport({ question: 'test', zhihuSources, webSources });
    assert.strictEqual(report.references.length, 2);
    assert.strictEqual(report.citations[1]!.id, 'zh_1');
    assert.strictEqual(report.citations[2]!.id, 'web_1');
  });

  it('content contains citation markers that match references', async () => {
    const zhihuSources: Source[] = [
      { id: 'zh_1', type: 'zhihu', author: '张三', title: 'T1', url: 'https://www.zhihu.com/q/1', excerpt: 'E1' },
      { id: 'zh_2', type: 'zhihu', author: '李四', title: 'T2', url: 'https://www.zhihu.com/q/2', excerpt: 'E2' },
    ];
    const webSources: Source[] = [
      { id: 'web_1', type: 'web', author: 'Blog', title: 'T3', url: 'https://example.com/1', excerpt: 'E3' },
    ];
    const { report } = await buildReport({ question: 'test', zhihuSources, webSources });
    assert.ok(report.content.includes('[1]'), 'content should contain [1]');
    assert.ok(report.content.includes('[2]'), 'content should contain [2]');
    assert.ok(report.content.includes('[3]'), 'content should contain [3]');
    assert.strictEqual(report.references[0]!.type, 'zhihu');
    assert.strictEqual(report.references[1]!.type, 'zhihu');
    assert.strictEqual(report.references[2]!.type, 'web');
  });

  it('uses the claim–evidence–reasoning format without injecting unsupported conclusions', async () => {
    const zhihuSources: Source[] = [
      { id: 'zh_1', type: 'zhihu', author: '张三', title: '材料标题', url: 'https://www.zhihu.com/q/1', excerpt: '这是一条可验证的材料观点。' },
    ];
    const { report } = await buildReport({ question: '测试问题', zhihuSources, webSources: [] });
    assert.ok(report.content.includes('## 一句话结论'));
    assert.ok(report.content.includes('### 观点 1：材料标题'));
    assert.ok(report.content.includes('证明材料：[1] 知乎社区观点材料，作者：张三'));
    assert.ok(report.content.includes('这是一条可验证的材料观点。'));
    assert.ok(report.content.includes('推理：'));
    assert.ok(report.content.includes('反证或不同观点：'));
    assert.ok(report.content.includes('局限：'));
    assert.ok(report.content.includes('## 尚待验证'));
    assert.ok(!report.content.includes('AI 不会取代程序员'));
  });

  it('deduplicates sources by id', async () => {
    const zhihuSources: Source[] = [
      { id: 'dup', type: 'zhihu', author: 'A', title: 'T', url: 'https://zhihu.com/dup', excerpt: 'E' },
    ];
    const webSources: Source[] = [
      { id: 'dup', type: 'web', author: 'B', title: 'T', url: 'https://example.com/dup', excerpt: 'E' },
    ];
    const { report } = await buildReport({ question: 'dedup test', zhihuSources, webSources });
    assert.strictEqual(report.references.length, 1);
  });

  it('handles empty sources with fallback content', async () => {
    const { report } = await buildReport({ question: 'empty', zhihuSources: [], webSources: [] });
    assert.strictEqual(report.references.length, 0);
    assert.ok(report.content.length > 0);
    assert.ok(report.knowledgePoints.length > 0);
    assert.ok(report.viewpoints.length > 0);
  });

  it('emits all progress stages', async () => {
    const stages: string[] = [];
    const { progress } = await buildReport({
      question: 'progress test',
      zhihuSources: [],
      webSources: [],
      onProgress: (evt) => stages.push(evt.stage),
    });
    assert.ok(stages.includes('zhihu_search'), `missing zhihu_search in ${stages}`);
    assert.ok(stages.includes('web_search'), `missing web_search in ${stages}`);
    assert.ok(stages.includes('synthesizing'), `missing synthesizing in ${stages}`);
    assert.ok(stages.includes('complete'), `missing complete in ${stages}`);
  });

  // Ticket #23: null metadata must not render as literal "null" or "undefined"
  it('does not render literal null/undefined for missing source metadata', async () => {
    const nullMetaSources: Source[] = [
      {
        id: 'null_excerpt_zh',
        type: 'zhihu',
        author: null,
        title: null,
        url: null,
        excerpt: null,
      },
      {
        id: 'null_excerpt_web',
        type: 'web',
        author: null,
        title: null,
        url: null,
        excerpt: null,
      },
    ];
    const { report } = await buildReport({
      question: 'missing data test',
      zhihuSources: [nullMetaSources[0]!],
      webSources: [nullMetaSources[1]!],
    });

    // The report content must not contain the string "null" or "undefined"
    // (using word-boundary check to avoid false positives from the question text)
    const nullWordRE = /\bnull\b/;
    const undefinedWordRE = /\bundefined\b/;
    assert.ok(
      !nullWordRE.test(report.content),
      `content should not contain literal "null", got: ${report.content}`
    );
    assert.ok(
      !undefinedWordRE.test(report.content),
      `content should not contain literal "undefined", got: ${report.content}`
    );

    // References preserve original null values (not fabricated) — UI layer handles presentation
    assert.strictEqual(report.references[0]!.excerpt, null);
    assert.strictEqual(report.references[0]!.author, null);
    assert.strictEqual(report.references[0]!.url, null);
    assert.strictEqual(report.references[1]!.excerpt, null);
    assert.strictEqual(report.references[1]!.author, null);
    assert.strictEqual(report.references[1]!.url, null);
  });

  // Ticket #23: missing excerpt shows a placeholder, not null
  it('renders missing excerpt as placeholder text', async () => {
    const sourcesWithMissingExcerpt: Source[] = [
      {
        id: 'no_excerpt',
        type: 'zhihu',
        author: '真实作者',
        title: '真实标题',
        url: 'https://www.zhihu.com/real',
        excerpt: null,
      },
    ];
    const { report } = await buildReport({
      question: 'missing excerpt test',
      zhihuSources: sourcesWithMissingExcerpt,
      webSources: [],
    });

    // Should contain placeholder, not literal null
    assert.ok(
      report.content.includes('（无摘要）'),
      `expected "（无摘要）" placeholder in content, got: ${report.content}`
    );
    assert.ok(
      !report.content.includes('null'),
      `content should not contain literal "null": ${report.content}`
    );
  });
});

// ---------------------------------------------------------------------------
// HistorySearchProvider contract (#6)
// ---------------------------------------------------------------------------

describe('HistorySearchProvider', () => {
  function makeSession(overrides: Partial<{
    id: string;
    question: string;
    initialOpinion: string | null;
    messages: { id: string; role: 'user' | 'assistant'; text: string; timestamp: number }[];
    completed: boolean;
    updatedAt: number;
  }> = {}): Session {
    return {
      id: 's1',
      question: 'AI 如何看待程序员',
      initialOpinion: null,
      report: null,
      selectedViewpoint: null,
      messages: [],
      resultCard: null,
      completed: true,
      createdAt: 0,
      updatedAt: 100,
      excludedHistoryIds: [],
      ...overrides,
    };
  }

  async function searchHistory(
    question: string,
    sessions: Session[],
    excludedIds: string[] = []
  ) {
    return new HistorySearchProvider().search(
      question,
      toHistorySessionSnapshots(sessions),
      excludedIds
    );
  }

  it('returns matching completed sessions', async () => {
    const session = makeSession({ id: 'match_1', question: 'AI 程序员 未来', completed: true });

    const result = await searchHistory('AI 程序员', [session]);
    assert.strictEqual(result.sources.length, 1);
    assert.strictEqual(result.sources[0]!.type, 'personal_history');
    assert.strictEqual(result.sources[0]!.sourceSessionId, 'match_1');
  });

  it('returns no more than 3 results', async () => {
    const sessions: Session[] = [];
    for (let i = 0; i < 5; i++) {
      sessions.push(makeSession({
        id: `many_${i}`,
        question: 'AI 程序员 测试',
        completed: true,
        updatedAt: i,
      }));
    }

    const result = await searchHistory('AI 程序员', sessions);
    assert.ok(result.sources.length <= 3, `expected <= 3, got ${result.sources.length}`);
  });

  it('excludes sessions by ID', async () => {
    const session = makeSession({ id: 'exclude_me', question: 'AI 程序员 未来', completed: true });

    const result = await searchHistory('AI 程序员', [session], ['exclude_me']);
    assert.strictEqual(result.sources.length, 0);
  });

  it('sources have type=personal_history and sourceSessionId', async () => {
    const session = makeSession({ id: 'src_check', question: '测试 问题', completed: true });

    const result = await searchHistory('测试', [session]);
    assert.strictEqual(result.sources.length, 1);
    const src = result.sources[0]!;
    assert.strictEqual(src.type, 'personal_history');
    assert.strictEqual(src.sourceSessionId, 'src_check');
    assert.ok(src.provenance);
  });

  it('returns empty when no sessions match', async () => {
    const session = makeSession({ id: 'nomatch', question: '完全不相关的问题', completed: true });

    const result = await searchHistory('AI 程序员', [session]);
    assert.strictEqual(result.sources.length, 0);
  });

  it('skips incomplete sessions', async () => {
    const session = makeSession({ id: 'incomplete', question: 'AI 程序员', completed: false });

    const result = await searchHistory('AI 程序员', [session]);
    assert.strictEqual(result.sources.length, 0);
  });

  it('uses initialOpinion as excerpt when present', async () => {
    const session = makeSession({
      id: 'with_opinion',
      question: 'AI 程序员',
      initialOpinion: '这是我的个人观点',
      completed: true,
    });

    const result = await searchHistory('AI 程序员', [session]);
    assert.strictEqual(result.sources.length, 1);
    assert.strictEqual(result.sources[0]!.excerpt, '这是我的个人观点');
  });

  it('uses first user message as excerpt when no initialOpinion', async () => {
    const session = makeSession({
      id: 'with_message',
      question: 'AI 程序员',
      initialOpinion: null,
      messages: [{ id: 'm1', role: 'user', text: '用户的第一条消息', timestamp: 0 }],
      completed: true,
    });

    const result = await searchHistory('AI 程序员', [session]);
    assert.strictEqual(result.sources.length, 1);
    assert.strictEqual(result.sources[0]!.excerpt, '用户的第一条消息');
  });

  it('returns sources sorted by updatedAt desc', async () => {
    const oldSession = makeSession({ id: 'old_s', question: 'AI 程序员', completed: true, updatedAt: 100 });
    const newSession = makeSession({ id: 'new_s', question: 'AI 程序员', completed: true, updatedAt: 200 });

    const result = await searchHistory('AI 程序员', [oldSession, newSession]);
    assert.strictEqual(result.sources.length, 2);
    assert.strictEqual(result.sources[0]!.sourceSessionId, 'new_s');
    assert.strictEqual(result.sources[1]!.sourceSessionId, 'old_s');
  });
});
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

// ---- KnowledgeGraph contract ----
describe('buildGraph', () => {
  const makeSource = (id: string, type: Source['type'], title: string, excerpt: string): Source => ({
    id,
    type,
    author: 'Test Author',
    title,
    url: 'https://example.com',
    excerpt,
  });

  const makeReport = (sources: Source[]) => {
    const citations: Record<number, Source> = {};
    sources.forEach((s, i) => { citations[i + 1] = s; });
    return {
      question: 'AI 创造力',
      title: 'AI 创造力',
      knowledgePoints: ['point'],
      content: 'body',
      viewpoints: ['view'],
      references: sources,
      citations,
    };
  };

  it('returns 6-10 nodes', () => {
    const sources = [
      makeSource('s1', 'zhihu', 'AI 创造力的边界', 'AI 改变创作'),
      makeSource('s2', 'web', 'How AI Changes Programming', 'A study'),
    ];
    const graph = buildGraph(makeReport(sources), sources);
    assert.ok(graph.nodes.length >= 6 && graph.nodes.length <= 10,
      `expected 6-10 nodes, got ${graph.nodes.length}`);
  });

  it('all nodes have label and description', () => {
    const sources = [makeSource('s1', 'zhihu', 'AI 创造力', '内容')];
    const graph = buildGraph(makeReport(sources), sources);
    graph.nodes.forEach(n => {
      assert.ok(n.label.length > 0);
      assert.ok(n.description.length > 0);
    });
  });

  it('supported edges have citationId', () => {
    const sources = [
      makeSource('s1', 'zhihu', 'AI 创造力', 'A'),
      makeSource('s2', 'web', 'Web Study', 'B'),
    ];
    const graph = buildGraph(makeReport(sources), sources);
    const supported = graph.edges.filter(e => e.type === 'supported');
    supported.forEach(e => {
      assert.ok(typeof e.citationId === 'number', 'supported edge needs citationId');
      assert.ok(e.citationId! >= 1);
    });
  });

  it('inferred edges do not have citationId', () => {
    const sources = [
      makeSource('s1', 'zhihu', 'AI', 'A'),
      makeSource('s2', 'web', 'Web', 'B'),
      makeSource('s3', 'zhihu', 'Code', 'C'),
    ];
    const graph = buildGraph(makeReport(sources), sources);
    const inferred = graph.edges.filter(e => e.type === 'inferred');
    inferred.forEach(e => {
      assert.strictEqual(e.citationId, undefined);
    });
  });

  it('is deterministic: same inputs => same graph', () => {
    const sources = [
      makeSource('s1', 'zhihu', 'AI 创造力 编程', '内容 A'),
      makeSource('s2', 'web', 'Web Article', 'B'),
    ];
    const g1 = buildGraph(makeReport(sources), sources);
    const g2 = buildGraph(makeReport(sources), sources);
    assert.deepStrictEqual(g1, g2);
  });

  it('all edge endpoints reference valid node ids', () => {
    const sources = [
      makeSource('s1', 'zhihu', 'AI', 'A'),
      makeSource('s2', 'web', 'Web', 'B'),
    ];
    const graph = buildGraph(makeReport(sources), sources);
    const ids = new Set(graph.nodes.map(n => n.id));
    graph.edges.forEach(e => {
      assert.ok(ids.has(e.from), `invalid from: ${e.from}`);
      assert.ok(ids.has(e.to), `invalid to: ${e.to}`);
    });
  });
});

// ---- Ticket #8: Three distinct viewpoint suggestions ----
import { buildStructuredViewpoints } from '../../src/lib/report-builder';

describe('buildStructuredViewpoints', () => {
  it('returns exactly three viewpoints', () => {
    const vps = buildStructuredViewpoints('AI 创造力', []);
    assert.strictEqual(vps.length, 3);
  });

  it('all viewpoints have source="ai_authored" before selection', () => {
    const vps = buildStructuredViewpoints('test', []);
    vps.forEach((vp) => {
      assert.strictEqual(vp.source, 'ai_authored');
    });
  });

  it('viewpoints are not synonyms (distinct text)', () => {
    const vps = buildStructuredViewpoints('test', []);
    const texts = new Set(vps.map((v) => v.text));
    assert.strictEqual(texts.size, 3, 'viewpoints must be distinct');
  });

  it('all viewpoints have non-empty text and id', () => {
    const vps = buildStructuredViewpoints('test', []);
    vps.forEach((vp) => {
      assert.ok(vp.id.length > 0);
      assert.ok(vp.text.length > 0);
    });
  });
});

// ---- Ticket #9: Strategy engine ----
// Ticket #18 dead-code cleanup: `planNextRound` was removed from the import —
// it was superseded by the orchestration API's own planner in #15 and has no
// production callers. Its two tests were removed with it.
import { pickNextStrategy, isCheckpointRound, STRATEGIES } from '../../src/lib/strategy-engine';

const makeSession = (userCount: number, _strategyHistory: string[] = []): Session => {
  const messages: Message[] = [];
  for (let i = 0; i < userCount; i++) {
    messages.push({ id: `u${i}`, role: 'user', text: `ans ${i}`, timestamp: i });
    messages.push({ id: `a${i}`, role: 'assistant', text: `q ${i}`, timestamp: i });
  }
  return {
    id: 's', question: 'test', initialOpinion: null, report: null,
    selectedViewpoint: null, messages, resultCard: null,
    completed: false, createdAt: 0, updatedAt: 0,
  } as Session;
};

describe('pickNextStrategy', () => {
  it('round 1: M1 evidence', () => {
    assert.strictEqual(pickNextStrategy(makeSession(0)), 'M1_evidence');
  });
  it('round 2: M2 premise', () => {
    assert.strictEqual(pickNextStrategy(makeSession(1)), 'M2_premise');
  });
  it('round 3: M4 steelman', () => {
    assert.strictEqual(pickNextStrategy(makeSession(2)), 'M4_steelman');
  });
  it('round 4: M6 reversal', () => {
    assert.strictEqual(pickNextStrategy(makeSession(3)), 'M6_reversal');
  });
  it('round 5: M5 restate', () => {
    assert.strictEqual(pickNextStrategy(makeSession(4)), 'M5_restate');
  });
  it('round 6+: rotates without immediate repeat', () => {
    const s = makeSession(5, ['M1', 'M2', 'M4', 'M6', 'M5']);
    const next = pickNextStrategy(s);
    assert.ok(['M1_evidence', 'M2_premise', 'M4_steelman', 'M6_reversal'].includes(next));
  });
});

describe('isCheckpointRound', () => {
  it('returns true for round 5', () => assert.strictEqual(isCheckpointRound(5), true));
  it('returns true for round 8', () => assert.strictEqual(isCheckpointRound(8), true));
  it('returns true for round 11', () => assert.strictEqual(isCheckpointRound(11), true));
  it('returns false for round 6', () => assert.strictEqual(isCheckpointRound(6), false));
  it('returns false for round 7', () => assert.strictEqual(isCheckpointRound(7), false));
});

describe('strategy fallback templates', () => {
  it('each strategy has a non-empty fallback template', () => {
    const session = makeSession(0);
    for (const id of Object.keys(STRATEGIES) as Array<keyof typeof STRATEGIES>) {
      const tmpl = STRATEGIES[id].fallbackTemplate(session);
      assert.ok(tmpl.length > 0, `${id} has empty fallback`);
    }
  });
});

// ---- Ticket #10: LLM fallback and uncertain answer handling ----
import {
  withFallback,
  isUncertainAnswer,
  uncertainResponse,
} from '../../src/lib/llm-fallback';

const makeFallbackSession = (): Session => ({
  id: 's', question: 'test question', initialOpinion: null, report: null,
  selectedViewpoint: null, messages: [], resultCard: null,
  completed: false, createdAt: 0, updatedAt: 0,
});

describe('isUncertainAnswer', () => {
  it('detects 不知道', () => assert.strictEqual(isUncertainAnswer('不知道'), true));
  it('detects 不清楚', () => assert.strictEqual(isUncertainAnswer('我不清楚'), true));
  it('detects very short answers', () => assert.strictEqual(isUncertainAnswer('嗯'), true));
  it('accepts substantive answer', () => assert.strictEqual(isUncertainAnswer('我认为 AI 会增强而非取代创造力'), false));
});

describe('uncertainResponse', () => {
  it('streak 0 returns empty', () => {
    const r = uncertainResponse(0, makeFallbackSession());
    assert.strictEqual(r.level, 0);
    assert.strictEqual(r.message, '');
  });
  it('streak 1 returns narrowing prompt', () => {
    const r = uncertainResponse(1, makeFallbackSession());
    assert.strictEqual(r.level, 1);
    assert.ok(r.message.includes('缩小'));
  });
  it('streak 2 returns two directions', () => {
    const r = uncertainResponse(2, makeFallbackSession());
    assert.strictEqual(r.level, 2);
    assert.ok(r.hint && r.hint.length === 2);
  });
  it('streak 3+ suggests ending', () => {
    const r = uncertainResponse(3, makeFallbackSession());
    assert.strictEqual(r.level, 3);
    assert.ok(r.message.includes('结束'));
  });
});

describe('withFallback', () => {
  it('returns first success without fallback', async () => {
    const r = await withFallback('M1_evidence', makeFallbackSession(), async () => 'good question');
    assert.strictEqual(r.usedFallback, false);
    assert.strictEqual(r.question, 'good question');
    assert.strictEqual(r.events[0]?.type, 'success');
  });
  it('retries once then uses template on failure', async () => {
    let calls = 0;
    const r = await withFallback('M1_evidence', makeFallbackSession(), async () => {
      calls++;
      throw new Error('boom');
    });
    assert.strictEqual(calls, 2, 'should attempt twice');
    assert.strictEqual(r.usedFallback, true);
    assert.ok(r.question.length > 0);
    assert.ok(r.events.some((e) => e.type === 'retry'));
    assert.ok(r.events.some((e) => e.type === 'template'));
  });
  it('falls back on empty string', async () => {
    const r = await withFallback('M2_premise', makeFallbackSession(), async () => '');
    assert.strictEqual(r.usedFallback, true);
    assert.ok(r.question.length > 0);
  });
  it('success on second attempt does not use fallback', async () => {
    let calls = 0;
    const r = await withFallback('M1_evidence', makeFallbackSession(), async () => {
      calls++;
      if (calls === 1) throw new Error('first fails');
      return 'retry success';
    });
    assert.strictEqual(r.usedFallback, false);
    assert.strictEqual(r.question, 'retry success');
  });
  it('never throws even when generator always throws', async () => {
    const r = await withFallback('M1_evidence', makeFallbackSession(), async () => {
      throw new Error('persistent');
    });
    assert.ok(r.question.length > 0);
    assert.strictEqual(r.usedFallback, true);
  });
});

// ---- Ticket #11: Detailed result card builder ----
import { buildDetailedResultCard } from '../../src/lib/result-card-builder';

const makeCardSession = (): Session => ({
  id: 's1',
  question: 'test',
  initialOpinion: '我最初认为 X',
  report: null,
  selectedViewpoint: { id: 'v1', text: 'AI 建议的立场', source: 'ai_suggested_and_selected', selectedAt: 1000 },
  messages: [
    { id: 'm0', role: 'assistant', text: '第一个追问', timestamp: 0 },
    { id: 'm1', role: 'user', text: '我的回答包含具体数据', timestamp: 1 },
    { id: 'm2', role: 'assistant', text: '追问二', timestamp: 2 },
    { id: 'm3', role: 'user', text: '我修正了观点', timestamp: 3 },
  ],
  resultCard: null,
  completed: false,
  createdAt: 0,
  updatedAt: 0,
});

describe('buildDetailedResultCard', () => {
  it('separates initial expression, stance, evidence, revisions, final position', () => {
    const card = buildDetailedResultCard(makeCardSession());
    assert.ok(card.initialExpression);
    assert.strictEqual(card.initialExpression!.text, '我最初认为 X');
    assert.ok(card.startingStance);
    assert.strictEqual(card.startingStance!.source, 'ai_suggested_and_selected');
    assert.ok(card.newEvidence.length >= 1, 'should have at least one evidence item');
    assert.ok(card.stanceRevisions.length >= 1, 'should have at least one revision');
    assert.ok(card.finalPosition);
    assert.strictEqual(card.finalPosition!.text, '我修正了观点');
  });

  it('does not include assistant messages in user fields', () => {
    const card = buildDetailedResultCard(makeCardSession());
    const allText = [
      card.initialExpression?.text ?? '',
      card.startingStance?.text ?? '',
      ...card.newEvidence.map((e) => e.text),
      ...card.stanceRevisions.flatMap((r) => [r.from.text, r.to.text]),
      card.finalPosition?.text ?? '',
    ].join(' ');
    assert.ok(!allText.includes('追问'), 'assistant text leaked into user fields');
  });

  it('each item has a traceable messageId', () => {
    const card = buildDetailedResultCard(makeCardSession());
    assert.ok(card.initialExpression!.messageId);
    assert.ok(card.startingStance!.messageId);
    card.newEvidence.forEach((e) => assert.ok(e.messageId));
    card.stanceRevisions.forEach((r) => {
      assert.ok(r.from.messageId);
      assert.ok(r.to.messageId);
    });
    assert.ok(card.finalPosition!.messageId);
  });

  it('empty session returns empty card', () => {
    const empty: Session = {
      id: 's2', question: 'q', initialOpinion: null, report: null,
      selectedViewpoint: null, messages: [], resultCard: null,
      completed: false, createdAt: 0, updatedAt: 0,
    };
    const card = buildDetailedResultCard(empty);
    assert.strictEqual(card.initialExpression, null);
    assert.strictEqual(card.startingStance, null);
    assert.strictEqual(card.newEvidence.length, 0);
    assert.strictEqual(card.finalPosition, null);
  });
});

// ---- Ticket #12: Session lifecycle and profile ----
import {
  isReadOnly,
  continueFromCompleted,
  buildProfileFromSession,
  updateProfile,
  loadProfile,
  saveProfile,
  deleteProfile,
  type UserProfile,
} from '../../src/lib/lifecycle';

const makeCompleted = (): Session => ({
  id: 's1', question: 'q', initialOpinion: 'op',
  report: null, knowledgeGraph: null,
  selectedViewpoint: { id: 'v1', text: '立场', source: 'user_authored' },
  messages: [
    { id: 'm0', role: 'assistant', text: 'q?', timestamp: 0 },
    { id: 'm1', role: 'user', text: '一个详细回答', timestamp: 1 },
  ],
  resultCard: null, completed: true, createdAt: 0, updatedAt: 0,
});

describe('isReadOnly', () => {
  it('completed session is read-only', () => assert.strictEqual(isReadOnly(makeCompleted()), true));
  it('in-progress session is not read-only', () => {
    const s = makeCompleted();
    assert.strictEqual(isReadOnly({ ...s, completed: false }), false);
  });
});

describe('continueFromCompleted', () => {
  it('creates a new independent session', () => {
    const result = continueFromCompleted(makeCompleted(), '新问题');
    assert.notStrictEqual(result.newSession.id, 's1');
    assert.strictEqual(result.newSession.question, '新问题');
    assert.strictEqual(result.newSession.completed, false);
    assert.strictEqual(result.newSession.messages.length, 0);
  });
  it('does not modify the original completed session', () => {
    const original = makeCompleted();
    continueFromCompleted(original, 'next');
    assert.strictEqual(original.completed, true);
    assert.strictEqual(original.messages.length, 2);
  });
});

describe('buildProfileFromSession', () => {
  it('returns empty for incomplete session', () => {
    const s = makeCompleted();
    assert.deepStrictEqual(buildProfileFromSession({ ...s, completed: false }), []);
  });
  it('produces interest and thinking_style conclusions', () => {
    const conclusions = buildProfileFromSession(makeCompleted());
    const fields = conclusions.map((c) => c.field);
    assert.ok(fields.includes('interest'));
    assert.ok(fields.includes('thinking_style'));
  });
  it('each conclusion has sourceSessionId and confidence', () => {
    const conclusions = buildProfileFromSession(makeCompleted());
    conclusions.forEach((c) => {
      assert.ok(c.sourceSessionId);
      assert.ok(c.confidence > 0 && c.confidence <= 1);
    });
  });
  it('does not attribute thinking_style to an uncertain input (#17)', () => {
    const s = makeCompleted();
    s.messages.push({ id: 'm2', role: 'user', text: '不太确定', timestamp: 2, uncertain: true });
    const conclusions = buildProfileFromSession(s);
    const ts = conclusions.find((c) => c.field === 'thinking_style');
    assert.ok(ts, 'real answer m1 still yields a thinking_style conclusion');
    assert.notStrictEqual(ts.sourceMessageId, 'm2', 'must not cite the uncertain message');
  });
});

describe('updateProfile', () => {
  it('merges new conclusions into existing', () => {
    const initial: UserProfile = { conclusions: [], updatedAt: 0, deletedAt: null };
    const next = updateProfile(initial, [
      { field: 'interest', value: 'AI', confidence: 0.5, sourceSessionId: 's1', sourceMessageId: null, updatedAt: 1 },
    ]);
    assert.strictEqual(next.conclusions.length, 1);
  });
  it('does not rebuild if profile is deleted', () => {
    const initial: UserProfile = { conclusions: [], updatedAt: 0, deletedAt: Date.now() };
    const next = updateProfile(initial, [
      { field: 'interest', value: 'AI', confidence: 0.5, sourceSessionId: 's1', sourceMessageId: null, updatedAt: 1 },
    ]);
    assert.strictEqual(next.conclusions.length, 0, 'must not auto-rebuild after delete');
  });
  it('replaces lower confidence conclusion for same field+value', () => {
    const initial: UserProfile = {
      conclusions: [
        { field: 'interest', value: 'AI', confidence: 0.3, sourceSessionId: 's1', sourceMessageId: null, updatedAt: 0 },
      ],
      updatedAt: 0,
      deletedAt: null,
    };
    const next = updateProfile(initial, [
      { field: 'interest', value: 'AI', confidence: 0.7, sourceSessionId: 's1', sourceMessageId: null, updatedAt: 1 },
    ]);
    assert.strictEqual(next.conclusions[0]!.confidence, 0.7);
  });
});

describe('profile localStorage', () => {
  it('saves and loads profile; delete keeps a tombstone so old evidence cannot rebuild it (#21)', () => {
    const store: Record<string, string> = {};
    Object.defineProperty(globalThis, 'localStorage', { value: {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
      clear: () => {},
      get length() { return Object.keys(store).length; },
      key: (i: number) => Object.keys(store)[i] ?? null,
    }, configurable: true });
    const p: UserProfile = { conclusions: [], updatedAt: 0, deletedAt: null };
    saveProfile(p);
    const loaded = loadProfile();
    assert.ok(loaded);
    assert.strictEqual(loaded!.deletedAt, null);

    // #21: deletion is a tombstone, NOT a removal — the conclusions are
    // emptied and deletedAt is set, so updateProfile must refuse to
    // auto-rebuild the profile from old evidence.
    deleteProfile();
    const afterDelete = loadProfile();
    assert.ok(afterDelete, 'the tombstone record must survive deletion');
    assert.strictEqual(afterDelete!.conclusions.length, 0, 'conclusions are deleted');
    assert.strictEqual(typeof afterDelete!.deletedAt, 'number');
    const rebuildAttempt = updateProfile(afterDelete, [
      { field: 'interest', value: 'AI', confidence: 0.9, sourceSessionId: 's1', sourceMessageId: null, updatedAt: 2 },
    ]);
    assert.strictEqual(rebuildAttempt.conclusions.length, 0, 'must not auto-rebuild after delete');
  });
});

// ---- Ticket #13: Demo fixtures ----
import { DEMO_FIXTURES, getFixtureByTopic } from '../../src/lib/demo-fixtures';

describe('DEMO_FIXTURES', () => {
  it('has exactly three fixtures', () => {
    assert.strictEqual(DEMO_FIXTURES.length, 3);
  });
  it('covers three required categories', () => {
    const categories = new Set(DEMO_FIXTURES.map((f) => f.category));
    assert.ok(categories.has('AI/技术'));
    assert.ok(categories.has('社会/生活'));
    assert.ok(categories.has('职场/教育/个人选择'));
  });
  it('each fixture has captureTime and normalized sources', () => {
    DEMO_FIXTURES.forEach((f) => {
      assert.ok(f.captureTime.length > 0);
      assert.ok(f.normalized.sources.length >= 2);
    });
  });
  it('getFixtureByTopic returns matching fixture', () => {
    const f = getFixtureByTopic(DEMO_FIXTURES[0]!.topic);
    assert.ok(f);
    assert.strictEqual(f!.category, DEMO_FIXTURES[0]!.category);
  });
  it('getFixtureByTopic returns undefined for unknown topic', () => {
    assert.strictEqual(getFixtureByTopic('不存在的议题'), undefined);
  });
  it('graph specs are within 6-10 nodes', () => {
    DEMO_FIXTURES.forEach((f) => {
      assert.ok(f.expectedGraph.nodeCount >= 6 && f.expectedGraph.nodeCount <= 10);
    });
  });
});

// ---- Ticket #14: five-round interrogation state machine ----
// Namespace import so the red-state failure is isolated to the new cases.
// (FixtureLLMProvider is already imported at the top of this file.)
import * as strategyEngine14 from '../../src/lib/strategy-engine';

describe('actionAfterAnswer (#14 checkpoint state machine)', () => {
  it('rounds 1-4 continue to the next round', () => {
    for (const r of [1, 2, 3, 4]) {
      assert.strictEqual(strategyEngine14.actionAfterAnswer(r), 'next_round', `round ${r}`);
    }
  });
  it('round 5 triggers the checkpoint decision', () => {
    assert.strictEqual(strategyEngine14.actionAfterAnswer(5), 'checkpoint');
  });
  it('rounds 6-7 continue; 8/11/14 trigger checkpoint decisions', () => {
    assert.strictEqual(strategyEngine14.actionAfterAnswer(6), 'next_round');
    assert.strictEqual(strategyEngine14.actionAfterAnswer(7), 'next_round');
    assert.strictEqual(strategyEngine14.actionAfterAnswer(8), 'checkpoint');
    assert.strictEqual(strategyEngine14.actionAfterAnswer(11), 'checkpoint');
    assert.strictEqual(strategyEngine14.actionAfterAnswer(14), 'checkpoint');
  });
});

describe('resumePlan (#14 refresh restore)', () => {
  it('a restored session with 0 answers resumes the interrogation', () => {
    assert.deepStrictEqual(strategyEngine14.resumePlan(makeSession(0)), {
      action: 'next_round',
      answeredRounds: 0,
    });
  });
  it('a restored session with 4 answers continues the interrogation', () => {
    assert.deepStrictEqual(strategyEngine14.resumePlan(makeSession(4)), {
      action: 'next_round',
      answeredRounds: 4,
    });
  });
  it('a restored session with 5 answers resumes at the checkpoint decision', () => {
    assert.strictEqual(strategyEngine14.resumePlan(makeSession(5)).action, 'checkpoint');
    assert.strictEqual(strategyEngine14.resumePlan(makeSession(5)).answeredRounds, 5);
  });
  it('a restored session with 8 answers resumes at the checkpoint decision', () => {
    assert.strictEqual(strategyEngine14.resumePlan(makeSession(8)).action, 'checkpoint');
  });
  it('a restored session ignores assistant messages when counting rounds', () => {
    // messages already alternate user/assistant in makeSession; add extra assistant-only noise
    const s = makeSession(2);
    s.messages.push({ id: 'x1', role: 'assistant', text: 'noise', timestamp: 99 });
    assert.deepStrictEqual(strategyEngine14.resumePlan(s), {
      action: 'next_round',
      answeredRounds: 2,
    });
  });
});

describe('five-round contract (#14)', () => {
  // Ticket #18 dead-code cleanup: the former first test here asserted round-6
  // rotation through `strategy-engine.planNextRound`, which was removed with
  // that dead function. Rotation after round 5 is covered by the
  // pickNextStrategy 'round 6+' test above and by the E2E round-6 flow.
  it('fixture LLM produces the five standard questions in order', async () => {
    const provider = new FixtureLLMProvider();
    // Ticket #16: the fixture question is keyed by the strategy being asked
    // (the orchestrator's pick), not by the round number alone.
    const planned: Array<{ strategy: import('../../src/lib/strategy-engine').StrategyId; phrase: string }> = [
      { strategy: 'M1_evidence', phrase: '具体的数据或例子' },
      { strategy: 'M2_premise', phrase: '隐含的前提' },
      { strategy: 'M4_steelman', phrase: '对立观点重新论证' },
      { strategy: 'M6_reversal', phrase: '相反的立场辩护' },
      { strategy: 'M5_restate', phrase: '重新表述你当前的观点' },
    ];
    for (let i = 0; i < planned.length; i++) {
      const { strategy, phrase } = planned[i]!;
      const q = await provider.generateStrategyQuestion(strategy, makeSession(i));
      assert.ok(
        q.includes(phrase),
        `round ${i + 1} (${strategy}) question should contain "${phrase}" but was "${q}"`
      );
    }
  });
});
