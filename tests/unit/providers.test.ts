import { describe, it } from 'node:test';
import assert from 'node:assert';
import { DemoLLMProvider, DemoRetrievalProvider, isCheckpoint, MemoryStorageProvider, buildResultCard } from '../../src/lib/demo-providers';

// ---- Strategy order contract ----
describe('Strategy sequencing contract', () => {
  it('M1, M2, M4, M6 cycle deterministically', async () => {
    const provider = new DemoLLMProvider();
    const expected = ['m1', 'm2', 'm4', 'm6', 'm1', 'm2', 'm4', 'm6'];
    const actual: string[] = [];
    let messages: Array<{ id: string; role: string; text: string }> = [];

    for (let i = 0; i < 8; i++) {
      const session = { id: 'test', messages, question: 'test' } as any;
      const response = await provider.generateQuestion(session);
      actual.push(response.strategyId);
      messages = [...messages, { id: `a${i}`, role: 'assistant', text: response.question }];
      messages = [...messages, { id: `u${i}`, role: 'user', text: `answer ${i}` }];
    }

    assert.deepStrictEqual(actual, expected);
  });
});

// ---- Hot list contract ----
describe('HotListProvider contract', () => {
  it('returns at most 10 items with update time', async () => {
    const provider = new DemoRetrievalProvider();
    const data = await provider.getHotList();
    assert.ok(data.items.length <= 10, `Expected <= 10 items, got ${data.items.length}`);
    assert.ok(data.updatedAt.length > 0);
    assert.strictEqual(data.source, 'demo');
  });
});

// ---- isCheckpoint contract ----
describe('isCheckpoint contract', () => {
  it('turn 5 is a checkpoint', () => {
    assert.strictEqual(isCheckpoint(5), true);
  });

  it('turn 6 is not a checkpoint', () => {
    assert.strictEqual(isCheckpoint(6), false);
  });

  it('turn 8 is a checkpoint', () => {
    assert.strictEqual(isCheckpoint(8), true);
  });

  it('turn 11 is a checkpoint', () => {
    assert.strictEqual(isCheckpoint(11), true);
  });
});

// ---- MemoryStorageProvider contract ----
describe('MemoryStorageProvider contract', () => {
  it('saves and loads roundtrip', async () => {
    const provider = new MemoryStorageProvider();
    const session = {
      id: 's1', question: 'test?', report: null,
      initialOpinion: null, selectedViewpoint: null,
      messages: [], resultCard: null, completed: false,
      createdAt: Date.now(), updatedAt: Date.now(),
    };
    await provider.saveSession(session as any);
    const loaded = await provider.loadSession('s1');
    assert.ok(loaded !== null);
    assert.strictEqual(loaded?.id, 's1');
    assert.strictEqual(loaded?.question, 'test?');
  });

  it('returns null for nonexistent session', async () => {
    const provider = new MemoryStorageProvider();
    const loaded = await provider.loadSession('nonexistent');
    assert.strictEqual(loaded, null);
  });

  it('lists sessions sorted by updatedAt desc', async () => {
    const provider = new MemoryStorageProvider();
    await provider.saveSession({ id: 'old', question: 'old', updatedAt: 100 } as any);
    await provider.saveSession({ id: 'new', question: 'new', updatedAt: 200 } as any);
    const list = await provider.listSessions();
    assert.strictEqual(list[0]?.id, 'new');
    assert.strictEqual(list[1]?.id, 'old');
  });

  it('deletes a session', async () => {
    const provider = new MemoryStorageProvider();
    await provider.saveSession({ id: 'del', question: 'x', updatedAt: Date.now() } as any);
    await provider.deleteSession('del');
    const loaded = await provider.loadSession('del');
    assert.strictEqual(loaded, null);
  });
});

// ---- Result card provenance contract ----
describe('ResultCard provenance contract', () => {
  it('initialStance source is user_authored', () => {
    const session = {
      id: 's1', question: 'q', messages: [{ id: 'u1', role: 'user', text: 'hello' }],
      initialOpinion: 'I think limited',
    } as any;
    const card = buildResultCard(session);
    assert.strictEqual(card.initialStance?.source, 'user_authored');
  });

  it('selectedViewpoint source is ai_suggested_user_selected', () => {
    const session = {
      id: 's1', question: 'q', messages: [{ id: 'u1', role: 'user', text: 'vp' }],
      initialOpinion: null,
      selectedViewpoint: { id: 'v1', text: 'selected', source: 'ai_authored' as const },
    } as any;
    const card = buildResultCard(session);
    assert.strictEqual(card.selectedStartingStance?.source, 'ai_suggested_user_selected');
  });

  it('assistant messages are never attributed to user', () => {
    const session = {
      id: 's1', question: 'q', messages: [
        { id: 'u1', role: 'user', text: 'answer' },
        { id: 'a1', role: 'assistant', text: 'question?' },
        { id: 'u2', role: 'user', text: 'reply' },
      ],
      initialOpinion: null,
      selectedViewpoint: null,
    } as any;
    const card = buildResultCard(session);
    assert.ok(!card.messageIds.includes('a1'));
    assert.ok(card.messageIds.includes('u1'));
    assert.ok(card.messageIds.includes('u2'));
  });
});
