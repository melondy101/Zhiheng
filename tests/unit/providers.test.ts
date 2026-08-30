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
import { HistorySearchProvider } from '../../src/lib/history-search';
import { getDemoSources } from '../../src/lib/demo-sources';
import { buildReport } from '../../src/lib/report-builder';
import { buildGraph } from '../../src/lib/knowledge-graph';
import { FIXTURE_QUESTION, type Session, type Source } from '../../src/lib/providers';

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).localStorage = isolatedLS;
  return { provider: new BrowserStorageProvider(), store };
}

function clearCache(): void {
  storage.clear();
}

// For search provider tests: set up localStorage mock pointing to shared storage
function setupSearchProviderStorage(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

  it('returns source=live on first call (live fetch)', async () => {
    setupSearchProviderStorage();
    const provider = new ZhihuSearchProvider();
    const result = await provider.search('live test');
    assert.strictEqual(result.source, 'live');
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

  it('fallback chain order: live → fresh cache → stale cache → demo', async () => {
    setupSearchProviderStorage();

    // Step 1: First call — live
    const p1 = new ZhihuSearchProvider();
    const r1 = await p1.search('chain question');
    assert.strictEqual(r1.source, 'live');

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

  it('returns source=live on first call', async () => {
    setupSearchProviderStorage();
    const provider = new WebSearchProvider();
    const result = await provider.search('web live test');
    assert.strictEqual(result.source, 'live');
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

    // live
    const live = new ZhihuSearchProvider();
    const liveResult = await live.search('source state test');
    assert.strictEqual(liveResult.source, 'live');

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

    const live = new WebSearchProvider();
    const liveResult = await live.search('web source state test');
    assert.strictEqual(liveResult.source, 'live');

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

describe('FixtureLLMProvider', () => {
  it('returns the first template for an empty session', async () => {
    const provider = new FixtureLLMProvider();
    const session: Parameters<typeof provider.generateQuestion>[0] = {
      id: 's', question: 'q', initialOpinion: null, report: null,
      selectedViewpoint: null, messages: [], resultCard: null,
      completed: false, createdAt: 0, updatedAt: 0,
    };
    assert.strictEqual(await provider.generateQuestion(session), FIXTURE_QUESTION);
  });

  it('returns the same deterministic question after one user message', async () => {
    const provider = new FixtureLLMProvider();
    const session: Parameters<typeof provider.generateQuestion>[0] = {
      id: 's', question: 'q', initialOpinion: null, report: null,
      selectedViewpoint: null, messages: [{ id: 'u1', role: 'user', text: 'a', timestamp: 0 }],
      resultCard: null, completed: false, createdAt: 0, updatedAt: 0,
    };
    assert.strictEqual(await provider.generateQuestion(session), FIXTURE_QUESTION);
  });
});

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
      selectedViewpoint: { id: 'v1', text: 'selected', source: 'ai_authored' },
      messages: [{ id: 'u1', role: 'user', text: 'reply', timestamp: 0 }],
      report: null, resultCard: null, completed: false, createdAt: 0, updatedAt: 0,
    });
    assert.ok(card.selectedStartingStance);
    assert.strictEqual(card.selectedStartingStance!.source, 'ai_authored');
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
});

// ---------------------------------------------------------------------------
// HistorySearchProvider contract (#6)
// ---------------------------------------------------------------------------

describe('HistorySearchProvider', () => {
  // Set up isolated localStorage for each test
  function makeHistoryProvider(): { provider: HistorySearchProvider; store: Store } {
    const store: Store = {};
    const isolatedLS = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
      clear: () => { Object.keys(store).forEach(k => delete store[k]); },
      get length() { return Object.keys(store).length; },
      key: (i: number) => Object.keys(store)[i] ?? null,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).localStorage = isolatedLS;
    return { provider: new HistorySearchProvider(), store };
  }

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

  it('returns matching completed sessions', async () => {
    const { provider, store } = makeHistoryProvider();
    const session = makeSession({ id: 'match_1', question: 'AI 程序员 未来', completed: true });
    store['zhiyan_sessions:match_1'] = JSON.stringify(session);

    const result = await provider.search('AI 程序员');
    assert.strictEqual(result.sources.length, 1);
    assert.strictEqual(result.sources[0]!.type, 'personal_history');
    assert.strictEqual(result.sources[0]!.sourceSessionId, 'match_1');
  });

  it('returns no more than 3 results', async () => {
    const { provider, store } = makeHistoryProvider();
    for (let i = 0; i < 5; i++) {
      const session = makeSession({
        id: `many_${i}`,
        question: 'AI 程序员 测试',
        completed: true,
        updatedAt: i,
      });
      store[`zhiyan_sessions:many_${i}`] = JSON.stringify(session);
    }

    const result = await provider.search('AI 程序员');
    assert.ok(result.sources.length <= 3, `expected <= 3, got ${result.sources.length}`);
  });

  it('excludes sessions by ID', async () => {
    const { provider, store } = makeHistoryProvider();
    const session = makeSession({ id: 'exclude_me', question: 'AI 程序员 未来', completed: true });
    store['zhiyan_sessions:exclude_me'] = JSON.stringify(session);

    const result = await provider.search('AI 程序员', ['exclude_me']);
    assert.strictEqual(result.sources.length, 0);
  });

  it('sources have type=personal_history and sourceSessionId', async () => {
    const { provider, store } = makeHistoryProvider();
    const session = makeSession({ id: 'src_check', question: '测试 问题', completed: true });
    store['zhiyan_sessions:src_check'] = JSON.stringify(session);

    const result = await provider.search('测试');
    assert.strictEqual(result.sources.length, 1);
    const src = result.sources[0]!;
    assert.strictEqual(src.type, 'personal_history');
    assert.strictEqual(src.sourceSessionId, 'src_check');
    assert.ok(src.provenance);
  });

  it('returns empty when no sessions match', async () => {
    const { provider, store } = makeHistoryProvider();
    const session = makeSession({ id: 'nomatch', question: '完全不相关的问题', completed: true });
    store['zhiyan_sessions:nomatch'] = JSON.stringify(session);

    const result = await provider.search('AI 程序员');
    assert.strictEqual(result.sources.length, 0);
  });

  it('skips incomplete sessions', async () => {
    const { provider, store } = makeHistoryProvider();
    const session = makeSession({ id: 'incomplete', question: 'AI 程序员', completed: false });
    store['zhiyan_sessions:incomplete'] = JSON.stringify(session);

    const result = await provider.search('AI 程序员');
    assert.strictEqual(result.sources.length, 0);
  });

  it('uses initialOpinion as excerpt when present', async () => {
    const { provider, store } = makeHistoryProvider();
    const session = makeSession({
      id: 'with_opinion',
      question: 'AI 程序员',
      initialOpinion: '这是我的个人观点',
      completed: true,
    });
    store['zhiyan_sessions:with_opinion'] = JSON.stringify(session);

    const result = await provider.search('AI 程序员');
    assert.strictEqual(result.sources.length, 1);
    assert.strictEqual(result.sources[0]!.excerpt, '这是我的个人观点');
  });

  it('uses first user message as excerpt when no initialOpinion', async () => {
    const { provider, store } = makeHistoryProvider();
    const session = makeSession({
      id: 'with_message',
      question: 'AI 程序员',
      initialOpinion: null,
      messages: [{ id: 'm1', role: 'user', text: '用户的第一条消息', timestamp: 0 }],
      completed: true,
    });
    store['zhiyan_sessions:with_message'] = JSON.stringify(session);

    const result = await provider.search('AI 程序员');
    assert.strictEqual(result.sources.length, 1);
    assert.strictEqual(result.sources[0]!.excerpt, '用户的第一条消息');
  });

  it('returns sources sorted by updatedAt desc', async () => {
    const { provider, store } = makeHistoryProvider();
    const oldSession = makeSession({ id: 'old_s', question: 'AI 程序员', completed: true, updatedAt: 100 });
    const newSession = makeSession({ id: 'new_s', question: 'AI 程序员', completed: true, updatedAt: 200 });
    store['zhiyan_sessions:old_s'] = JSON.stringify(oldSession);
    store['zhiyan_sessions:new_s'] = JSON.stringify(newSession);

    const result = await provider.search('AI 程序员');
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
