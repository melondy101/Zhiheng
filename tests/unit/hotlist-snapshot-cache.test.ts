// Ticket T1 (PRD v4.2 §2): the hotlist persistent snapshot contract.
//
// The provider is exercised with a fake snapshot store (read/write counters)
// and a fake HTTP transport, so no database and no network is involved. The
// asserted contract is the PRD §2.2 decision table:
//
//   | fresh snapshot (<= 6h)      -> 'cache',          zero external calls
//   | expired + live success      -> 'live',           snapshot overwritten
//   | expired + live failure      -> 'cache' + stale,  real updatedAt kept
//   | no snapshot + live failure  -> 'demo',           nothing written
//   | store read failure          -> never a fake cache hit
//
// Honesty red lines asserted here: demo data is never written to the store,
// only a real live success is persisted, and a stale result keeps the
// snapshot's true update time.
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  HOTLIST_SNAPSHOT_TTL_MS,
  LiveHotlistProvider,
  RETRIEVAL_TTL_MS,
  TtlCache,
  type LiveHotlistProviderOptions,
  type ZhihuApiConfig,
  type ZhihuCallOptions,
  type ZhihuHttpTransport,
} from '../../src/lib/zhihu-retrieval';
import { StorageUnavailableError } from '../../src/lib/db/sql-executor';
import type { HotlistItem } from '../../src/lib/hotlist-providers';
import type { HotlistSnapshot, HotlistSnapshotStore } from '../../src/lib/db/hotlist-snapshot-store';

const CONFIG: ZhihuApiConfig = { baseUrl: 'https://fake.example', accessSecret: 'test-secret' };
const BASE_NOW = 1_770_000_000_000;

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

interface CapturedCall {
  url: string;
  options: ZhihuCallOptions;
}

function recordingTransport(
  handler: () => Response | Promise<Response>
): { transport: ZhihuHttpTransport; calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  return {
    calls,
    transport: async (url, options) => {
      calls.push({ url, options });
      return handler();
    },
  };
}

function hotItem(title: string): HotlistItem {
  return { id: `hot_${title}`, title, url: 'https://www.zhihu.com/question/live' };
}

/** A snapshot store with read/write counters and injectable failures. */
class FakeSnapshotStore implements HotlistSnapshotStore {
  reads = 0;
  writes = 0;
  snapshot: HotlistSnapshot | null;
  readError: Error | null = null;
  writeError: Error | null = null;

  constructor(snapshot: HotlistSnapshot | null = null) {
    this.snapshot = snapshot;
  }

  async read(): Promise<HotlistSnapshot | null> {
    this.reads += 1;
    if (this.readError) throw this.readError;
    return this.snapshot === null ? null : { items: [...this.snapshot.items], updatedAt: this.snapshot.updatedAt };
  }

  async write(snapshot: HotlistSnapshot): Promise<void> {
    this.writes += 1;
    if (this.writeError) throw this.writeError;
    this.snapshot = { items: [...snapshot.items], updatedAt: snapshot.updatedAt };
  }
}

interface Harness {
  provider: LiveHotlistProvider;
  calls: CapturedCall[];
  store: FakeSnapshotStore;
  clock: { nowFn: () => number; advance: (ms: number) => void };
}

function makeHarness(options: {
  snapshot?: HotlistSnapshot | null;
  live?: 'ok' | 'fail' | 'empty';
  config?: ZhihuApiConfig | null;
  advancedMs?: number;
} = {}): Harness {
  const clock = makeClock();
  clock.advance(options.advancedMs ?? 0);
  const mode = options.live ?? 'ok';
  const { transport, calls } = recordingTransport(() => {
    if (mode === 'fail') throw new TypeError('network error');
    if (mode === 'empty') return jsonResponse([]);
    return jsonResponse([{ title: '实时热榜A' }, { title: '实时热榜B' }]);
  });
  const store = new FakeSnapshotStore(options.snapshot ?? null);
  const providerOptions: LiveHotlistProviderOptions = {
    config: options.config !== undefined ? options.config : CONFIG,
    transport,
    cache: new TtlCache<HotlistItem[]>({ ttlMs: 86_400_000, now: clock.nowFn }),
    timeoutMs: 5_000,
    ttlMs: 86_400_000,
    now: clock.nowFn,
    snapshotStore: store,
  };
  return { provider: new LiveHotlistProvider(providerOptions), calls, store, clock };
}

const SNAPSHOT_ITEMS: HotlistItem[] = [hotItem('快照条目1'), hotItem('快照条目2')];

describe('hotlist snapshot cache (PRD v4.2 §2, ticket T1)', () => {
  it('1. fresh DB snapshot (within 6h) → zero transport calls, source cache, no stale flag', async () => {
    const { provider, calls, store } = makeHarness({
      snapshot: { items: SNAPSHOT_ITEMS, updatedAt: BASE_NOW - 1_000 },
      live: 'ok',
    });

    const result = await provider.fetchHotlist();

    assert.strictEqual(calls.length, 0, 'a fresh snapshot must not call the live API');
    assert.strictEqual(result.source, 'cache');
    assert.strictEqual(result.stale, undefined, 'fresh cache carries no stale flag');
    assert.strictEqual(result.updatedAt, BASE_NOW - 1_000, 'the snapshot update time is preserved');
    assert.deepStrictEqual(result.items, SNAPSHOT_ITEMS);
    assert.strictEqual(store.writes, 0, 'serving a fresh snapshot writes nothing');
  });

  it('2. stale snapshot + live success → source live and the snapshot is overwritten', async () => {
    const expiredAt = BASE_NOW - HOTLIST_SNAPSHOT_TTL_MS - 1_000;
    const { provider, store, calls } = makeHarness({
      snapshot: { items: SNAPSHOT_ITEMS, updatedAt: expiredAt },
      live: 'ok',
    });

    const result = await provider.fetchHotlist();

    assert.strictEqual(calls.length, 1, 'an expired snapshot must attempt a live refresh');
    assert.strictEqual(result.source, 'live');
    assert.strictEqual(result.stale, undefined);
    assert.strictEqual(result.items.length, 2);
    assert.strictEqual(store.writes, 1, 'a live success is persisted exactly once');

    // The stored snapshot now holds the new items with the new update time.
    const refreshed = await store.read();
    assert.ok(refreshed);
    assert.deepStrictEqual(refreshed!.items, result.items);
    assert.strictEqual(refreshed!.updatedAt, BASE_NOW);
  });

  it('3. stale snapshot + live failure → source cache + stale:true with the real updatedAt', async () => {
    const expiredAt = BASE_NOW - HOTLIST_SNAPSHOT_TTL_MS - 60_000;
    const { provider, store } = makeHarness({
      snapshot: { items: SNAPSHOT_ITEMS, updatedAt: expiredAt },
      live: 'fail',
    });

    const result = await provider.fetchHotlist();

    assert.strictEqual(result.source, 'cache');
    assert.strictEqual(result.stale, true);
    assert.strictEqual(result.updatedAt, expiredAt, 'the stale result keeps the snapshot time');
    assert.deepStrictEqual(result.items, SNAPSHOT_ITEMS);
    assert.strictEqual(store.writes, 0, 'a failed refresh writes nothing');
  });

  it('4. no snapshot + live failure → demo, and demo is never written to the store', async () => {
    const { provider, store } = makeHarness({ snapshot: null, live: 'fail' });

    const result = await provider.fetchHotlist();

    assert.strictEqual(result.source, 'demo');
    assert.strictEqual(result.items.length, 10, 'the deterministic 10-item demo list');
    assert.strictEqual(result.stale, undefined);
    assert.strictEqual(store.writes, 0, 'demo data must never be persisted as a cache');
    assert.strictEqual((await store.read()), null);
  });

  it('5. no snapshot + live success → source live, written once', async () => {
    const { provider, store, calls } = makeHarness({ snapshot: null, live: 'ok' });

    const result = await provider.fetchHotlist();

    assert.strictEqual(calls.length, 1);
    assert.strictEqual(result.source, 'live');
    assert.strictEqual(result.items.length, 2);
    assert.strictEqual(store.writes, 1);
    const stored = await store.read();
    assert.ok(stored);
    assert.deepStrictEqual(stored!.items, result.items);
  });

  it('6. read() throws StorageUnavailableError + live success → live, never a fake cache', async () => {
    const { provider, store } = makeHarness({ snapshot: null, live: 'ok' });
    store.readError = new StorageUnavailableError('database down');

    const result = await provider.fetchHotlist();

    assert.strictEqual(result.source, 'live');
    assert.strictEqual(result.stale, undefined);
    assert.strictEqual(store.writes, 1, 'the live result is still persisted');
  });

  it('7. read() throws StorageUnavailableError + live failure → demo, never a fake cache', async () => {
    const { provider, store } = makeHarness({ snapshot: null, live: 'fail' });
    store.readError = new StorageUnavailableError('database down');

    const result = await provider.fetchHotlist();

    assert.strictEqual(result.source, 'demo');
    assert.strictEqual(result.stale, undefined);
    assert.notStrictEqual(result.source, 'cache', 'a database failure must not look like a cache');
    assert.strictEqual(store.writes, 0);
  });

  it('8. boundary: exactly 6h - 1ms is fresh, exactly 6h + 1ms is expired', async () => {
    const fresh = makeHarness({
      snapshot: { items: SNAPSHOT_ITEMS, updatedAt: BASE_NOW - (HOTLIST_SNAPSHOT_TTL_MS - 1) },
      live: 'ok',
    });
    const freshResult = await fresh.provider.fetchHotlist();
    assert.strictEqual(freshResult.source, 'cache', '6h - 1ms is still fresh');
    assert.strictEqual(freshResult.stale, undefined);
    assert.strictEqual(fresh.calls.length, 0, 'no external call while fresh');

    const expired = makeHarness({
      snapshot: { items: SNAPSHOT_ITEMS, updatedAt: BASE_NOW - (HOTLIST_SNAPSHOT_TTL_MS + 1) },
      live: 'ok',
    });
    const expiredResult = await expired.provider.fetchHotlist();
    assert.strictEqual(expiredResult.source, 'live', '6h + 1ms must refresh');
    assert.strictEqual(expired.calls.length, 1);
    assert.strictEqual(expired.store.writes, 1);
  });

  it('hotlist snapshot TTL is pinned to 6 hours, not the 24h retrieval TTL', async () => {
    // The boundary cases above derive their expectations from the constant
    // itself, so they stay green even if someone re-points it at the 24h
    // retrieval TTL — the exact regression PRD §2.2 exists to prevent. Pin
    // the absolute value here.
    assert.strictEqual(HOTLIST_SNAPSHOT_TTL_MS, 6 * 60 * 60 * 1000);
    assert.strictEqual(HOTLIST_SNAPSHOT_TTL_MS, 21_600_000);
    assert.notStrictEqual(
      HOTLIST_SNAPSHOT_TTL_MS,
      RETRIEVAL_TTL_MS,
      'the snapshot TTL must not be the 24h retrieval TTL'
    );
    assert.strictEqual(RETRIEVAL_TTL_MS, 86_400_000, 'the retrieval TTL stays the 24h baseline');

    // And the pinned value is the one the provider actually applies: a
    // snapshot 1ms inside 6h is served, 1ms outside it is refreshed.
    const fresh = makeHarness({
      snapshot: { items: SNAPSHOT_ITEMS, updatedAt: BASE_NOW - (21_600_000 - 1) },
      live: 'ok',
    });
    assert.strictEqual((await fresh.provider.fetchHotlist()).source, 'cache');

    const expired = makeHarness({
      snapshot: { items: SNAPSHOT_ITEMS, updatedAt: BASE_NOW - (21_600_000 + 1) },
      live: 'ok',
    });
    assert.strictEqual((await expired.provider.fetchHotlist()).source, 'live');
  });

  it('an empty live payload is not persisted and falls back through the chain', async () => {
    const { provider, store } = makeHarness({ snapshot: null, live: 'empty' });

    const result = await provider.fetchHotlist();

    assert.strictEqual(result.source, 'demo', 'an unusable live payload is a failure');
    assert.strictEqual(store.writes, 0, 'an empty payload is never persisted');
  });

  it('no secret + stale snapshot → the old snapshot is served as stale cache, no external call', async () => {
    const expiredAt = BASE_NOW - HOTLIST_SNAPSHOT_TTL_MS - 1;
    const { provider, calls, store } = makeHarness({
      snapshot: { items: SNAPSHOT_ITEMS, updatedAt: expiredAt },
      config: null,
    });

    const result = await provider.fetchHotlist();

    assert.strictEqual(calls.length, 0, 'without a secret the transport is never invoked');
    assert.strictEqual(result.source, 'cache');
    assert.strictEqual(result.stale, true);
    assert.strictEqual(result.updatedAt, expiredAt);
    assert.strictEqual(store.writes, 0);
  });

  it('a write failure keeps source live — the data is real, only the persistence failed', async () => {
    const { provider, store } = makeHarness({ snapshot: null, live: 'ok' });
    store.writeError = new StorageUnavailableError('write failed');

    const result = await provider.fetchHotlist();

    assert.strictEqual(result.source, 'live');
    assert.strictEqual(result.items.length, 2);
    assert.strictEqual(store.writes, 1);
    assert.strictEqual(store.snapshot, null, 'the failed write did not persist anything');
  });
});
