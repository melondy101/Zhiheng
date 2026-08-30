// Ticket #15: API integration tests for the single interrogation orchestration
// endpoint. The route handler is exercised directly with real Request objects
// against the real serverStorage singleton, so every assertion below covers
// orchestration + persistence exactly as the Next.js route runs it.
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { POST } from '../../src/app/api/interrogate/route';
import { serverStorage } from '../../src/lib/server-providers';
import { STRATEGIES } from '../../src/lib/strategy-engine';
import type {
  InterrogateResponseBody,
  Message,
  Session,
  Viewpoint,
} from '../../src/lib/providers';

const VIEWPOINT: Viewpoint = {
  id: 'v1',
  text: '我认为AI会增强而非取代创造力',
  source: 'ai_suggested_and_selected',
};

const ANSWER_ROUND = (round: number) => `第 ${round} 轮的实质性回答，包含具体数据与例子。`;

let sessionCounter = 0;

function seedSession(overrides: Partial<Session> = {}): Session {
  sessionCounter += 1;
  const session: Session = {
    id: `s_test_${sessionCounter}`,
    question: '测试问题：这个观点的依据是什么？',
    initialOpinion: '我的初始看法',
    report: null,
    selectedViewpoint: null,
    messages: [],
    resultCard: null,
    completed: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
  return session;
}

interface HttpResult {
  status: number;
  body: Partial<InterrogateResponseBody> & { error?: string };
}

async function postInterrogate(payload: Record<string, unknown>): Promise<HttpResult> {
  const request = new Request('http://localhost:3000/api/interrogate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const response = await POST(request);
  const body = (await response.json()) as Partial<InterrogateResponseBody> & {
    error?: string;
  };
  return { status: response.status, body };
}

/** Drive a seeded session through "start" so round 1 is pending. */
async function startSession(session: Session): Promise<InterrogateResponseBody> {
  const { body } = await postInterrogate({
    sessionId: session.id,
    action: 'start',
    viewpoint: VIEWPOINT,
  });
  assert.strictEqual(body.round, 1, 'start must plan round 1');
  return body as InterrogateResponseBody;
}

/** Answer `count` rounds, returning the last response. */
async function answerRounds(
  session: Session,
  count: number
): Promise<InterrogateResponseBody> {
  let last: InterrogateResponseBody | null = null;
  for (let i = 1; i <= count; i++) {
    const { status, body } = await postInterrogate({
      sessionId: session.id,
      action: 'answer',
      answer: ANSWER_ROUND(i),
    });
    assert.strictEqual(status, 200, `answer ${i} must succeed`);
    last = body as InterrogateResponseBody;
  }
  assert.ok(last, 'at least one answer expected');
  return last;
}

const userTexts = (messages: Message[]): string[] =>
  messages.filter((m) => m.role === 'user').map((m) => m.text);

describe('POST /api/interrogate: request contract', () => {
  it('returns 400 when sessionId is missing', async () => {
    const result = await postInterrogate({ action: 'start', viewpoint: VIEWPOINT });
    assert.strictEqual(result.status, 400);
    assert.ok(result.body.error);
  });

  it('returns 400 for an unknown action', async () => {
    const session = seedSession();
    await serverStorage.saveSession(session);
    const result = await postInterrogate({ sessionId: session.id, action: 'bogus' });
    assert.strictEqual(result.status, 400);
  });

  it('returns 404 when the session is unknown and no snapshot is provided', async () => {
    const result = await postInterrogate({ sessionId: 's_missing', action: 'start', viewpoint: VIEWPOINT });
    assert.strictEqual(result.status, 404);
    assert.ok(result.body.error);
  });

  it('returns 400 when answering with no pending question', async () => {
    const session = seedSession();
    await serverStorage.saveSession(session);
    const result = await postInterrogate({ sessionId: session.id, action: 'answer', answer: '任意回答' });
    assert.strictEqual(result.status, 400);
  });

  it('returns 400 when starting without a viewpoint', async () => {
    const session = seedSession();
    await serverStorage.saveSession(session);
    const result = await postInterrogate({ sessionId: session.id, action: 'start' });
    assert.strictEqual(result.status, 400);
  });

  it('returns 409 for continue without a pending checkpoint decision', async () => {
    const session = seedSession();
    await serverStorage.saveSession(session);
    const result = await postInterrogate({ sessionId: session.id, action: 'continue' });
    assert.strictEqual(result.status, 409);
  });

  it('returns 409 when the session is already completed', async () => {
    const session = seedSession({ completed: true, resultCard: null });
    await serverStorage.saveSession(session);
    const result = await postInterrogate({
      sessionId: session.id,
      action: 'start',
      viewpoint: VIEWPOINT,
    });
    assert.strictEqual(result.status, 409);
  });
});

describe('POST /api/interrogate: five-round strategy contract (#15)', () => {
  it('plans rounds 1..5 in the fixed M1→M2→M4→M6→M5 order', async () => {
    const session = seedSession();
    await serverStorage.saveSession(session);

    const started = await startSession(session);
    assert.strictEqual(started.strategy, 'M1_evidence');
    assert.ok(started.question && started.question.length > 0);
    assert.strictEqual(started.checkpoint, false);
    assert.strictEqual(started.usedFallback, false);
    assert.strictEqual(started.completed, false);

    const expected = ['M2_premise', 'M4_steelman', 'M6_reversal', 'M5_restate'];
    for (let i = 1; i <= 4; i++) {
      const res = await postInterrogate({
        sessionId: session.id,
        action: 'answer',
        answer: ANSWER_ROUND(i),
      });
      assert.strictEqual(res.status, 200, `answer ${i} must succeed`);
      const body = res.body as InterrogateResponseBody;
      assert.strictEqual(body.round, i + 1, `after answer ${i} the next round must be ${i + 1}`);
      assert.strictEqual(body.strategy, expected[i - 1], `round ${i + 1} strategy`);
      assert.ok(body.question && body.question.length > 0);
      assert.strictEqual(body.checkpoint, false);
    }
  });

  it('returns the checkpoint decision after the 5th answer and persists it', async () => {
    const session = seedSession();
    await serverStorage.saveSession(session);
    await startSession(session);
    await answerRounds(session, 4);

    const fifth = await postInterrogate({
      sessionId: session.id,
      action: 'answer',
      answer: ANSWER_ROUND(5),
    });
    assert.strictEqual(fifth.status, 200);
    assert.strictEqual(fifth.body.checkpoint, true, 'checkpoint must follow the 5th answer');
    assert.strictEqual(fifth.body.round, 5);
    assert.strictEqual(fifth.body.question, null);
    assert.strictEqual(fifth.body.completed, false, 'checkpoint is not completion');

    const stored = await serverStorage.loadSession(session.id);
    assert.ok(stored);
    assert.strictEqual(stored.interrogation?.pendingCheckpoint, true);
    assert.strictEqual(stored.interrogation?.round, 5);
    assert.strictEqual(stored.interrogation?.strategy, 'M5_restate');
    assert.strictEqual(stored.interrogation?.assistantQuestion, null);
    // All five answers are persisted; the session is NOT completed by the API.
    assert.strictEqual(userTexts(stored.messages).length, 5);
    assert.strictEqual(stored.completed, false);
  });

  it('continue after the checkpoint plans round 6 with M1 and clears the gate', async () => {
    const session = seedSession();
    await serverStorage.saveSession(session);
    await startSession(session);
    await answerRounds(session, 5);

    const res = await postInterrogate({ sessionId: session.id, action: 'continue' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.round, 6);
    assert.strictEqual(res.body.strategy, 'M1_evidence');
    assert.ok(res.body.question && res.body.question.includes('第 6 轮'));
    assert.strictEqual(res.body.checkpoint, false);

    const stored = await serverStorage.loadSession(session.id);
    assert.ok(stored);
    assert.strictEqual(stored.interrogation?.pendingCheckpoint, false);
    assert.strictEqual(stored.interrogation?.round, 6);
  });

  it('start is idempotent once a question or checkpoint is pending', async () => {
    const session = seedSession();
    await serverStorage.saveSession(session);
    await startSession(session);
    await answerRounds(session, 2);

    const again = await postInterrogate({
      sessionId: session.id,
      action: 'start',
      viewpoint: VIEWPOINT,
    });
    assert.strictEqual(again.status, 200);
    assert.strictEqual(again.body.round, 3, 'must not replan or reset the round');
    assert.strictEqual(again.body.strategy, 'M4_steelman');
  });
});

describe('POST /api/interrogate: session reload consistency (#15)', () => {
  it('loadSession state matches the state the client received', async () => {
    const session = seedSession();
    await serverStorage.saveSession(session);
    await startSession(session);
    const last = await answerRounds(session, 2);

    const reloaded = await serverStorage.loadSession(session.id);
    assert.ok(reloaded);
    assert.strictEqual(reloaded.interrogation?.round, last.round);
    assert.strictEqual(reloaded.interrogation?.strategy, last.strategy);
    assert.strictEqual(reloaded.interrogation?.assistantQuestion, last.question);
    assert.strictEqual(reloaded.interrogation?.pendingCheckpoint, last.checkpoint);
    assert.strictEqual(reloaded.interrogation?.usedFallback, last.usedFallback);
    assert.strictEqual(reloaded.interrogation?.uncertainStreak, last.uncertainStreak);
    assert.deepStrictEqual(reloaded.messages, last.session.messages);
  });
});

describe('POST /api/interrogate: hydration from the persisted client snapshot (#15)', () => {
  it('resumes the exact round after serverStorage loses the session (server restart)', async () => {
    const session = seedSession();
    await serverStorage.saveSession(session);
    await startSession(session);
    const last = await answerRounds(session, 2);
    assert.strictEqual(last.round, 3);

    // Simulate a dev-server restart: the in-memory store is wiped. The client
    // re-postits its persisted snapshot; the API must adopt it and continue.
    await serverStorage.deleteSession(session.id);
    const res = await postInterrogate({
      sessionId: session.id,
      action: 'answer',
      answer: ANSWER_ROUND(3),
      session: last.session,
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.round, 4);
    assert.strictEqual(res.body.strategy, 'M6_reversal');
    assert.deepStrictEqual(userTexts(res.body.session!.messages), [
      ANSWER_ROUND(1),
      ANSWER_ROUND(2),
      ANSWER_ROUND(3),
    ]);

    const stored = await serverStorage.loadSession(session.id);
    assert.ok(stored, 'hydrated session must be persisted again');
    assert.strictEqual(userTexts(stored.messages).length, 3);
    assert.strictEqual(stored.interrogation?.round, 4);
  });

  it('checkpoint continue survives a restart: round 6, not a checkpoint replay (#14 P2)', async () => {
    const session = seedSession();
    await serverStorage.saveSession(session);
    await startSession(session);
    await answerRounds(session, 5);

    const checkpointState = await serverStorage.loadSession(session.id);
    assert.ok(checkpointState);
    assert.strictEqual(checkpointState.interrogation?.pendingCheckpoint, true);

    await serverStorage.deleteSession(session.id);
    const res = await postInterrogate({
      sessionId: session.id,
      action: 'continue',
      session: checkpointState,
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.round, 6);
    assert.strictEqual(res.body.checkpoint, false, 'continue must clear the checkpoint');
    assert.ok(res.body.question && res.body.question.length > 0);
  });
});

describe('POST /api/interrogate: usedFallback marking (#15)', () => {
  it('marks usedFallback and persists the strategy template when the LLM fails', async () => {
    const { llmProvider } = await import('../../src/lib/server-providers');
    const original = llmProvider.generateStrategyQuestion.bind(llmProvider);
    llmProvider.generateStrategyQuestion = async () => {
      throw new Error('LLM down');
    };
    try {
      const session = seedSession();
      await serverStorage.saveSession(session);
      const res = await postInterrogate({
        sessionId: session.id,
        action: 'start',
        viewpoint: VIEWPOINT,
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.usedFallback, true);
      const template = STRATEGIES.M1_evidence.fallbackTemplate(session);
      assert.strictEqual(res.body.question, template);

      const stored = await serverStorage.loadSession(session.id);
      assert.ok(stored);
      assert.strictEqual(stored.interrogation?.usedFallback, true);
      assert.strictEqual(stored.interrogation?.assistantQuestion, template);
    } finally {
      llmProvider.generateStrategyQuestion = original;
    }
  });
});

describe('POST /api/interrogate: uncertain streak persistence (#10 semantics preserved)', () => {
  it('counts consecutive uncertain answers, returns hints, and persists the streak', async () => {
    const session = seedSession();
    await serverStorage.saveSession(session);
    await startSession(session);

    const first = await postInterrogate({
      sessionId: session.id,
      action: 'answer',
      answer: '不知道',
    });
    assert.strictEqual(first.status, 200);
    assert.strictEqual(first.body.uncertainStreak, 1);
    assert.ok(first.body.hint && first.body.hint.message.includes('缩小'));
    assert.strictEqual(first.body.round, 2, 'a streak-1 answer still advances the round');

    const second = await postInterrogate({
      sessionId: session.id,
      action: 'answer',
      answer: '我不清楚',
    });
    assert.strictEqual(second.status, 200);
    assert.strictEqual(second.body.uncertainStreak, 2);
    assert.ok(second.body.hint && Array.isArray(second.body.hint.hint));
    assert.strictEqual(second.body.hint?.hint?.length, 2);

    const storedMid = await serverStorage.loadSession(session.id);
    assert.ok(storedMid);
    assert.strictEqual(storedMid.interrogation?.uncertainStreak, 2);

    const third = await postInterrogate({
      sessionId: session.id,
      action: 'answer',
      answer: '不确定',
    });
    assert.strictEqual(third.status, 200);
    assert.strictEqual(third.body.suggestComplete, true);
    assert.strictEqual(third.body.uncertainStreak, 3);
    assert.ok(third.body.hint && third.body.hint.message.includes('建议结束'));

    // #10 observable behavior: the third uncertain answer is NOT recorded,
    // and completion is not performed by the API (the client owns the card).
    const stored = await serverStorage.loadSession(session.id);
    assert.ok(stored);
    assert.deepStrictEqual(userTexts(stored.messages), [
      '不知道',
      '我不清楚',
    ]);
    assert.strictEqual(stored.interrogation?.uncertainStreak, 3);
    assert.strictEqual(stored.completed, false);
  });

  it('resets the streak when a substantive answer arrives', async () => {
    const session = seedSession();
    await serverStorage.saveSession(session);
    await startSession(session);

    await postInterrogate({ sessionId: session.id, action: 'answer', answer: '不知道' });
    const res = await postInterrogate({
      sessionId: session.id,
      action: 'answer',
      answer: '我认为AI会增强而非取代创造力，因为摄影术的例子说明了工具催生新表达。',
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.uncertainStreak, 0);
    assert.strictEqual(res.body.hint, null);
    assert.strictEqual(res.body.round, 3);
  });
});
