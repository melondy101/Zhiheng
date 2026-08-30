import { describe, it } from 'node:test';
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
import { FIXTURE_QUESTION, type Session } from '../../src/lib/providers';

// Minimal localStorage mock for Node.js environment
type Store = Record<string, string>;
const makeLS = (store: Store) => ({
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => { store[k] = v; },
  removeItem: (k: string) => { delete store[k]; },
  clear: () => { Object.keys(store).forEach(k => delete store[k]); },
  get length() { return Object.keys(store).length; },
  key(i: number) { return Object.keys(store)[i] ?? null; },
});

const makeProvider = (): { provider: BrowserStorageProvider; store: Store } => {
  const store: Store = {};
  Object.defineProperty(globalThis, 'localStorage', { value: makeLS(store), configurable: true });
  return { provider: new BrowserStorageProvider(), store };
};

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

// ---- FixtureRetrievalProvider contract ----
describe('FixtureRetrievalProvider', () => {
  it('generates a report with all required fields', async () => {
    const provider = new FixtureRetrievalProvider();
    const report = await provider.generateReport('AI创造力?');
    assert.ok(report.title);
    assert.ok(report.knowledgePoints.length > 0);
    assert.ok(report.content.length > 0);
    assert.ok(report.viewpoints.length > 0);
  });

  it('report has no references or graph fields', async () => {
    const provider = new FixtureRetrievalProvider();
    const report = await provider.generateReport('test');
    assert.ok(!('references' in report));
    assert.ok(!('graph' in report));
  });

  it('is deterministic: same input => same output', async () => {
    const provider = new FixtureRetrievalProvider();
    const a = await provider.generateReport('q');
    const b = await provider.generateReport('q');
    assert.deepStrictEqual(a, b);
  });
});

// ---- FixtureLLMProvider contract ----
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

// ---- BrowserStorageProvider contract ----
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
    assert.strictEqual(loaded.id, 's1');
    assert.strictEqual(loaded.question, 'test?');
  });

  it('returns null for missing session', async () => {
    const { provider } = makeProvider();
    assert.strictEqual(await provider.loadSession('nope'), null);
  });

  it('lists sessions sorted by updatedAt desc', async () => {
    const { provider } = makeProvider();
    await provider.saveSession(makeSession('old', 100));
    await provider.saveSession(makeSession('new', 200));
    const list = await provider.listSessions();
    assert.strictEqual(list[0]!.id, 'new');
    assert.strictEqual(list[1]!.id, 'old');
  });

  it('deletes a session', async () => {
    const { provider } = makeProvider();
    await provider.saveSession(makeSession('del', 1));
    await provider.deleteSession('del');
    assert.strictEqual(await provider.loadSession('del'), null);
  });
});

// ---- AnonymousIdentityProvider contract ----
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

// ---- buildResultCard provenance contract ----
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

// ---- HotlistProvider contract ----
const makeHotlistProvider = (store?: Record<string, string>): { provider: HotlistProvider; ls: Store } => {
  const ls: Store = store ?? {};
  Object.defineProperty(globalThis, 'localStorage', { value: makeLS(ls), configurable: true });
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
    // First call populates cache
    const { provider: p1 } = makeHotlistProvider(store);
    const first = await p1.fetchHotlist();
    assert.strictEqual(first.source, 'demo');

    // Second call should hit cache
    const { provider: p2 } = makeHotlistProvider(store);
    const second = await p2.fetchHotlist();
    assert.strictEqual(second.source, 'cache');
    assert.deepStrictEqual(second.items, first.items);
  });

  it('returns stale cache with stale:true instead of falling back to demo', async () => {
    const store: Record<string, string> = {};
    const { provider: p1 } = makeHotlistProvider(store);
    const first = await p1.fetchHotlist();
    assert.strictEqual(first.source, 'demo');

    // Push timestamp back beyond TTL
    const stale = { ...first, updatedAt: Date.now() - 86_400_001 };
    store['zhiyan_hotlist_cache'] = JSON.stringify(stale);

    const { provider: p2 } = makeHotlistProvider(store);
    const second = await p2.fetchHotlist();
    // Stale cache is preserved, not replaced with demo
    assert.strictEqual(second.source, 'cache');
    assert.strictEqual(second.stale, true);
    assert.deepStrictEqual(second.items, first.items);
  });

  it('returns stale cache with stale flag', async () => {
    const store: Record<string, string> = {};
    const { provider: p1 } = makeHotlistProvider(store);
    const first = await p1.fetchHotlist();
    assert.strictEqual(first.source, 'demo');

    // Write cache with an old timestamp (no stale flag in stored JSON)
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
