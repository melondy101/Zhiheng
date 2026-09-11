// Ticket T1: the hotlist persistent snapshot contract (hourly Beijing time cache).
//
// The provider is exercised with a fake snapshot store (read/write counters)
// and a fake HTTP transport, so no database and no network is involved. The
// asserted contract is the hourly Beijing-time decision table:
//
//   | fresh snapshot (same Beijing hour) -> 'cache',          zero external calls
//   | previous hour + live success       -> 'live',           snapshot overwritten
//   | previous hour + live failure       -> 'cache' + stale,  real updatedAt kept
//   | force:true + live success          -> 'live',           bypasses cache and updates
//   | no snapshot + live failure         -> 'demo',           nothing written
//   | store read failure                 -> never a fake cache hit
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
  isHotlistSnapshotFresh,
  getBeijingHourStart,
  getBeijingHourSlot,
  type LiveHotlistProviderOptions,
  type ZhihuApiConfig,
  type ZhihuCallOptions,
  type ZhihuHttpTransport,
} from '../../src/lib/zhihu-retrieval';
import { StorageUnavailableError } from '../../src/lib/db/sql-executor';
import type { HotlistItem } from '../../src/lib/hotlist-providers';
import type { HotlistSnapshot, HotlistSnapshotStore } from '../../src/lib/db/hotlist-snapshot-store';

const CONFIG: ZhihuApiConfig = { baseUrl: 'https://fake.example', accessSecret: 'test-secret' };
// 1770000000000 is 2026-02-02 10:40:00 Beijing Time (UTC+8)
const BASE_NOW = 1_770_000_000_000;
// Hour start for 10:00:00 Beijing Time
const BEIJING_10_00 = getBeijingHourStart(BASE_NOW);
// 09:50:00 Beijing Time (previous hour)
const BEIJING_09_50 = BEIJING_10_00 - 10 * 60 * 1000;
// 10:15:00 Beijing Time (same hour)
const BEIJING_10_15 = BEIJING_10_00 + 15 * 60 * 1000;

function makeClock(initial = BASE_NOW) {
  const state = { now: initial };
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

describe('hotlist hourly Beijing-time cache and refresh', () => {
  it('1. fresh DB snapshot (same Beijing hour slot, e.g. 10:15 at 10:40) → zero transport calls, source cache', async () => {
    const { provider, calls, store } = makeHarness({
      snapshot: { items: SNAPSHOT_ITEMS, updatedAt: BEIJING_10_15 },
      live: 'ok',
    });

    const result = await provider.fetchHotlist();

    assert.strictEqual(calls.length, 0, 'a fresh snapshot in the same hour must not call live API');
    assert.strictEqual(result.source, 'cache');
    assert.strictEqual(result.stale, undefined, 'fresh cache carries no stale flag');
    assert.strictEqual(result.updatedAt, BEIJING_10_15, 'the snapshot update time is preserved');
    assert.deepStrictEqual(result.items, SNAPSHOT_ITEMS);
    assert.strictEqual(store.writes, 0, 'serving a fresh snapshot writes nothing');
  });

  it('2. previous hour snapshot (e.g. 09:50 at 10:40) + live success → source live and snapshot overwritten', async () => {
    const { provider, store, calls } = makeHarness({
      snapshot: { items: SNAPSHOT_ITEMS, updatedAt: BEIJING_09_50 },
      live: 'ok',
    });

    const result = await provider.fetchHotlist();

    assert.strictEqual(calls.length, 1, 'an expired snapshot from previous hour must attempt live refresh');
    assert.strictEqual(result.source, 'live');
    assert.strictEqual(result.stale, undefined);
    assert.strictEqual(result.items.length, 2);
    assert.strictEqual(store.writes, 1, 'a live success is persisted exactly once');

    // The stored snapshot now holds the new items with current time.
    const refreshed = await store.read();
    assert.ok(refreshed);
    assert.deepStrictEqual(refreshed!.items, result.items);
    assert.strictEqual(refreshed!.updatedAt, BASE_NOW);
  });

  it('3. previous hour snapshot + live failure → source cache + stale:true with real updatedAt', async () => {
    const { provider, store } = makeHarness({
      snapshot: { items: SNAPSHOT_ITEMS, updatedAt: BEIJING_09_50 },
      live: 'fail',
    });

    const result = await provider.fetchHotlist();

    assert.strictEqual(result.source, 'cache');
    assert.strictEqual(result.stale, true);
    assert.strictEqual(result.updatedAt, BEIJING_09_50, 'the stale result keeps the snapshot time');
    assert.deepStrictEqual(result.items, SNAPSHOT_ITEMS);
    assert.strictEqual(store.writes, 0, 'a failed refresh writes nothing');
  });

  it('4. force:true bypasses fresh cache and fetches live', async () => {
    const { provider, store, calls } = makeHarness({
      snapshot: { items: SNAPSHOT_ITEMS, updatedAt: BEIJING_10_15 },
      live: 'ok',
    });

    const result = await provider.fetchHotlist({ force: true });

    assert.strictEqual(calls.length, 1, 'force:true must invoke live fetch');
    assert.strictEqual(result.source, 'live');
    assert.strictEqual(store.writes, 1, 'new live result is persisted');
  });

  it('5. no snapshot + live failure → demo, and demo is never written to store', async () => {
    const { provider, store } = makeHarness({ snapshot: null, live: 'fail' });

    const result = await provider.fetchHotlist();

    assert.strictEqual(result.source, 'demo');
    assert.strictEqual(result.items.length, 10, 'the deterministic 10-item demo list');
    assert.strictEqual(result.stale, undefined);
    assert.strictEqual(store.writes, 0, 'demo data must never be persisted as a cache');
    assert.strictEqual((await store.read()), null);
  });

  it('6. no snapshot + live success → source live, written once', async () => {
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

  it('7. read() throws StorageUnavailableError + live success → live, never a fake cache', async () => {
    const { provider, store } = makeHarness({ snapshot: null, live: 'ok' });
    store.readError = new StorageUnavailableError('database down');

    const result = await provider.fetchHotlist();

    assert.strictEqual(result.source, 'live');
    assert.strictEqual(result.stale, undefined);
    assert.strictEqual(store.writes, 1, 'the live result is still persisted');
  });

  it('8. read() throws StorageUnavailableError + live failure → demo, never a fake cache', async () => {
    const { provider, store } = makeHarness({ snapshot: null, live: 'fail' });
    store.readError = new StorageUnavailableError('database down');

    const result = await provider.fetchHotlist();

    assert.strictEqual(result.source, 'demo');
    assert.strictEqual(result.stale, undefined);
    assert.notStrictEqual(result.source, 'cache', 'a database failure must not look like a cache');
    assert.strictEqual(store.writes, 0);
  });

  it('9. Beijing hour slot boundary: exactly top of hour marks a new slot', () => {
    const slot1 = getBeijingHourSlot(BEIJING_10_00 - 1); // 09:59:59.999
    const slot2 = getBeijingHourSlot(BEIJING_10_00);     // 10:00:00.000
    assert.notStrictEqual(slot1, slot2);
    assert.strictEqual(isHotlistSnapshotFresh(BEIJING_10_00 - 1, BEIJING_10_00), false);
    assert.strictEqual(isHotlistSnapshotFresh(BEIJING_10_00, BEIJING_10_00 + 1_800_000), true); // 10:30 uses 10:00 cache
  });
});
