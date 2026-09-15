// Ticket #15: unit tests for the pure parts of the interrogation orchestrator
// (state derivation and round/streak math). The full storage-backed behavior
// is covered by tests/integration/interrogate-api.test.ts.
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  answeredRounds,
  evaluateStreak,
  interrogationStateOf,
  handleInterrogate,
} from '../../src/lib/interrogation-orchestrator';
import type {
  InterrogationState,
  Message,
  Session,
  StorageProvider,
} from '../../src/lib/providers';

function makeSession(userCount: number, assistantCount = 0): Session {
  const messages: Message[] = [];
  for (let i = 0; i < Math.max(userCount, assistantCount); i++) {
    if (i < assistantCount) {
      messages.push({ id: `a${i}`, role: 'assistant', text: `q ${i}`, timestamp: i });
    }
    if (i < userCount) {
      messages.push({ id: `u${i}`, role: 'user', text: `ans ${i}`, timestamp: i });
    }
  }
  return {
    id: 's',
    question: '测试问题',
    initialOpinion: null,
    report: null,
    selectedViewpoint: null,
    messages,
    resultCard: null,
    completed: false,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('answeredRounds (#15 round derivation)', () => {
  it('counts zero for a fresh session', () => {
    assert.strictEqual(answeredRounds(makeSession(0)), 0);
  });

  it('counts only user messages', () => {
    assert.strictEqual(answeredRounds(makeSession(3, 2)), 3);
  });
});

describe('interrogationStateOf (#15 persisted-state derivation)', () => {
  it('returns zero state for a session never interrogated', () => {
    const state = interrogationStateOf(makeSession(0));
    assert.deepStrictEqual(state, {
      round: 0,
      strategy: null,
      assistantQuestion: null,
      usedFallback: false,
      pendingCheckpoint: false,
      uncertainStreak: 0,
    });
  });

  it('derives a mid-session legacy state (2 answers, no checkpoint)', () => {
    const state = interrogationStateOf(makeSession(2));
    assert.strictEqual(state.round, 2);
    assert.strictEqual(state.strategy, null);
    assert.strictEqual(state.assistantQuestion, null);
    assert.strictEqual(state.pendingCheckpoint, false);
    assert.strictEqual(state.uncertainStreak, 0);
  });

  it('derives a pending checkpoint for a legacy session interrupted after round 5', () => {
    const state = interrogationStateOf(makeSession(5));
    assert.strictEqual(state.round, 5);
    assert.strictEqual(state.pendingCheckpoint, true);
  });

  it('returns the persisted interrogation state verbatim when present', () => {
    const persisted: InterrogationState = {
      round: 4,
      strategy: 'M6_reversal',
      assistantQuestion: '当前问题',
      usedFallback: true,
      pendingCheckpoint: false,
      uncertainStreak: 1,
    };
    const session = makeSession(3);
    session.interrogation = persisted;
    const state = interrogationStateOf(session);
    assert.strictEqual(state, persisted);
  });
});

describe('evaluateStreak (#15 streak math, #10 semantics)', () => {
  it('a substantive answer resets the streak to 0', () => {
    assert.strictEqual(evaluateStreak(2, '我认为AI会增强而非取代创造力'), 0);
    assert.strictEqual(evaluateStreak(0, '一个足够长的实质性回答'), 0);
  });

  it('an uncertain answer increments the streak', () => {
    assert.strictEqual(evaluateStreak(0, '不知道'), 1);
    assert.strictEqual(evaluateStreak(1, '我不清楚'), 2);
  });

  it('reaches the auto-complete boundary at 3 consecutive uncertain answers', () => {
    assert.strictEqual(evaluateStreak(2, '不确定'), 3);
  });
});

describe('handleInterrogate: retry_question action', () => {
  it('replaces a template question with a fresh question without advancing the round', async () => {
    const session = makeSession(0, 1);
    session.interrogation = {
      round: 1,
      strategy: 'M1_evidence',
      assistantQuestion: '【策略模板降级】请举一个数据或例子？',
      usedFallback: true,
      fallbackReason: 'question_validation_failed',
      pendingCheckpoint: false,
      uncertainStreak: 0,
    };
    session.messages[0] = { id: 'a0', role: 'assistant', text: session.interrogation.assistantQuestion!, timestamp: 0 };
    const { storage, snapshot } = makeStorage(session);

    const result = await handleInterrogate({
      sessionId: session.id,
      action: 'retry_question',
      storage,
      generateQuestion: async () => '新的 AI 问题：你能举一个具体例子吗？',
    });

    assert.ok(result.ok);
    assert.strictEqual(result.body.round, 1);
    assert.strictEqual(result.body.question, '新的 AI 问题：你能举一个具体例子吗？');
    assert.strictEqual(result.body.usedFallback, false);
    assert.strictEqual(result.body.session.messages.filter((message) => message.role === 'assistant').length, 1);
    assert.strictEqual(result.body.session.messages[0]?.text, result.body.question);
    assert.strictEqual(snapshot()?.interrogation?.assistantQuestion, result.body.question);
  });
});

// ---------------------------------------------------------------------------
// Ticket #17: the explicit complete action. A failed completion must never
// corrupt the stored session.
// ---------------------------------------------------------------------------

function completeFixtureSession(): Session {
  const session = makeSession(1);
  session.id = 's_complete';
  return session;
}

/** In-memory StorageProvider whose saveSession can be made to fail. */
function makeStorage(initial: Session, failSave = false): { storage: StorageProvider; snapshot: () => Session | null } {
  let store: Session | null = { ...initial };
  const storage: StorageProvider = {
    async loadSession() {
      return store ? { ...store } : null;
    },
    async saveSession(next: Session) {
      if (failSave) throw new Error('disk full');
      store = { ...next };
    },
    async listSessions() {
      return store ? [store] : [];
    },
    async deleteSession() {
      store = null;
    },
  };
  return { storage, snapshot: () => (store ? { ...store } : null) };
}

const noopGenerate = async () => '问题文本';

describe('handleInterrogate: complete action (#17)', () => {
  it('marks the session completed and persists the result card', async () => {
    const session = completeFixtureSession();
    const { storage } = makeStorage(session);
    const result = await handleInterrogate({
      sessionId: session.id,
      action: 'complete',
      storage,
      generateQuestion: noopGenerate,
    });
    assert.ok(result.ok);
    assert.strictEqual(result.body.completed, true);
    assert.ok(result.body.session.resultCard);
    assert.strictEqual(result.body.session.resultCard!.finalPosition, 'ans 0');
  });

  it('returns 500 and leaves the stored session untouched when persistence fails', async () => {
    const session = completeFixtureSession();
    const { storage, snapshot } = makeStorage(session, true);
    const result = await handleInterrogate({
      sessionId: session.id,
      action: 'complete',
      storage,
      generateQuestion: noopGenerate,
    });
    assert.ok(!result.ok);
    assert.strictEqual(result.ok ? 0 : result.status, 500);
    assert.ok(result.ok ? '' : result.error.includes('disk full'));
    // The stored session was not corrupted by the failed completion.
    const stored = snapshot();
    assert.ok(stored);
    assert.strictEqual(stored.completed, false);
    assert.strictEqual(stored.resultCard, null);
  });
});

// ---------------------------------------------------------------------------
// Result-card AI summary: best-effort, never blocks completion.
// ---------------------------------------------------------------------------

describe('handleInterrogate: complete action AI summary wiring', () => {
  it('stores resultCardAISummary when the summarizer resolves a valid summary', async () => {
    const session = completeFixtureSession();
    const { storage } = makeStorage(session);
    const result = await handleInterrogate({
      sessionId: session.id,
      action: 'complete',
      storage,
      generateQuestion: noopGenerate,
      summarizeUserPositions: async () => ({
        initial: null,
        final: { text: 'AI 总结的最终观点', sourceMessageIds: ['u0'] },
      }),
    });
    assert.ok(result.ok);
    assert.ok(result.body.session.resultCardAISummary);
    assert.strictEqual(result.body.session.resultCardAISummary!.final?.text, 'AI 总结的最终观点');
  });

  it('completes without resultCardAISummary when no summarizer is wired', async () => {
    const session = completeFixtureSession();
    const { storage } = makeStorage(session);
    const result = await handleInterrogate({
      sessionId: session.id,
      action: 'complete',
      storage,
      generateQuestion: noopGenerate,
    });
    assert.ok(result.ok);
    assert.strictEqual(result.body.session.resultCardAISummary, undefined);
  });

  it('completes without resultCardAISummary when the summarizer throws', async () => {
    const session = completeFixtureSession();
    const { storage } = makeStorage(session);
    const result = await handleInterrogate({
      sessionId: session.id,
      action: 'complete',
      storage,
      generateQuestion: noopGenerate,
      summarizeUserPositions: async () => {
        throw new Error('LLM timeout');
      },
    });
    assert.ok(result.ok);
    assert.strictEqual(result.body.completed, true);
    assert.ok(result.body.session.resultCard);
    assert.strictEqual(result.body.session.resultCardAISummary, undefined);
  });

  it('completes without resultCardAISummary when the summarizer resolves null', async () => {
    const session = completeFixtureSession();
    const { storage } = makeStorage(session);
    const result = await handleInterrogate({
      sessionId: session.id,
      action: 'complete',
      storage,
      generateQuestion: noopGenerate,
      summarizeUserPositions: async () => null,
    });
    assert.ok(result.ok);
    assert.strictEqual(result.body.session.resultCardAISummary, undefined);
  });
});

describe('handleInterrogate: clean assistant message composition without repetitive prefixes', () => {
  it('does not prepend repetitive template praise to assistant question on substantive answer', async () => {
    const modes: Array<'deep' | 'quick' | 'fun'> = ['deep', 'quick', 'fun'];

    for (const mode of modes) {
      const base = makeSession(0, 1);
      const session: Session = {
        ...base,
        id: `sess_clean_${mode}`,
        mode,
        character: mode === 'fun' ? 'relaxed_friend' : undefined,
        question: '人工智能是否会取代基础教育教师？',
        selectedViewpoint: {
          id: 'vp1',
          text: '基础教育阶段教师的情感连接不可替代',
          source: 'user_authored',
          selectedAt: Date.now(),
        },
        messages: [
          {
            id: 'm0',
            role: 'assistant',
            text: '针对教师的情感连接不可替代这一论点，核心依据是什么？',
            timestamp: Date.now() - 1000,
          },
        ],
        interrogation: {
          round: 1,
          strategy: 'M1_evidence',
          assistantQuestion: '针对教师的情感连接不可替代这一论点，核心依据是什么？',
          usedFallback: false,
          pendingCheckpoint: false,
          uncertainStreak: 0,
        },
      };

      const { storage } = makeStorage(session);
      const expectedQuestion = '如果机器能通过微表情识别提供更高频的情感反馈，这种连接是否依然独属于人类？';

      const result = await handleInterrogate({
        sessionId: session.id,
        action: 'answer',
        answer: '我认为教师具有机器不具备的同理心和临场体察能力。',
        storage,
        generateQuestion: async () => expectedQuestion,
      });

      assert.ok(result.ok, `Should succeed for mode ${mode}`);
      const lastMsg = result.body.session.messages[result.body.session.messages.length - 1];
      assert.strictEqual(lastMsg.role, 'assistant');
      assert.ok(!lastMsg.text.includes('我理解你的思考。你提到了'), `Mode ${mode} must not include repetitive praise prefix`);
      assert.ok(!lastMsg.text.includes('这很有价值'), `Mode ${mode} must not include value judgments`);
      assert.ok(lastMsg.text.includes(expectedQuestion) || lastMsg.text.includes('老铁') || lastMsg.text.includes('呢'), `Should contain the question`);
    }
  });
});

