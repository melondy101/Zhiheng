// Ticket #19 contract tests for the server-side real retrieval module
// (src/lib/zhihu-retrieval.ts). Every external HTTP interaction is driven
// through an injectable fake transport — no real API call is ever made and no
// API key is required. The contract under test:
//
//   live (secret configured + transport success) → fresh cache → stale cache
//   → demo (deterministic fixture), per source kind and per query.
//
// Honesty red lines asserted here:
//   - fixture/demo data is NEVER labeled 'live'
//   - 'live' only comes from a successful real-provider call
//   - cache hits carry the original updatedAt
//   - missing metadata from the provider stays null (never fabricated)
//   - external response text is untrusted data: mapped field-by-field, never
//     coerced, never executed
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  DEFAULT_ZHIHU_API_BASE_URL,
  LiveHotlistProvider,
  LiveSearchProvider,
  TtlCache,
  extractItems,
  mapHotlistItem,
  mapSearchSource,
  normalizeUrl,
  readZhihuApiConfig,
  type ZhihuApiConfig,
  type ZhihuCallOptions,
  type ZhihuHttpTransport,
} from '../../src/lib/zhihu-retrieval';
import { getDemoSources } from '../../src/lib/demo-sources';
import { buildReport } from '../../src/lib/report-builder';
import { buildGraph } from '../../src/lib/knowledge-graph';
import type { Source } from '../../src/lib/providers';

// ---------------------------------------------------------------------------
// Fake transport helpers
// ---------------------------------------------------------------------------

const CONFIG: ZhihuApiConfig = { baseUrl: 'https://fake.example', accessSecret: 'test-secret' };
const BASE_NOW = 1_770_000_000_000;

/** Deterministic injectable clock. */
function makeClock() {
  const state = { now: BASE_NOW };
  return { nowFn: () => state.now, advance: (ms: number) => { state.now += ms; } };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** A fake search item with every documented field present. */
function fullItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: '真实知乎标题',
    content: '真实摘要内容',
    author: '真实作者',
    url: 'https://www.zhihu.com/question/9527',
    ...overrides,
  };
}

interface CapturedCall {
  url: string;
  options: ZhihuCallOptions;
}

/** A fake handler may return the Response directly or as a promise. */
type FakeHandler = (url: string, options: ZhihuCallOptions) => Response | Promise<Response>;

/** Wrap a handler so every call is recorded for assertions. */
function recordingTransport(
  handler: FakeHandler
): { transport: ZhihuHttpTransport; calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  return {
    calls,
    transport: async (url, options) => {
      calls.push({ url, options });
      return handler(url, options);
    },
  };
}

/** New search provider wired to a fake transport with a fresh cache. */
function makeSearchProvider(
  handler: FakeHandler,
  overrides: {
    config?: ZhihuApiConfig | null;
    kind?: 'zhihu_search' | 'global_search';
    timeoutMs?: number;
    ttlMs?: number;
    now?: () => number;
  } = {}
): { provider: LiveSearchProvider; calls: CapturedCall[] } {
  const clock = makeClock();
  const { transport, calls } = recordingTransport(handler);
  const provider = new LiveSearchProvider({
    kind: overrides.kind ?? 'zhihu_search',
    config: overrides.config !== undefined ? overrides.config : CONFIG,
    transport,
    cache: new TtlCache<Source[]>({ ttlMs: overrides.ttlMs ?? 86_400_000, now: clock.nowFn }),
    timeoutMs: overrides.timeoutMs ?? 5_000,
    ttlMs: overrides.ttlMs ?? 86_400_000,
    now: overrides.now ?? clock.nowFn,
  });
  return { provider, calls };
}

// ---------------------------------------------------------------------------
// readZhihuApiConfig — server-side, secret-gated
// ---------------------------------------------------------------------------
describe('readZhihuApiConfig', () => {
  it('returns null when the access secret is missing or whitespace-only', () => {
    assert.strictEqual(readZhihuApiConfig({}), null);
    assert.strictEqual(readZhihuApiConfig({ ZHIHU_ACCESS_SECRET: '' }), null);
    assert.strictEqual(readZhihuApiConfig({ ZHIHU_ACCESS_SECRET: '   ' }), null);
    assert.strictEqual(readZhihuApiConfig({ ZHIHU_ACCESS_SECRET: undefined }), null);
  });

  it('uses the default base URL when only the secret is set', () => {
    const config = readZhihuApiConfig({ ZHIHU_ACCESS_SECRET: 's' });
    assert.ok(config);
    assert.strictEqual(config.baseUrl, DEFAULT_ZHIHU_API_BASE_URL);
    assert.strictEqual(config.accessSecret, 's');
  });

  it('honors ZHIHU_API_BASE_URL and strips trailing slashes', () => {
    const config = readZhihuApiConfig({
      ZHIHU_ACCESS_SECRET: 's',
      ZHIHU_API_BASE_URL: 'https://mirror.example.com///',
    });
    assert.ok(config);
    assert.strictEqual(config.baseUrl, 'https://mirror.example.com');
  });
});

// ---------------------------------------------------------------------------
// Untrusted response mapping — field-by-field, never coerced or executed
// ---------------------------------------------------------------------------
describe('untrusted response mapping', () => {
  it('extractItems accepts a bare array or a data/Data/items/results/list envelope', () => {
    assert.deepStrictEqual(extractItems([{ a: 1 }]), [{ a: 1 }]);
    assert.deepStrictEqual(extractItems({ data: [{ a: 1 }] }), [{ a: 1 }]);
    assert.deepStrictEqual(extractItems({ Data: [{ a: 1 }] }), [{ a: 1 }]);
    assert.deepStrictEqual(extractItems({ items: [{ a: 1 }] }), [{ a: 1 }]);
    assert.deepStrictEqual(extractItems({ results: [{ a: 1 }] }), [{ a: 1 }]);
    assert.deepStrictEqual(extractItems({ list: [{ a: 1 }] }), [{ a: 1 }]);
    assert.strictEqual(extractItems({ unexpected: 'shape' }), null);
    assert.strictEqual(extractItems('not an object'), null);
    assert.strictEqual(extractItems(null), null);
    assert.strictEqual(extractItems({ data: 'not an array' }), null);
  });

  it('mapSearchSource keeps provider fields verbatim and fills missing ones with null', () => {
    const s = mapSearchSource(fullItem(), 'zhihu_search', 'h', 0);
    assert.ok(s);
    assert.strictEqual(s.type, 'zhihu');
    assert.strictEqual(s.author, '真实作者');
    assert.strictEqual(s.title, '真实知乎标题');
    assert.strictEqual(s.url, 'https://www.zhihu.com/question/9527');
    assert.strictEqual(s.excerpt, '真实摘要内容');
    assert.strictEqual(s.id, 'zsearch_h_0');

    const partial = mapSearchSource({ title: '只有标题' }, 'zhihu_search', 'h', 1);
    assert.ok(partial);
    assert.strictEqual(partial.author, null);
    assert.strictEqual(partial.url, null);
    assert.strictEqual(partial.excerpt, null);
  });

  it('mapSearchSource maps global_search items to type web', () => {
    const s = mapSearchSource(fullItem(), 'global_search', 'h', 2);
    assert.ok(s);
    assert.strictEqual(s.type, 'web');
    assert.strictEqual(s.id, 'gsearch_h_2');
  });

  it('never coerces non-string values and never executes text content', () => {
    const numeric = mapSearchSource({ title: 't', author: 12345, url: 42 }, 'zhihu_search', 'h', 0);
    assert.ok(numeric);
    assert.strictEqual(numeric.author, null, 'numeric author must not be coerced into a string');
    assert.strictEqual(numeric.url, null);

    const script = '<script>window.__pwned = true;</script>';
    const evil = mapSearchSource({ title: script, content: script, author: script }, 'zhihu_search', 'h', 0);
    assert.ok(evil);
    assert.strictEqual(evil.title, script, 'external text passes through as inert data');
    assert.strictEqual(evil.excerpt, script);
    assert.strictEqual(evil.author, script);
  });

  it('rejects non-http(s) URLs instead of fabricating a link', () => {
    assert.strictEqual(normalizeUrl('javascript:alert(1)'), null);
    assert.strictEqual(normalizeUrl('ftp://example.com/a'), null);
    assert.strictEqual(normalizeUrl('not a url'), null);
    assert.strictEqual(normalizeUrl('  https://ok.example.com/a  '), 'https://ok.example.com/a');
  });

  it('drops records with neither title nor excerpt, and drops hotlist items without a title', () => {
    assert.strictEqual(mapSearchSource({ author: '只有作者' }, 'zhihu_search', 'h', 0), null);
    assert.strictEqual(mapSearchSource('not an object', 'zhihu_search', 'h', 0), null);
    assert.strictEqual(mapSearchSource(null, 'zhihu_search', 'h', 0), null);
    assert.strictEqual(mapHotlistItem({ author: '没有标题' }, 0), null);
    const item = mapHotlistItem({ question_title: '热榜问题A', link: 'https://www.zhihu.com/question/a' }, 3);
    assert.ok(item);
    assert.strictEqual(item.title, '热榜问题A');
    assert.strictEqual(item.url, 'https://www.zhihu.com/question/a');
    assert.strictEqual(mapHotlistItem({ title: 'B' }, 4)!.url, null);
  });
});

// ---------------------------------------------------------------------------
// TtlCache — isolation per (kind, normalized query), injectable clock
// ---------------------------------------------------------------------------
describe('TtlCache', () => {
  it('isolates entries by kind and by normalized query', () => {
    const clock = makeClock();
    const cache = new TtlCache<string[]>({ ttlMs: 1_000, now: clock.nowFn });
    cache.set('zhihu_search', 'AI  问题', ['a']);
    cache.set('global_search', 'AI  问题', ['b']);
    cache.set('zhihu_search', '另一个问题', ['c']);

    assert.strictEqual(cache.get('zhihu_search', 'ai 问题')!.value[0], 'a');
    assert.strictEqual(cache.get('global_search', 'ai 问题')!.value[0], 'b');
    assert.strictEqual(cache.get('zhihu_search', '另一个问题')!.value[0], 'c');
    assert.strictEqual(cache.get('hot_list', 'ai 问题'), null);
    assert.strictEqual(cache.get('zhihu_search', '从未缓存'), null);
  });

  it('distinguishes fresh from stale with the injected clock and keeps updatedAt', () => {
    const clock = makeClock();
    const cache = new TtlCache<string[]>({ ttlMs: 1_000, now: clock.nowFn });
    cache.set('zhihu_search', 'q', ['v']);
    assert.strictEqual(cache.get('zhihu_search', 'q')!.stale, false);
    assert.strictEqual(cache.get('zhihu_search', 'q')!.updatedAt, BASE_NOW);

    clock.advance(999);
    assert.strictEqual(cache.get('zhihu_search', 'q')!.stale, false);
    clock.advance(1); // age exactly equals the TTL — still fresh
    assert.strictEqual(cache.get('zhihu_search', 'q')!.stale, false);
    clock.advance(1); // age now exceeds the TTL
    const hit = cache.get('zhihu_search', 'q')!;
    assert.strictEqual(hit.stale, true);
    assert.strictEqual(hit.updatedAt, BASE_NOW, 'updatedAt must be the original write time');
  });
});

// ---------------------------------------------------------------------------
// LiveSearchProvider — live path (fake transport)
// ---------------------------------------------------------------------------
describe('LiveSearchProvider live path', () => {
  it('returns provider records labeled live with correct request URL and count', async () => {
    const { provider, calls } = makeSearchProvider(
      () => jsonResponse([fullItem(), { title: '第二条' }]),
      { kind: 'zhihu_search' }
    );
    const result = await provider.search('测试问题');
    assert.strictEqual(result.source, 'live');
    assert.strictEqual(result.updatedAt, BASE_NOW);
    assert.strictEqual(result.sources.length, 2);
    assert.strictEqual(result.sources[0]!.type, 'zhihu');
    assert.strictEqual(result.sources[0]!.author, '真实作者');
    assert.ok(result.stale === undefined);

    assert.strictEqual(calls.length, 1);
    assert.strictEqual(
      calls[0]!.url,
      `${CONFIG.baseUrl}/api/v1/content/zhihu_search?Query=${encodeURIComponent('测试问题')}&Count=10`
    );
  });

  it('sends server-only auth headers with a second-based timestamp', async () => {
    const { provider, calls } = makeSearchProvider(() => jsonResponse([fullItem()]));
    await provider.search('q');
    const headers = calls[0]!.options.headers;
    assert.strictEqual(headers['Authorization'], 'Bearer test-secret');
    assert.strictEqual(headers['Content-Type'], 'application/json');
    assert.strictEqual(headers['X-Request-Timestamp'], String(Math.floor(BASE_NOW / 1000)));
    assert.strictEqual(calls[0]!.options.method, 'GET');
  });

  it('respects the configured result count', async () => {
    const clock = makeClock();
    const { transport, calls } = recordingTransport(() => jsonResponse([fullItem()]));
    const provider = new LiveSearchProvider({
      kind: 'zhihu_search',
      config: CONFIG,
      transport,
      cache: new TtlCache<Source[]>({ now: clock.nowFn }),
      timeoutMs: 5_000,
      now: clock.nowFn,
      count: 5,
    });
    await provider.search('q');
    assert.ok(calls[0]!.url.endsWith('&Count=5'));
  });

  it('global_search hits the global endpoint and maps type web', async () => {
    const { provider, calls } = makeSearchProvider(
      () => jsonResponse([fullItem()]),
      { kind: 'global_search' }
    );
    const result = await provider.search('全网问题');
    assert.strictEqual(result.source, 'live');
    assert.strictEqual(result.sources[0]!.type, 'web');
    assert.ok(calls[0]!.url.startsWith(`${CONFIG.baseUrl}/api/v1/content/global_search?Query=`));
  });

  it('missing provider metadata stays null in live results (never fabricated)', async () => {
    const { provider } = makeSearchProvider(() => jsonResponse([{ title: '只有标题' }]));
    const result = await provider.search('q');
    assert.strictEqual(result.source, 'live');
    assert.strictEqual(result.sources[0]!.author, null);
    assert.strictEqual(result.sources[0]!.url, null);
    assert.strictEqual(result.sources[0]!.excerpt, null);
  });
});

// ---------------------------------------------------------------------------
// Cache behavior — per query and per source kind
// ---------------------------------------------------------------------------
describe('LiveSearchProvider caching', () => {
  it('second identical call uses fresh cache; different query goes live again', async () => {
    let calls = 0;
    const { provider } = makeSearchProvider(() => { calls += 1; return jsonResponse([fullItem()]); });
    const first = await provider.search('同一问题');
    assert.strictEqual(first.source, 'live');

    // #22: live always fires when configured — second call also returns live
    const second = await provider.search('同一问题');
    assert.strictEqual(second.source, 'live', '#22: live always fires');
    assert.strictEqual(calls, 2, 'two live calls for two requests');

    const other = await provider.search('另一个问题');
    assert.strictEqual(other.source, 'live');
    assert.strictEqual(calls, 3);
  });

  it('query normalization: whitespace/case variants share one cache entry', async () => {
    let calls = 0;
    const { provider } = makeSearchProvider(() => { calls += 1; return jsonResponse([fullItem()]); });
    // First call fires live
    await provider.search('  AI  问题  ');
    assert.strictEqual(calls, 1);
    // Second call (normalized query) — #22: live always fires
    const hit = await provider.search('ai 问题');
    assert.strictEqual(hit.source, 'live', '#22: live always fires regardless of cache');
    assert.strictEqual(calls, 2, 'live called again for normalized query variant');
  });

  it('zhihu_search and global_search caches are isolated per source kind', async () => {
    const clock = makeClock();
    const cache = new TtlCache<Source[]>({ now: clock.nowFn });
    const { transport } = recordingTransport(() => jsonResponse([fullItem()]));
    const zhihu = new LiveSearchProvider({
      kind: 'zhihu_search', config: CONFIG, transport, cache, timeoutMs: 5_000, now: clock.nowFn,
    });
    const web = new LiveSearchProvider({
      kind: 'global_search', config: CONFIG, transport, cache, timeoutMs: 5_000, now: clock.nowFn,
    });
    const z1 = await zhihu.search('同一问题');
    const w1 = await web.search('同一问题');
    assert.strictEqual(z1.source, 'live');
    assert.strictEqual(w1.source, 'live', 'same query in another source kind must go live again');
    assert.strictEqual(z1.sources[0]!.type, 'zhihu');
    assert.strictEqual(w1.sources[0]!.type, 'web');
  });

  it('stale cache with live failure returns stale cache with the original updatedAt', async () => {
    const clock = makeClock();
    let fail = false;
    const { transport } = recordingTransport(() => {
      if (fail) throw new TypeError('fetch failed');
      return jsonResponse([fullItem()]);
    });
    const provider = new LiveSearchProvider({
      kind: 'zhihu_search', config: CONFIG, transport,
      cache: new TtlCache<Source[]>({ ttlMs: 1_000, now: clock.nowFn }),
      timeoutMs: 5_000, ttlMs: 1_000, now: clock.nowFn,
    });

    const first = await provider.search('时效问题');
    assert.strictEqual(first.source, 'live');
    clock.advance(1_001);
    fail = true;

    const second = await provider.search('时效问题');
    assert.strictEqual(second.source, 'cache');
    assert.strictEqual(second.stale, true);
    assert.strictEqual(second.updatedAt, first.updatedAt, 'stale hit keeps the original updatedAt');
    assert.deepStrictEqual(second.sources, first.sources);
  });
});

// ---------------------------------------------------------------------------
// Degradation: every external failure falls to the next level, never throws
// ---------------------------------------------------------------------------
describe('LiveSearchProvider degradation', () => {
  const failureCases: Array<{ name: string; respond: () => Promise<Response> }> = [
    { name: 'timeout (transport hangs past timeoutMs)', respond: () => new Promise<Response>((resolve) => { const t = setTimeout(() => resolve(jsonResponse([fullItem()])), 400); if (typeof t === 'object' && t !== null && 'unref' in t) (t as { unref: () => void }).unref(); }) },
    { name: 'network error', respond: async () => { throw new TypeError('fetch failed'); } },
    { name: 'invalid JSON body', respond: async () => new Response('not-json{', { status: 200 }) },
    { name: 'invalid response shape', respond: async () => jsonResponse({ unexpected: 'envelope' }) },
    { name: 'empty usable result', respond: async () => jsonResponse([]) },
    { name: 'HTTP 451', respond: async () => new Response('unavailable for legal reasons', { status: 451 }) },
    { name: 'HTTP 401 auth failure', respond: async () => jsonResponse({ error: 'unauthorized' }, 401) },
    { name: 'HTTP 403 forbidden', respond: async () => jsonResponse({ error: 'forbidden' }, 403) },
    { name: 'HTTP 429 rate limited', respond: async () => jsonResponse({ error: 'rate limited' }, 429) },
    { name: 'HTTP 500 server error', respond: async () => jsonResponse({ error: 'boom' }, 500) },
  ];

  for (const failureCase of failureCases) {
    it(`cold path degrades to demo on: ${failureCase.name}`, async () => {
      const { provider } = makeSearchProvider(failureCase.respond, { timeoutMs: 30 });
      const result = await provider.search('降级测试');
      assert.strictEqual(result.source, 'demo', 'must fall through to demo without throwing');
      assert.deepStrictEqual(result.sources, getDemoSources('降级测试', 'zhihu'));
      assert.strictEqual(result.updatedAt, BASE_NOW);
    });

    it(`warm stale cache is served before demo on: ${failureCase.name}`, async () => {
      const clock = makeClock();
      let fail = false;
      const { transport } = recordingTransport(() => {
        if (fail) return failureCase.respond();
        return jsonResponse([fullItem()]);
      });
      const provider = new LiveSearchProvider({
        kind: 'zhihu_search', config: CONFIG, transport,
        cache: new TtlCache<Source[]>({ ttlMs: 1_000, now: clock.nowFn }),
        timeoutMs: 30, ttlMs: 1_000, now: clock.nowFn,
      });
      const first = await provider.search('降级测试');
      assert.strictEqual(first.source, 'live');
      clock.advance(1_001);
      fail = true;
      const second = await provider.search('降级测试');
      assert.strictEqual(second.source, 'cache');
      assert.strictEqual(second.stale, true);
      assert.deepStrictEqual(second.sources, first.sources);
    });
  }

  it('#22: live always fires when configured; cache is only reached after live failure', async () => {
    let fail = false;
    const clock = makeClock();
    const { transport, calls } = recordingTransport(() => {
      if (fail) throw new TypeError('fetch failed');
      return jsonResponse([fullItem()]);
    });
    const provider = new LiveSearchProvider({
      kind: 'zhihu_search', config: CONFIG, transport,
      cache: new TtlCache<Source[]>({ ttlMs: 10_000, now: clock.nowFn }),
      timeoutMs: 5_000, ttlMs: 10_000, now: clock.nowFn,
    });
    // First call: live fires (no cache)
    await provider.search('q');
    assert.strictEqual(calls.length, 1);
    const firstResult = await provider.search('q');
    // #22: live must fire again even with fresh cache — cache is a fallback after live fails
    assert.strictEqual(firstResult.source, 'live', '#22: live fires even when fresh cache exists');
    assert.strictEqual(calls.length, 2, 'live is called on every request when configured');

    // Now live fails — fresh cache is used as fallback
    fail = true;
    const fallback = await provider.search('q');
    assert.strictEqual(fallback.source, 'cache', 'fallback to cache only after live failure');
    assert.strictEqual(fallback.stale, false);
    assert.strictEqual(calls.length, 3, '#22: live fires on every configured request; even after live failure the next request still attempts live before cache fallback');
  });
});

// ---------------------------------------------------------------------------
// Ticket #22: live-first degradation — fresh cache is a fallback after live
// fails, NOT a default path when live has never been tried.
// ---------------------------------------------------------------------------
describe('Ticket #22: live-first degradation order', () => {
  it('#22: live always fires when configured + transport succeeds, even with fresh cache', async () => {
    const clock = makeClock();
    let callCount = 0;
    const { transport, calls } = recordingTransport(() => {
      callCount += 1;
      return jsonResponse([fullItem()]);
    });
    const provider = new LiveSearchProvider({
      kind: 'zhihu_search', config: CONFIG, transport,
      cache: new TtlCache<Source[]>({ ttlMs: 86_400_000, now: clock.nowFn }),
      timeoutMs: 5_000, ttlMs: 86_400_000, now: clock.nowFn,
    });

    const first = await provider.search('实时问题');
    assert.strictEqual(first.source, 'live', 'first call must be live');
    assert.strictEqual(callCount, 1);

    // #22: fresh cache must NOT short-circuit live — live must fire again
    const second = await provider.search('实时问题');
    assert.strictEqual(second.source, 'live', 'second call must also be live, not cache');
    assert.strictEqual(callCount, 2, 'live must be called on every request when configured');
  });

  it('#22: hotlist live always fires when configured + transport succeeds, even with fresh cache', async () => {
    const clock = makeClock();
    let callCount = 0;
    const { transport } = recordingTransport(() => {
      callCount += 1;
      return jsonResponse([{ title: '热榜A' }, { title: '热榜B' }]);
    });
    const provider = new LiveHotlistProvider({
      config: CONFIG, transport,
      cache: new TtlCache<Array<{ id: string; title: string; url: string | null }>>({
        ttlMs: 86_400_000, now: clock.nowFn,
      }),
      timeoutMs: 5_000, ttlMs: 86_400_000, now: clock.nowFn,
    });

    const first = await provider.fetchHotlist();
    assert.strictEqual(first.source, 'live', 'first hotlist call must be live');
    assert.strictEqual(callCount, 1);

    const second = await provider.fetchHotlist();
    assert.strictEqual(second.source, 'live', 'second hotlist call must also be live');
    assert.strictEqual(callCount, 2, 'live must fire on every hotlist request when configured');
  });

  it('#22: live fails after success → degrades to fresh cache with stale=false', async () => {
    const clock = makeClock();
    let fail = false;
    const { transport } = recordingTransport(() => {
      if (fail) throw new TypeError('network error');
      return jsonResponse([fullItem()]);
    });
    const provider = new LiveSearchProvider({
      kind: 'zhihu_search', config: CONFIG, transport,
      cache: new TtlCache<Source[]>({ ttlMs: 86_400_000, now: clock.nowFn }),
      timeoutMs: 5_000, ttlMs: 86_400_000, now: clock.nowFn,
    });

    const first = await provider.search('降级测试');
    assert.strictEqual(first.source, 'live');
    assert.strictEqual(first.stale, undefined);

    // Now live starts failing — should fall to fresh cache
    fail = true;
    const second = await provider.search('降级测试');
    assert.strictEqual(second.source, 'cache', 'fallback to fresh cache after live failure');
    assert.strictEqual(second.stale, false, 'fresh cache has stale=false');
    assert.deepStrictEqual(second.sources, first.sources, 'fresh cache returns identical data');
  });

  it('#22: live fails + stale cache exists → degrades to stale cache with stale=true', async () => {
    const clock = makeClock();
    let fail = false;
    const { transport } = recordingTransport(() => {
      if (fail) throw new TypeError('network error');
      return jsonResponse([fullItem()]);
    });
    const provider = new LiveSearchProvider({
      kind: 'zhihu_search', config: CONFIG, transport,
      cache: new TtlCache<Source[]>({ ttlMs: 1_000, now: clock.nowFn }),
      timeoutMs: 5_000, ttlMs: 1_000, now: clock.nowFn,
    });

    const first = await provider.search('时效问题');
    assert.strictEqual(first.source, 'live');

    // Age the cache past TTL so it becomes stale
    clock.advance(1_001);
    fail = true;

    const second = await provider.search('时效问题');
    assert.strictEqual(second.source, 'cache', 'fallback to stale cache after live failure');
    assert.strictEqual(second.stale, true, 'stale cache has stale=true');
    assert.strictEqual(second.updatedAt, first.updatedAt, 'stale cache preserves original updatedAt');
    assert.deepStrictEqual(second.sources, first.sources);
  });

  it('#22: live fails + no cache → degrades to demo with source=demo (never cache)', async () => {
    const clock = makeClock();
    let fail = false;
    const { transport } = recordingTransport(() => {
      if (fail) throw new TypeError('network error');
      return jsonResponse([fullItem()]);
    });
    const provider = new LiveSearchProvider({
      kind: 'zhihu_search', config: CONFIG, transport,
      cache: new TtlCache<Source[]>({ ttlMs: 86_400_000, now: clock.nowFn }),
      timeoutMs: 5_000, ttlMs: 86_400_000, now: clock.nowFn,
    });

    // First call: live works and caches data for '首次问题'
    const first = await provider.search('首次问题');
    assert.strictEqual(first.source, 'live');

    // Second call: live fails — but no cache exists for this DIFFERENT query,
    // so fallback goes directly to demo (never cache).
    fail = true;
    const result = await provider.search('全新未缓存的问题');
    assert.strictEqual(result.source, 'demo', 'no cache for new query + live fails → demo');
    assert.notStrictEqual(result.source, 'cache', 'demo must never be labeled cache');
    assert.deepStrictEqual(result.sources, getDemoSources('全新未缓存的问题', 'zhihu'));
  });

  it('#22: same query, different kind — cache keys are isolated, no cross-kind hit', async () => {
    const clock = makeClock();
    let zhihuCalls = 0;
    let webCalls = 0;
    const { transport } = recordingTransport(() => {
      return jsonResponse([fullItem()]);
    });

    const sharedCache = new TtlCache<Source[]>({ ttlMs: 86_400_000, now: clock.nowFn });
    const zhihuProvider = new LiveSearchProvider({
      kind: 'zhihu_search', config: CONFIG, transport: async (url, opts) => {
        zhihuCalls += 1;
        return transport(url, opts);
      },
      cache: sharedCache,
      timeoutMs: 5_000, ttlMs: 86_400_000, now: clock.nowFn,
    });
    const webProvider = new LiveSearchProvider({
      kind: 'global_search', config: CONFIG, transport: async (url, opts) => {
        webCalls += 1;
        return transport(url, opts);
      },
      cache: sharedCache,
      timeoutMs: 5_000, ttlMs: 86_400_000, now: clock.nowFn,
    });

    // zhihu live fires (no prior cache for this kind+query)
    const z1 = await zhihuProvider.search('同一问题');
    assert.strictEqual(z1.source, 'live');
    assert.strictEqual(zhihuCalls, 1);

    // global_search with same query must go live independently (different kind key)
    const w1 = await webProvider.search('同一问题');
    assert.strictEqual(w1.source, 'live', 'different kind must not share cache with zhihu_search');
    assert.strictEqual(webCalls, 1, 'global_search must call live independently');

    // Third zhihu call — under #22 live always fires, so it returns live again
    const z2 = await zhihuProvider.search('同一问题');
    assert.strictEqual(z2.source, 'live', '#22: live always fires when configured');
    assert.strictEqual(zhihuCalls, 2, 'live called again on third zhihu query');
  });

  it('#22: hotlist live always fires when configured; cache is used only after live failure', async () => {
    const clock = makeClock();
    let fail = false;
    const { transport } = recordingTransport(() => {
      if (fail) throw new TypeError('network error');
      return jsonResponse([{ title: '热榜A' }]);
    });
    const provider = new LiveHotlistProvider({
      config: CONFIG, transport,
      cache: new TtlCache<Array<{ id: string; title: string; url: string | null }>>({
        ttlMs: 86_400_000, now: clock.nowFn,
      }),
      timeoutMs: 5_000, ttlMs: 86_400_000, now: clock.nowFn,
    });

    // Step 1: live always fires when configured
    const live = await provider.fetchHotlist();
    assert.strictEqual(live.source, 'live');

    // Step 2: live fires again (fresh cache is NOT used as default path per #22)
    const second = await provider.fetchHotlist();
    assert.strictEqual(second.source, 'live', '#22: live always fires, not cache');

    // Step 3: live fails → fresh cache fallback
    fail = true;
    const freshFallback = await provider.fetchHotlist();
    assert.strictEqual(freshFallback.source, 'cache');
    assert.strictEqual(freshFallback.stale, false);

    // Step 4: stale cache fallback (TTL expired)
    clock.advance(86_400_001);
    const staleFallback = await provider.fetchHotlist();
    assert.strictEqual(staleFallback.source, 'cache');
    assert.strictEqual(staleFallback.stale, true);

    // Step 5: no cache + live fails → demo
    const { transport: t2 } = recordingTransport(() => { throw new TypeError('network error'); });
    const demoProvider = new LiveHotlistProvider({
      config: CONFIG, transport: t2,
      cache: new TtlCache<Array<{ id: string; title: string; url: string | null }>>({
        ttlMs: 86_400_000, now: clock.nowFn,
      }),
      timeoutMs: 5_000, ttlMs: 86_400_000, now: clock.nowFn,
    });
    const demo = await demoProvider.fetchHotlist();
    assert.strictEqual(demo.source, 'demo', 'no cache + live fails → demo');
    assert.strictEqual(demo.items.length, 10);
  });
});

// ---------------------------------------------------------------------------
// No secret → never live, never an external call
// ---------------------------------------------------------------------------
describe('LiveSearchProvider without configuration', () => {
  it('never calls the transport and returns deterministic demo data', async () => {
    const { provider, calls } = makeSearchProvider(() => jsonResponse([fullItem()]), { config: null });
    const result = await provider.search('无密钥问题');
    assert.strictEqual(calls.length, 0, 'no external call without a configured secret');
    assert.strictEqual(result.source, 'demo');
    assert.deepStrictEqual(result.sources, getDemoSources('无密钥问题', 'zhihu'));
  });

  it('empty-string secret is treated as unconfigured', () => {
    assert.strictEqual(readZhihuApiConfig({ ZHIHU_ACCESS_SECRET: '' }), null);
  });
});

// ---------------------------------------------------------------------------
// LiveHotlistProvider
// ---------------------------------------------------------------------------
function makeHotlistProvider(
  handler: FakeHandler,
  overrides: { config?: ZhihuApiConfig | null; ttlMs?: number; timeoutMs?: number } = {}
): { provider: LiveHotlistProvider; calls: CapturedCall[] } {
  const clock = makeClock();
  const { transport, calls } = recordingTransport(handler);
  const provider = new LiveHotlistProvider({
    config: overrides.config !== undefined ? overrides.config : CONFIG,
    transport,
    cache: new TtlCache<Array<{ id: string; title: string; url: string | null }>>({
      ttlMs: overrides.ttlMs ?? 86_400_000, now: clock.nowFn,
    }),
    timeoutMs: overrides.timeoutMs ?? 5_000,
    ttlMs: overrides.ttlMs ?? 86_400_000,
    now: clock.nowFn,
  });
  return { provider, calls };
}

describe('LiveHotlistProvider', () => {
  it('fetches the hot_list endpoint and maps items, keeping a missing URL null', async () => {
    const { provider, calls } = makeHotlistProvider(() =>
      jsonResponse([
        { question_title: '热榜问题A', link: 'https://www.zhihu.com/question/a', heat: 9_999 },
        { title: '热榜问题B' },
        { author: '没有标题被丢弃' },
      ])
    );
    const result = await provider.fetchHotlist();
    assert.strictEqual(result.source, 'live');
    assert.strictEqual(result.items.length, 2);
    assert.strictEqual(result.items[0]!.title, '热榜问题A');
    assert.strictEqual(result.items[0]!.url, 'https://www.zhihu.com/question/a');
    assert.strictEqual(result.items[1]!.title, '热榜问题B');
    assert.strictEqual(result.items[1]!.url, null);
    assert.strictEqual(calls[0]!.url, `${CONFIG.baseUrl}/api/v1/content/hot_list`);
    assert.strictEqual(calls[0]!.options.headers['Authorization'], 'Bearer test-secret');
  });

  it('caches per hot_list kind and returns stale cache when live fails', async () => {
    const clock = makeClock();
    let fail = false;
    const { transport } = recordingTransport(() => {
      if (fail) throw new TypeError('fetch failed');
      return jsonResponse([{ title: '热榜问题A' }]);
    });
    const provider = new LiveHotlistProvider({
      config: CONFIG, transport,
      cache: new TtlCache<Array<{ id: string; title: string; url: string | null }>>({ ttlMs: 1_000, now: clock.nowFn }),
      timeoutMs: 5_000, ttlMs: 1_000, now: clock.nowFn,
    });
    const first = await provider.fetchHotlist();
    assert.strictEqual(first.source, 'live');

    // Second call: #22 — live always fires when configured, so this is also live
    const second = await provider.fetchHotlist();
    assert.strictEqual(second.source, 'live');

    // Now live starts failing — falls to fresh cache
    fail = true;
    const freshFallback = await provider.fetchHotlist();
    assert.strictEqual(freshFallback.source, 'cache');
    assert.strictEqual(freshFallback.stale, false);

    clock.advance(1_001);
    const stale = await provider.fetchHotlist();
    assert.strictEqual(stale.source, 'cache');
    assert.strictEqual(stale.stale, true);
    assert.strictEqual(stale.updatedAt, first.updatedAt);
  });

  it('degrades to the deterministic 10-item demo hotlist on failure', async () => {
    const { provider } = makeHotlistProvider(async () => new Response('blocked', { status: 451 }));
    const result = await provider.fetchHotlist();
    assert.strictEqual(result.source, 'demo');
    assert.strictEqual(result.items.length, 10);
    for (const item of result.items) {
      assert.ok(typeof item.id === 'string' && item.id.length > 0);
      assert.ok(typeof item.title === 'string' && item.title.length > 0);
      assert.ok(typeof item.url === 'string' && item.url.length > 0, 'demo items carry demo URLs');
    }
  });

  it('returns demo without any external call when unconfigured', async () => {
    const { provider, calls } = makeHotlistProvider(() => jsonResponse([{ title: 'x' }]), { config: null });
    const result = await provider.fetchHotlist();
    assert.strictEqual(calls.length, 0);
    assert.strictEqual(result.source, 'demo');
    assert.strictEqual(result.items.length, 10);
  });
});

// ---------------------------------------------------------------------------
// Knowledge graph keeps deriving from real provider sources (#19 verification)
// ---------------------------------------------------------------------------
describe('knowledge graph from live sources', () => {
  it('buildGraph derives nodes from real provider source text', async () => {
    const { provider } = makeSearchProvider(() =>
      jsonResponse([
        { title: '真实知乎标题', content: '真实摘要内容', author: '真实作者', url: 'https://www.zhihu.com/question/9527' },
        { title: '第二条真实讨论', content: '更多真实摘要', author: null, url: null },
      ])
    );
    const result = await provider.search('图问题');
    const { report } = await buildReport({
      question: '图问题',
      zhihuSources: result.sources,
      webSources: [],
      zhihuSourceState: result.source,
      webSourceState: 'live',
    });
    const graph = buildGraph(report, report.references);
    assert.ok(graph.nodes.length >= 2);
    assert.ok(
      graph.nodes.some(n => n.label === '真实知乎标题'),
      'graph nodes must come from the live provider title'
    );
    assert.ok(
      report.references.every(s => s.type === 'zhihu'),
      'references must be exactly the provider records'
    );
  });
});
