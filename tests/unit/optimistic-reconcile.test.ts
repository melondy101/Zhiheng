// Ticket #26/T3: unit tests for the optimistic message reconciliation
// behaviour exposed through handleInterrogate. The reconcileOptimistic
// function is private — these tests exercise it through the public API.

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { handleInterrogate } from '../../src/lib/interrogation-orchestrator';
import type { Message, Session, StorageProvider } from '../../src/lib/providers';

function makeSession(messages: Message[] = [], overrides: Partial<Session> = {}): Session {
  return {
    id: 's_opt',
    question: 'Test',
    initialOpinion: null,
    report: { question: 'Test', title: 'Test', knowledgePoints: [], content: '', viewpoints: [], references: [], citations: {} },
    selectedViewpoint: { id: 'vp_1', text: 'Test', source: 'user_authored', selectedAt: Date.now() },
    messages,
    interrogation: {
      round: 1,
      strategy: 'M1_evidence',
      assistantQuestion: 'Q1?',
      usedFallback: false,
      pendingCheckpoint: false,
      uncertainStreak: 0,
    },
    completed: false,
    resultCard: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    reportSourceState: undefined,
    ...overrides,
  };
}

function fakeStorage(session: Session): StorageProvider {
  return {
    async loadSession() { return session; },
    async saveSession(s: Session) { Object.assign(session, s); },
    async listSessions() { return []; },
    async deleteSession() {},
  } as StorageProvider;
}

describe('reconcileOptimistic — server-side (#26/T3)', () => {
  it('server replaces a pending optimistic message with a real sent one', async () => {
    const session = makeSession([
      { id: 'opt_abc', role: 'user', text: 'answer', timestamp: Date.now(), status: 'pending' },
    ]);

    const result = await handleInterrogate({
      sessionId: session.id,
      action: 'answer',
      answer: 'new answer',
      optimisticId: 'opt_abc',
      storage: fakeStorage(session),
      generateQuestion: async () => 'next question?',
    });

    assert.ok(result.ok);
    // After reconciliation the optimistic id is gone (replaced by a real id).
    const hasOptimistic = result.body.session.messages.some(m => m.id === 'opt_abc');
    assert.ok(!hasOptimistic, 'optimistic id replaced by a real one');
    // The original text and a new real message are both present.
    assert.ok(
      result.body.session.messages.some(m => m.text === 'answer'),
      'optimistic text preserved'
    );
  });

  it('server ignores optimisticId when no pending message matches', async () => {
    const session = makeSession([
      { id: 'real_1', role: 'user', text: 'existing', timestamp: Date.now(), status: 'sent' },
    ]);

    const result = await handleInterrogate({
      sessionId: session.id,
      action: 'answer',
      answer: 'new answer',
      optimisticId: 'nonexistent',
      storage: fakeStorage(session),
      generateQuestion: async () => 'next question?',
    });

    assert.ok(result.ok);
    // After the answer the server plans the next round and persists the
    // assistant question as an assistant message (#26/T3).
    assert.strictEqual(result.body.session.messages.length, 3);
    assert.strictEqual(result.body.session.messages[0].id, 'real_1');
    assert.strictEqual(result.body.session.messages[2].role, 'assistant');
  });

  it('null optimisticId is a no-op', async () => {
    const session = makeSession();

    const result = await handleInterrogate({
      sessionId: session.id,
      action: 'answer',
      answer: 'test',
      optimisticId: null,
      storage: fakeStorage(session),
      generateQuestion: async () => 'next question?',
    });

    assert.ok(result.ok);
    assert.ok(result.body.session.messages.some(m => m.text === 'test'));
  });
});
