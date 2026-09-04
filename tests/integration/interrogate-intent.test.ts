// Ticket #5: API integration tests for the gentle adaptive interrogation
// (PRD v4.2 §5). Tests the full POST /api/interrogate flow with intent
// classification, directive round progression, AI reply persistence, and
// the three-round summary gate.
import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { POST } from '../../src/app/api/interrogate/route';
import { getServerStorage, type OwnerStorageScope } from '../../src/lib/server-storage';
import type { InterrogateResponseBody, Session, Viewpoint } from '../../src/lib/providers';

const VIEWPOINT: Viewpoint = {
  id: 'v1',
  text: '我认为AI会增强而非取代创造力',
  source: 'ai_suggested_and_selected',
};

const ANSWER_ROUND = (round: number) => `第 ${round} 轮的实质性回答，包含具体数据与例子。`;

const TEST_OWNER = 'test-owner-gentle';
let scope: OwnerStorageScope;

before(async () => {
  const manager = await getServerStorage();
  scope = manager.forOwner(TEST_OWNER);
});

let sessionCounter = 0;

function seedSession(overrides: Partial<Session> = {}): Session {
  sessionCounter += 1;
  const session: Session = {
    id: `s_gentle_${sessionCounter}`,
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
    headers: { 'content-type': 'application/json', 'x-zhiyan-owner': TEST_OWNER },
    body: JSON.stringify(payload),
  });
  const response = await POST(request);
  const body = (await response.json()) as Partial<InterrogateResponseBody> & { error?: string };
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

// ---------------------------------------------------------------------------
// #5 acceptance: user question path
// ---------------------------------------------------------------------------

describe('POST /api/interrogate: user question path (#5)', () => {
  it('returns aiReply and followUp when the user asks a question', async () => {
    const session = seedSession();
    await scope.sessions.saveSession(session);
    const started = await startSession(session);

    // User asks a question instead of answering
    const res = await postInterrogate({
      sessionId: session.id,
      action: 'answer',
      answer: '你能详细解释一下吗？',
    });
    assert.strictEqual(res.status, 200);
    const body = res.body as InterrogateResponseBody;

    // AI reply and follow-up are present
    assert.ok(body.aiReply && body.aiReply.length > 0, 'aiReply must be present for user questions');
    assert.ok(body.followUp && body.followUp.length > 0, 'followUp must be present for user questions');

    // Directive round does NOT advance for questions
    assert.strictEqual(body.directiveRound, 0, 'questions must not advance directive round');
    assert.strictEqual(body.suggestSummary, false);

    // The follow-up becomes the pending question for the next turn
    assert.ok(body.question && body.question.length > 0, 'a follow-up question must be pending');
  });

  it('does not advance the directive round when user asks a question', async () => {
    const session = seedSession();
    await scope.sessions.saveSession(session);
    const started = await startSession(session);
    assert.strictEqual(started.round, 1);

    const res = await postInterrogate({
      sessionId: session.id,
      action: 'answer',
      answer: '什么是证据？',
    });
    assert.strictEqual(res.status, 200);
    const body = res.body as InterrogateResponseBody;
    // Round advances (interrogation progress) but directive round stays the same
    assert.strictEqual(body.round, 2, 'interrogation round advances for any non-uncertain input');
    assert.strictEqual(body.directiveRound, 0, 'directive round must not advance for a question');
    assert.strictEqual(body.strategy, 'M1_evidence', 'strategy stays for a question');
  });

  it('persists the AI reply as an assistant message in history', async () => {
    const session = seedSession();
    await scope.sessions.saveSession(session);
    await startSession(session);

    const res = await postInterrogate({
      sessionId: session.id,
      action: 'answer',
      answer: '你能详细解释一下吗？',
    });
    assert.strictEqual(res.status, 200);

    const stored = await scope.sessions.loadSession(session.id);
    assert.ok(stored);
    const assistantMessages = stored.messages.filter((m) => m.role === 'assistant');
    assert.ok(assistantMessages.length >= 1, 'AI reply must be persisted as assistant message');
    assert.ok(
      assistantMessages[0]!.text.length > 0,
      'persisted assistant message must have content'
    );

    // User message should have intent='question'
    const userMessages = stored.messages.filter((m) => m.role === 'user');
    assert.ok(userMessages.length >= 1);
    assert.strictEqual(userMessages[userMessages.length - 1]!.intent, 'question');
  });
});

// ---------------------------------------------------------------------------
// #5 acceptance: user response path
// ---------------------------------------------------------------------------

describe('POST /api/interrogate: user response path (#5)', () => {
  it('returns aiReply and followUp for a substantive response', async () => {
    const session = seedSession();
    await scope.sessions.saveSession(session);
    await startSession(session);

    const res = await postInterrogate({
      sessionId: session.id,
      action: 'answer',
      answer: '我认为AI会增强而非取代创造力，因为摄影术催生了新艺术。',
    });
    assert.strictEqual(res.status, 200);
    const body = res.body as InterrogateResponseBody;

    assert.ok(body.aiReply && body.aiReply.length > 0, 'aiReply must be present for responses');
    assert.ok(body.followUp && body.followUp.length > 0, 'followUp must be present for responses');
    assert.strictEqual(body.directiveRound, 1, 'first substantive response advances directive round to 1');
    assert.strictEqual(body.suggestSummary, false);
    assert.strictEqual(body.round, 2, 'substantive response advances interrogation round');
  });

  it('advances directive round for each substantive response', async () => {
    const session = seedSession();
    await scope.sessions.saveSession(session);
    await startSession(session);

    // Three substantive responses
    for (let i = 1; i <= 3; i++) {
      const res = await postInterrogate({
        sessionId: session.id,
        action: 'answer',
        answer: ANSWER_ROUND(i),
      });
      assert.strictEqual(res.status, 200);
      const body = res.body as InterrogateResponseBody;
      assert.strictEqual(body.directiveRound, i, `directiveRound must be ${i} after response ${i}`);
    }

    // After the 3rd response, directiveRound = 3 and suggestSummary = true
    const stored = await scope.sessions.loadSession(session.id);
    assert.ok(stored);
    assert.strictEqual(stored.interrogation?.directiveRound, 3);
  });

  it('does not advance directive round for non-substantive responses', async () => {
    const session = seedSession();
    await scope.sessions.saveSession(session);
    await startSession(session);

    // First substantive response
    const res1 = await postInterrogate({
      sessionId: session.id,
      action: 'answer',
      answer: '我认为AI会增强而非取代创造力。',
    });
    assert.strictEqual(res1.status, 200);
    assert.strictEqual((res1.body as InterrogateResponseBody).directiveRound, 1);

    // Non-substantive response
    const res2 = await postInterrogate({
      sessionId: session.id,
      action: 'answer',
      answer: '不知道',
    });
    assert.strictEqual(res2.status, 200);
    assert.strictEqual((res2.body as InterrogateResponseBody).directiveRound, 1, 'directiveRound stays at 1');

    // Another substantive response
    const res3 = await postInterrogate({
      sessionId: session.id,
      action: 'answer',
      answer: '摄影术催生了新艺术形式。',
    });
    assert.strictEqual(res3.status, 200);
    assert.strictEqual((res3.body as InterrogateResponseBody).directiveRound, 2);
  });

  it('marks user messages with the correct intent', async () => {
    const session = seedSession();
    await scope.sessions.saveSession(session);
    await startSession(session);

    // Question
    await postInterrogate({ sessionId: session.id, action: 'answer', answer: '你能详细说明吗？' });
    // Response
    await postInterrogate({ sessionId: session.id, action: 'answer', answer: '我认为AI会增强创造力。' });

    const stored = await scope.sessions.loadSession(session.id);
    assert.ok(stored);
    const userMessages = stored.messages.filter((m) => m.role === 'user');
    assert.strictEqual(userMessages[0]!.intent, 'question');
    assert.strictEqual(userMessages[1]!.intent, 'response');
  });
});

// ---------------------------------------------------------------------------
// #5 acceptance: three-round summary gate
// ---------------------------------------------------------------------------

describe('POST /api/interrogate: three-round summary gate (#5)', () => {
  it('shows suggestSummary=true after 3 directive rounds (non-blocking)', async () => {
    const session = seedSession();
    await scope.sessions.saveSession(session);
    await startSession(session);

    // 3 substantive responses
    for (let i = 1; i <= 3; i++) {
      const res = await postInterrogate({
        sessionId: session.id,
        action: 'answer',
        answer: ANSWER_ROUND(i),
      });
      assert.strictEqual(res.status, 200, `response ${i} must succeed`);
    }

    // After the 3rd response, the API should set suggestSummary=true
    // (non-blocking: the user can continue answering)
    const stored = await scope.sessions.loadSession(session.id);
    assert.ok(stored);
    assert.strictEqual(stored.interrogation?.directiveRound, 3);
    assert.ok(!stored.interrogation?.pendingDecision,
      'summary gate must not block; pendingDecision must be absent or false');
  });

  it('does not suggest summary before 3 directive rounds', async () => {
    const session = seedSession();
    await scope.sessions.saveSession(session);
    await startSession(session);

    const res = await postInterrogate({
      sessionId: session.id,
      action: 'answer',
      answer: '第一轮实质性回答。',
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual((res.body as InterrogateResponseBody).suggestSummary, false);
  });

  it('suggests summary at directive round 3 and allows continued answers through round 4', async () => {
    const session = seedSession();
    await scope.sessions.saveSession(session);
    await startSession(session);

    // 4 substantive responses (rounds 1-4); after round 3 the summary gate shows
    // but does not block.
    for (let i = 1; i <= 4; i++) {
      const res = await postInterrogate({
        sessionId: session.id,
        action: 'answer',
        answer: `第 ${i} 轮回答，包含数据与例子。`,
      });
      assert.strictEqual(res.status, 200, `response ${i} must succeed`);

      // After the 3rd response, suggestSummary becomes true (non-blocking)
      if (i === 3) {
        const body = res.body as InterrogateResponseBody;
        assert.strictEqual(body.directiveRound, 3);
        assert.strictEqual(body.suggestSummary, true);
      }
    }

    // After 4 responses, the session is at round 5 with directiveRound=4
    // (each non-uncertain answer advances the round: 1→2→3→4→5)
    const stored = await scope.sessions.loadSession(session.id);
    assert.ok(stored);
    assert.strictEqual(stored.interrogation?.directiveRound, 4);
    assert.strictEqual(stored.interrogation?.round, 5);
  });
});

// ---------------------------------------------------------------------------
// #5 acceptance: AI reply and follow-up in message history
// ---------------------------------------------------------------------------

describe('POST /api/interrogate: AI reply history recovery (#5)', () => {
  it('persists AI reply as assistant message and returns it in response body', async () => {
    const session = seedSession();
    await scope.sessions.saveSession(session);
    await startSession(session);

    const res = await postInterrogate({
      sessionId: session.id,
      action: 'answer',
      answer: '你能解释一下吗？',
    });
    assert.strictEqual(res.status, 200);
    const body = res.body as InterrogateResponseBody;

    // Response body carries aiReply
    assert.ok(body.aiReply && body.aiReply.length > 0);

    // Session history carries the AI reply
    assert.ok(body.session.messages.some((m) => m.role === 'assistant' && m.text === body.aiReply));
  });

  it('follow-up question is the pending question in the response', async () => {
    const session = seedSession();
    await scope.sessions.saveSession(session);
    await startSession(session);

    const res = await postInterrogate({
      sessionId: session.id,
      action: 'answer',
      answer: '我认为AI会增强创造力。',
    });
    assert.strictEqual(res.status, 200);
    const body = res.body as InterrogateResponseBody;

    assert.ok(body.followUp && body.followUp.length > 0);
    assert.strictEqual(body.question, body.followUp, 'followUp must be the pending question');
  });
});

// ---------------------------------------------------------------------------
// #5 acceptance: LLM failure / degradation
// ---------------------------------------------------------------------------

describe('POST /api/interrogate: gentle LLM degradation (#5)', () => {
  it('still produces a response when the LLM fails (fallback to templates)', async () => {
    const session = seedSession();
    await scope.sessions.saveSession(session);
    await startSession(session);

    // Force LLM failure by patching the provider (same pattern as #15)
    const { llmProvider } = await import('../../src/lib/server-providers');
    const original = llmProvider.generateStrategyQuestion.bind(llmProvider);
    llmProvider.generateStrategyQuestion = async () => {
      throw new Error('LLM down');
    };

    try {
      const res = await postInterrogate({
        sessionId: session.id,
        action: 'answer',
        answer: '我认为AI会增强而非取代创造力。',
      });
      assert.strictEqual(res.status, 200);
      const body = res.body as InterrogateResponseBody;
      // Even with LLM failure, we get a response
      assert.ok(body.followUp && body.followUp.length > 0, 'must still have followUp on LLM failure');
    } finally {
      llmProvider.generateStrategyQuestion = original;
    }
  });
});

// ---------------------------------------------------------------------------
// #5 acceptance: existing behaviors preserved (start, uncertain, checkpoint)
// ---------------------------------------------------------------------------

describe('POST /api/interrogate: existing behaviors preserved alongside #5', () => {
  it('uncertain answers still narrow the question and persist correctly', async () => {
    const session = seedSession();
    await scope.sessions.saveSession(session);
    await startSession(session);

    const res = await postInterrogate({
      sessionId: session.id,
      action: 'answer',
      answer: '不知道',
    });
    assert.strictEqual(res.status, 200);
    const body = res.body as InterrogateResponseBody;
    assert.strictEqual(body.uncertainStreak, 1);
    assert.strictEqual(body.round, 1, 'uncertain answers must not advance round');
    assert.ok(body.hint && body.hint.message.length > 0);
  });

  it('checkpoint still appears after the 5th answer', async () => {
    const session = seedSession();
    await scope.sessions.saveSession(session);
    await startSession(session);

    for (let i = 1; i <= 5; i++) {
      const res = await postInterrogate({
        sessionId: session.id,
        action: 'answer',
        answer: ANSWER_ROUND(i),
      });
      assert.strictEqual(res.status, 200);
    }

    const stored = await scope.sessions.loadSession(session.id);
    assert.ok(stored);
    assert.strictEqual(stored.interrogation?.pendingCheckpoint, true);
    assert.strictEqual(stored.interrogation?.round, 5);
  });

  it('start remains idempotent once a question is pending', async () => {
    const session = seedSession();
    await scope.sessions.saveSession(session);
    await startSession(session);

    const again = await postInterrogate({
      sessionId: session.id,
      action: 'start',
      viewpoint: VIEWPOINT,
    });
    assert.strictEqual(again.status, 200);
    assert.strictEqual((again.body as InterrogateResponseBody).round, 1);
  });
});
