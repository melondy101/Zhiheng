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
