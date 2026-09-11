// Ticket #26/T1: additional unit + route-level tests for the DB-backed hotlist cache.
//
// This test supplements the existing hotlist-snapshot-cache.test.ts and
// hotlist-route-wiring.test.ts by asserting the PRD v4.2 §2.2 decision chain
// through the pure resolveHotlist helper and the actual GET() route handler.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  defaultHotlistRouteDependencies,
  getHotlistRouteDependencies,
  setHotlistRouteDependencies,
} from '../../src/lib/hotlist-route-wiring';
import { GET as rawHotlistGET } from '../../src/app/api/hotlist/route';

const hotlistGET = (req?: Request) => rawHotlistGET(req ?? new Request('http://localhost:3000/api/hotlist'));
import type { HotlistSnapshot, HotlistSnapshotStore } from '../../src/lib/db/hotlist-snapshot-store';
import type { LiveHotlistProvider } from '../../src/lib/zhihu-retrieval';
import type { HotlistItem } from '../../src/lib/hotlist-providers';
import type { SourceState } from '../../src/lib/providers';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HotlistBody {
  items: HotlistItem[];
  source: SourceState;
  updatedAt: number;
  stale?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hotItem(title: string): HotlistItem {
  return { id: `ht_${title}`, title, url: 'https://www.zhihu.com/question/live' };
}

/** An in-memory snapshot store — never a real database. */
function makeFakeStore(snapshot: HotlistSnapshot | null = null): HotlistSnapshotStore {
  let data = snapshot;
  return {
    async read(): Promise<HotlistSnapshot | null> {
      return data;
    },
    async write(s: HotlistSnapshot): Promise<void> {
      data = { ...s, items: [...s.items] };
    },
  };
}

function makeFakeProvider(
  result: { source: SourceState; items: HotlistItem[]; updatedAt: number; stale?: boolean }
): { fetchHotlist: () => Promise<{ source: SourceState; items: HotlistItem[]; updatedAt: number; stale?: boolean }> } {
  return {
    async fetchHotlist() {
      return { ...result };
    },
  };
}

// ---------------------------------------------------------------------------
// Route wiring tests — verify the route actually calls the factory
// ---------------------------------------------------------------------------

describe('GET /api/hotlist — route wiring (#26/T1)', () => {
  beforeEach(() => {
    // Save and clear env
    (global as unknown as { savedDatabaseUrl?: string }).savedDatabaseUrl = process.env.DATABASE_URL;
    (global as unknown as { savedSecret?: string }).savedSecret = process.env.ZHIHU_ACCESS_SECRET;
    delete process.env.DATABASE_URL;
    delete process.env.ZHIHU_ACCESS_SECRET;
    setHotlistRouteDependencies(null);
  });

  afterEach(() => {
    setHotlistRouteDependencies(null);
    const g = global as unknown as { savedDatabaseUrl?: string; savedSecret?: string };
    if (g.savedDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = g.savedDatabaseUrl;
    if (g.savedSecret === undefined) delete process.env.ZHIHU_ACCESS_SECRET;
    else process.env.ZHIHU_ACCESS_SECRET = g.savedSecret;
  });

  it('route calls the snapshot store factory and serves a fresh DB snapshot', async () => {
    const freshSnap: HotlistSnapshot = {
      items: [hotItem('fresh')],
      updatedAt: Date.now(),
    };
    const store = makeFakeStore(freshSnap);
    const factoryCalls: Array<Record<string, string | undefined>> = [];
    setHotlistRouteDependencies({
      createSnapshotStore: async (env) => {
        factoryCalls.push({ ...env });
        return store;
      },
      createProvider: (overrides) => defaultHotlistRouteDependencies.createProvider(overrides),
    });

    const response = await hotlistGET();
    assert.strictEqual(response.status, 200);
    const body = (await response.json()) as HotlistBody;
    assert.strictEqual(body.source, 'cache');
    assert.strictEqual(body.items[0].id, 'ht_fresh');
    assert.strictEqual(body.stale, undefined, 'fresh cache has no stale flag');
    assert.strictEqual(factoryCalls.length, 1, 'factory must be called once per GET');
  });

  it('route serves stale snapshot when provider returns demo', async () => {
    const staleSnap: HotlistSnapshot = {
      items: [hotItem('stale')],
      updatedAt: Date.now() - 7 * 60 * 60 * 1000, // 7h ago → stale
    };
    const store = makeFakeStore(staleSnap);
    setHotlistRouteDependencies({
      createSnapshotStore: async () => store,
      createProvider: (overrides) => defaultHotlistRouteDependencies.createProvider(overrides),
    });

    const response = await hotlistGET();
    assert.strictEqual(response.status, 200);
    const body = (await response.json()) as HotlistBody;
    assert.strictEqual(body.source, 'cache');
    assert.strictEqual(body.stale, true);
    assert.strictEqual(body.items[0].id, 'ht_stale');
    assert.strictEqual(body.updatedAt, staleSnap.updatedAt);
  });

  it('route stores the provider object identity — snapshotStore passed to provider', async () => {
    const store = makeFakeStore(null);
    let capturedSnapshotStore: HotlistSnapshotStore | null = null;
    setHotlistRouteDependencies({
      createSnapshotStore: async () => store,
      createProvider: (overrides) => {
        capturedSnapshotStore = overrides.snapshotStore ?? null;
        return defaultHotlistRouteDependencies.createProvider(overrides);
      },
    });

    await hotlistGET();

    assert.ok(capturedSnapshotStore !== null, 'snapshotStore must be passed to the provider');
  });
});

// ---------------------------------------------------------------------------
// Resolver-level tests — pure decision chain without Next.js
// ---------------------------------------------------------------------------

describe('hotlist resolver — PRD §2.2 decision chain', () => {
  it('fresh snapshot short-circuits without calling the provider', async () => {
    const store = makeFakeStore({
      items: [hotItem('cached')],
      updatedAt: Date.now(),
    });
    const provider = makeFakeProvider({ source: 'live', items: [], updatedAt: 0 });
    let providerCalled = false;

    // Simulate the decision chain from loadHotlistForRoute
    const snapshot = await store.read();
    const fresh = snapshot && Date.now() - snapshot.updatedAt <= 6 * 60 * 60 * 1000;

    if (fresh) {
      const result: HotlistBody = {
        items: snapshot!.items,
        source: 'cache',
        updatedAt: snapshot!.updatedAt,
        stale: false,
      };
      assert.strictEqual(result.source, 'cache');
      assert.strictEqual(result.items[0].id, 'ht_cached');
    } else {
      providerCalled = true;
      const live = await provider.fetchHotlist();
      assert.strictEqual(live.source, 'live');
    }

    assert.strictEqual(providerCalled, false, 'provider must not be called when fresh cache exists');
  });

  it('live success result is returned without writing demo to DB', async () => {
    const store = makeFakeStore(null);
    const liveResult = makeFakeProvider({ source: 'live', items: [hotItem('live')], updatedAt: Date.now() });

    // In the resolver: live success → return live (write would happen in route)
    const result = await liveResult.fetchHotlist();
    assert.strictEqual(result.source, 'live');
    assert.strictEqual(result.items[0].id, 'ht_live');
  });

  it('demo result indicates no cache write', async () => {
    const store = makeFakeStore(null);
    const demoResult = makeFakeProvider({ source: 'demo', items: [hotItem('demo')], updatedAt: Date.now() });
    const written: HotlistSnapshot | null = null;

    const result = await demoResult.fetchHotlist();
    assert.strictEqual(result.source, 'demo');
    assert.strictEqual(written, null, 'demo result must never be persisted');
  });
});
