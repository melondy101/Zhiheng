// Ticket T1 (PRD v4.2 §2): /api/hotlist wiring contract.
//
// The REAL route handler (src/app/api/hotlist/route.ts) is invoked here; only
// its two dependencies (snapshot-store factory and provider factory) are
// replaced by recording wrappers, so the assertions pin the actual wiring:
// env → createSnapshotStore(env) → createProvider({ snapshotStore }) → GET.
//
// No database and no network is touched: the store is an in-memory fake and
// the no-key environment makes the provider's live path impossible.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { GET as hotlistGET } from '../../src/app/api/hotlist/route';
import {
  defaultHotlistRouteDependencies,
  getHotlistRouteDependencies,
  loadHotlistForRoute,
  setHotlistRouteDependencies,
  type HotlistRouteDependencies,
} from '../../src/lib/hotlist-route-wiring';
import { createHotlistSnapshotStoreFromEnv } from '../../src/lib/db/hotlist-snapshot-store';
import type { HotlistSnapshot, HotlistSnapshotStore } from '../../src/lib/db/hotlist-snapshot-store';
import type { LiveHotlistProvider, LiveHotlistProviderOptions } from '../../src/lib/zhihu-retrieval';
import type { HotlistItem } from '../../src/lib/hotlist-providers';
import type { SourceState } from '../../src/lib/providers';

interface HotlistBody {
  items: HotlistItem[];
  source: SourceState;
  updatedAt: number;
  stale?: boolean;
}

/** An in-memory snapshot store — never a real database. */
class FakeSnapshotStore implements HotlistSnapshotStore {
  constructor(private snapshot: HotlistSnapshot | null) {}

  async read(): Promise<HotlistSnapshot | null> {
    return this.snapshot;
  }

  async write(snapshot: HotlistSnapshot): Promise<void> {
    this.snapshot = snapshot;
  }
}

function hotItem(title: string): HotlistItem {
  return { id: `hot_${title}`, title, url: 'https://www.zhihu.com/question/live' };
}

let savedDatabaseUrl: string | undefined;
let savedSecret: string | undefined;

beforeEach(() => {
  savedDatabaseUrl = process.env.DATABASE_URL;
  savedSecret = process.env.ZHIHU_ACCESS_SECRET;
  delete process.env.DATABASE_URL;
  delete process.env.ZHIHU_ACCESS_SECRET;
});

afterEach(() => {
  setHotlistRouteDependencies(null);
  if (savedDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = savedDatabaseUrl;
  if (savedSecret === undefined) delete process.env.ZHIHU_ACCESS_SECRET;
  else process.env.ZHIHU_ACCESS_SECRET = savedSecret;
});

describe('GET /api/hotlist wiring (ticket T1)', () => {
  it('a. passes the environment into the snapshot store factory', async () => {
    const seenEnvs: Array<Record<string, string | undefined>> = [];
    const store = new FakeSnapshotStore(null);
    setHotlistRouteDependencies({
      createSnapshotStore: async (env) => {
        seenEnvs.push(env);
        return store;
      },
      createProvider: (overrides) => defaultHotlistRouteDependencies.createProvider(overrides),
    });

    await hotlistGET();

    assert.strictEqual(seenEnvs.length, 1, 'the factory is called exactly once per request');
    assert.strictEqual(seenEnvs[0], process.env, 'the route hands its env to the factory');
  });

  it('b. hands the factory-created store to the provider (same object identity)', async () => {
    const store = new FakeSnapshotStore(null);
    const seenOverrides: Array<Partial<LiveHotlistProviderOptions>> = [];
    setHotlistRouteDependencies({
      createSnapshotStore: async () => store,
      createProvider: (overrides) => {
        seenOverrides.push(overrides);
        return defaultHotlistRouteDependencies.createProvider(overrides);
      },
    });

    const response = await hotlistGET();

    assert.strictEqual(response.status, 200);
    assert.strictEqual(seenOverrides.length, 1);
    assert.ok(seenOverrides[0]!.snapshotStore, 'the provider must receive a snapshot store');
    assert.strictEqual(
      seenOverrides[0]!.snapshotStore,
      store,
      'the provider receives exactly the store the factory returned'
    );
  });

  it('c. without DATABASE_URL the factory yields null, the provider gets no store, GET still 200', async () => {
    const seenOverrides: Array<Partial<LiveHotlistProviderOptions>> = [];
    let factoryResult: HotlistSnapshotStore | null | undefined;
    const deps: HotlistRouteDependencies = {
      // The REAL env factory — with no DATABASE_URL it must return null.
      createSnapshotStore: async (env) => {
        const created = await createHotlistSnapshotStoreFromEnv(env);
        factoryResult = created;
        return created;
      },
      createProvider: (overrides) => {
        seenOverrides.push(overrides);
        return defaultHotlistRouteDependencies.createProvider(overrides);
      },
    };
    setHotlistRouteDependencies(deps);

    delete process.env.DATABASE_URL;
    const response = await hotlistGET();

    assert.strictEqual(factoryResult, null, 'no DATABASE_URL → no snapshot store');
    assert.ok(!seenOverrides[0]!.snapshotStore, 'no store is handed to the provider');
    assert.strictEqual(response.status, 200);

    const body = (await response.json()) as HotlistBody;
    assert.strictEqual(body.source, 'demo', 'no key + no store → the honest demo path');
    assert.strictEqual(body.items.length, 10);
  });

  it('d. end-to-end: a fresh snapshot in the store is what the real GET returns', async () => {
    const updatedAt = Date.now() - 60_000;
    const items = [hotItem('持久化热榜一'), hotItem('持久化热榜二')];
    const store = new FakeSnapshotStore({ items, updatedAt });
    setHotlistRouteDependencies({
      createSnapshotStore: async () => store,
      createProvider: (overrides) => defaultHotlistRouteDependencies.createProvider(overrides),
    });

    const response = await hotlistGET();

    assert.strictEqual(response.status, 200);
    const body = (await response.json()) as HotlistBody;
    assert.strictEqual(body.source, 'cache', 'a fresh snapshot is served without a live call');
    assert.strictEqual(body.stale, undefined);
    assert.strictEqual(body.updatedAt, updatedAt);
    assert.deepStrictEqual(body.items, items, 'the body IS the persisted snapshot');
  });

  it('e. setHotlistRouteDependencies(null) restores the default wiring', () => {
    setHotlistRouteDependencies({
      createSnapshotStore: async () => new FakeSnapshotStore(null),
      createProvider: (overrides) => defaultHotlistRouteDependencies.createProvider(overrides),
    });
    assert.notStrictEqual(getHotlistRouteDependencies(), defaultHotlistRouteDependencies);

    setHotlistRouteDependencies(null);
    assert.strictEqual(getHotlistRouteDependencies(), defaultHotlistRouteDependencies);
  });

  it('f. the production default wiring is the real env factory, by identity', () => {
    // Every other case injects its own factory, so a default hard-wired to
    // `async () => null` would leave production with no cache while the whole
    // suite stayed green. Pin the default to the real factory itself.
    assert.strictEqual(
      defaultHotlistRouteDependencies.createSnapshotStore,
      createHotlistSnapshotStoreFromEnv,
      'the default wiring must use the real DATABASE_URL → snapshot store factory'
    );
  });

  it('g. with the untouched default wiring, the real GET still answers (no DATABASE_URL)', async () => {
    // No dependency override at all: this exercises the exact object the
    // production route uses (afterEach resets any previous override).
    setHotlistRouteDependencies(null);
    assert.strictEqual(getHotlistRouteDependencies(), defaultHotlistRouteDependencies);

    delete process.env.DATABASE_URL;
    delete process.env.ZHIHU_ACCESS_SECRET;

    const response = await hotlistGET();

    assert.strictEqual(response.status, 200, 'the default wiring must never break the route');
    const body = (await response.json()) as HotlistBody;
    assert.strictEqual(body.source, 'demo', 'no key + no configured database → honest demo');
    assert.strictEqual(body.stale, undefined);
    assert.strictEqual(body.items.length, 10);
  });

  it('loadHotlistForRoute composes store → provider with explicit dependencies', async () => {
    const updatedAt = Date.now() - 1_000;
    const items = [hotItem('直接接线条目')];
    const store = new FakeSnapshotStore({ items, updatedAt });
    const seenEnvs: Array<Record<string, string | undefined>> = [];
    let provider: LiveHotlistProvider | null = null;
    const deps: HotlistRouteDependencies = {
      createSnapshotStore: async (env) => {
        seenEnvs.push(env);
        return store;
      },
      createProvider: (overrides) => {
        provider = defaultHotlistRouteDependencies.createProvider(overrides);
        return provider;
      },
    };

    const result = await loadHotlistForRoute({ DATABASE_URL: '' }, deps);

    assert.strictEqual(seenEnvs.length, 1);
    assert.deepStrictEqual(seenEnvs[0], { DATABASE_URL: '' }, 'the explicit env is forwarded');
    assert.ok(provider, 'the provider is built from the composed dependencies');
    assert.strictEqual(result.source, 'cache');
    assert.deepStrictEqual(result.items, items);
  });
});
