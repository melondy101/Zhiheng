// Ticket #15: API integration tests for the single interrogation orchestration
// endpoint. The route handler is exercised directly with real Request objects
// against the real ownership-scoped server storage (#21: requests carry the
// x-zhiyan-owner header and seeding goes through the same owner scope), so
// every assertion below covers orchestration + persistence exactly as the
// Next.js route runs it.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { POST } from '../../src/app/api/interrogate/route';
import { llmProvider, FixtureLLMProvider } from '../../src/lib/server-providers';
import { getServerStorage, type OwnerStorageScope } from '../../src/lib/server-storage';
import { STRATEGIES } from '../../src/lib/strategy-engine';
import type {
  InterrogateResponseBody,
  Message,
  Session,
  Source,
  Viewpoint,
} from '../../src/lib/providers';

const VIEWPOINT: Viewpoint = {
  id: 'v1',
  text: '我认为AI会增强而非取代创造力',
  source: 'ai_suggested_and_selected',
};

const ANSWER_ROUND = (round: number) => `第 ${round} 轮的实质性回答，包含具体数据与例子。`;

// #21: the anonymous owner the requests and the seeding share. The value
// must satisfy the server-side owner id validation.
const TEST_OWNER = 'test-owner-interrogate';
let scope: OwnerStorageScope;
let origGenerateQuestion: typeof llmProvider.generateStrategyQuestion;

before(async () => {
  const manager = await getServerStorage();
  scope = manager.forOwner(TEST_OWNER);
  origGenerateQuestion = llmProvider.generateStrategyQuestion.bind(llmProvider);
  const fixture = new FixtureLLMProvider();
  llmProvider.generateStrategyQuestion = (strategy, session) =>
    fixture.generateStrategyQuestion(strategy, session);
});

after(() => {
  if (origGenerateQuestion) {
    llmProvider.generateStrategyQuestion = origGenerateQuestion;
  }
});

const RUN_ID = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
let sessionCounter = 0;

function seedSession(overrides: Partial<Session> = {}): Session {
  sessionCounter += 1;
  const session: Session = {
    id: `s_test_${RUN_ID}_${sessionCounter}`,
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
    await scope.sessions.saveSession(session);
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
    await scope.sessions.saveSession(session);
    const result = await postInterrogate({ sessionId: session.id, action: 'answer', answer: '任意回答' });
    assert.strictEqual(result.status, 400);
  });

  it('returns 400 when starting without a viewpoint', async () => {
    const session = seedSession();
    await scope.sessions.saveSession(session);
    const result = await postInterrogate({ sessionId: session.id, action: 'start' });
    assert.strictEqual(result.status, 400);
  });

  it('returns 200 (not 409) for continue when the summary gate is open (#26/R3)', async () => {
    // #26/R3: PRD v4.2 §5.3 removed the v4.1 5/8/11 round checkpoints. The
    // only continuation gate is the three-round summary gate; "继续聊"
    // must be a legal state transition, never a 409.
    const session = seedSession();
    await scope.sessions.saveSession(session);
    const result = await postInterrogate({ sessionId: session.id, action: 'continue' });
    assert.strictEqual(result.status, 200);
  });

  it('returns 409 when the session is already completed', async () => {
    const session = seedSession({ completed: true, resultCard: null });
    await scope.sessions.saveSession(session);
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
    await scope.sessions.saveSession(session);

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

  it('after the 3rd substantive answer the summary gate opens and the session is not completed (#26/R3)', async () => {
    // #26/R3: PRD v4.2 §5.3 — the only checkpoint is the three-round summary
    // gate, not a v4.1 fixed 5/8/11 round checkpoint. After 3 substantive
    // directive answers the API must report suggestSummary=true and keep the
    // session open so the user can pick 继续聊 / 生成总结.
    const session = seedSession();
    await scope.sessions.saveSession(session);
    await startSession(session);
    const afterThird = await answerRounds(session, 3);

    assert.strictEqual(afterThird.suggestSummary, true, 'summary gate must open after the 3rd directive answer');
    assert.strictEqual(afterThird.completed, false, 'summary gate is not completion');
    assert.strictEqual(afterThird.checkpoint, false, 'no v4.1 5/8/11 checkpoint must appear');

    const stored = await scope.sessions.loadSession(session.id);
    assert.ok(stored);
    assert.strictEqual(stored.interrogation?.pendingCheckpoint, false);
    assert.strictEqual(stored.interrogation?.directiveRound, 3);
    assert.strictEqual(stored.completed, false);
  });

  it('continue after the summary gate is a legal 200 (never 409) and keeps the session (#26/R3)', async () => {
    const session = seedSession();
    await scope.sessions.saveSession(session);
    await startSession(session);
    await answerRounds(session, 3);

    const res = await postInterrogate({ sessionId: session.id, action: 'continue' });
    assert.strictEqual(res.status, 200, 'continue after the summary gate must be 200, not 409');
    const stored = await scope.sessions.loadSession(session.id);
    assert.ok(stored);
    assert.strictEqual(stored.interrogation?.pendingCheckpoint, false);
    assert.strictEqual(stored.completed, false);
  });

  it('start is idempotent once a question or checkpoint is pending', async () => {
    const session = seedSession();
    await scope.sessions.saveSession(session);
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
    await scope.sessions.saveSession(session);
    await startSession(session);
    const last = await answerRounds(session, 2);

    const reloaded = await scope.sessions.loadSession(session.id);
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
  it('resumes the exact round after the server store loses the session (server restart)', async () => {
    const session = seedSession();
    await scope.sessions.saveSession(session);
    await startSession(session);
    const last = await answerRounds(session, 2);
    assert.strictEqual(last.round, 3);

    // Simulate a dev-server restart: the in-memory store is wiped. The client
    // re-postits its persisted snapshot; the API must adopt it and continue.
    await scope.sessions.deleteSession(session.id);
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

    const stored = await scope.sessions.loadSession(session.id);
    assert.ok(stored, 'hydrated session must be persisted again');
    assert.strictEqual(userTexts(stored.messages).length, 3);
    assert.strictEqual(stored.interrogation?.round, 4);
  });

  it('summary-gate continue survives a restart: round 4, not a replay (#26/R3)', async () => {
    // #26/R3: PRD v4.2 §5.3 — the only checkpoint is the three-round summary
    // gate. After 3 directive answers the gate opens; continue must clear
    // it and advance the round, even across a server restart that re-hydrates
    // the session from the client snapshot.
    const session = seedSession();
    await scope.sessions.saveSession(session);
    await startSession(session);
    await answerRounds(session, 3);

    const gateState = await scope.sessions.loadSession(session.id);
    assert.ok(gateState);
    assert.strictEqual(gateState.interrogation?.directiveRound, 3);

    await scope.sessions.deleteSession(session.id);
    const res = await postInterrogate({
      sessionId: session.id,
      action: 'continue',
      session: gateState,
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.checkpoint, false, 'continue must clear the summary gate, not replay a v4.1 5/8/11 checkpoint');
    assert.ok(res.body.question || res.body.suggestSummary, 'continue must return either a next question or the summary gate');
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
      await scope.sessions.saveSession(session);
      const res = await postInterrogate({
        sessionId: session.id,
        action: 'start',
        viewpoint: VIEWPOINT,
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.usedFallback, true);
      // #16: the fallback template is context-driven too — the orchestrator
      // plans with the stance already selected, so the expected template is
      // computed against the same prepared session.
      const prepared: Session = { ...session, selectedViewpoint: VIEWPOINT };
      const template = STRATEGIES.M1_evidence.fallbackTemplate(prepared);
      assert.strictEqual(res.body.question, template);
      // Honest degradation: the template discloses its provenance and quotes
      // the user's claim (#16).
      assert.ok(template.includes('策略模板'), `fallback must disclose degradation: ${template}`);
      assert.ok(
        template.includes(VIEWPOINT.text),
        `fallback must reference the stance claim: ${template}`
      );

      const stored = await scope.sessions.loadSession(session.id);
      assert.ok(stored);
      assert.strictEqual(stored.interrogation?.usedFallback, true);
      assert.strictEqual(stored.interrogation?.assistantQuestion, template);
    } finally {
      llmProvider.generateStrategyQuestion = original;
    }
  });
});

describe('POST /api/interrogate: context-driven questions (#16)', () => {
  const CLAIM_A = '远程工作减少通勤时间，并提升员工的自主权。';
  const CLAIM_B = '开放办公环境能促进团队的即时协作。';

  it('round 1 quotes the selected stance instead of fixed template text', async () => {
    const session = seedSession();
    await scope.sessions.saveSession(session);
    const started = await startSession(session);
    assert.ok(started.question, 'round 1 must have a question');
    assert.ok(
      started.question.includes(VIEWPOINT.text),
      `round 1 question must quote the stance, got: ${started.question}`
    );
    assert.notStrictEqual(started.question, '第 1 轮：请进一步阐述你的观点。');
  });

  it('the next question quotes a claim fragment from the user\'s last answer', async () => {
    const session = seedSession();
    await scope.sessions.saveSession(session);
    await startSession(session);
    const res = await postInterrogate({
      sessionId: session.id,
      action: 'answer',
      answer: CLAIM_A,
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.round, 2);
    assert.strictEqual(res.body.strategy, 'M2_premise');
    assert.ok(res.body.question);
    assert.ok(
      res.body.question.includes('远程工作减少通勤时间'),
      `question must quote the user's claim, got: ${res.body.question}`
    );
  });

  it('different user answers produce different questions at the same round', async () => {
    const sessionA = seedSession();
    await scope.sessions.saveSession(sessionA);
    await startSession(sessionA);
    const resA = await postInterrogate({ sessionId: sessionA.id, action: 'answer', answer: CLAIM_A });

    const sessionB = seedSession();
    await scope.sessions.saveSession(sessionB);
    await startSession(sessionB);
    const resB = await postInterrogate({ sessionId: sessionB.id, action: 'answer', answer: CLAIM_B });

    assert.strictEqual(resA.body.round, 2);
    assert.strictEqual(resB.body.round, 2);
    assert.strictEqual(resA.body.strategy, 'M2_premise');
    assert.strictEqual(resB.body.strategy, 'M2_premise');
    assert.ok(resA.body.question && resB.body.question);
    assert.notStrictEqual(resA.body.question, resB.body.question);
    assert.ok(resA.body.question.includes('远程工作减少通勤时间'));
    assert.ok(resB.body.question.includes('开放办公环境'));
  });
});

describe('POST /api/interrogate: report evidence sources (#16)', () => {
  const citationSource = (id: string, url: string | null): Source => ({
    id,
    type: 'zhihu',
    author: null,
    title: `标题 ${id}`,
    url,
    excerpt: null,
  });

  it('returns the first citation-numbered URL-bearing sources, skipping url-less ones', async () => {
    const s1 = citationSource('src_1', 'https://example.com/1');
    const s2 = citationSource('src_2', 'https://example.com/2');
    const s3 = citationSource('src_3', null);
    const s4 = citationSource('src_4', 'https://example.com/4');
    const s5 = citationSource('src_5', 'https://example.com/5');
    const session = seedSession({
      report: {
        question: 'q',
        title: 't',
        knowledgePoints: [],
        content: 'c',
        viewpoints: [],
        references: [s1, s2, s3, s4, s5],
        citations: { 1: s1, 2: s2, 3: s3, 4: s4, 5: s5 },
      },
    });
    await scope.sessions.saveSession(session);
    const started = await startSession(session);
    assert.deepStrictEqual(started.sources, [
      { index: 1, source: s1 },
      { index: 2, source: s2 },
      { index: 4, source: s4 },
    ]);
  });

  it('returns an empty source list when the session has no usable citations', async () => {
    const session = seedSession();
    await scope.sessions.saveSession(session);
    const started = await startSession(session);
    assert.deepStrictEqual(started.sources, []);
  });
});

describe('POST /api/interrogate: uncertainty loop (#17)', () => {
  /** The user messages recorded while uncertain (role=user + uncertain flag). */
  const uncertainInputs = (messages: Message[]): Message[] =>
    messages.filter((m) => m.role === 'user' && m.uncertain === true);

  it('keeps uncertain inputs 1-2 in the current round, persists them, and narrows the question', async () => {
    const session = seedSession();
    await scope.sessions.saveSession(session);
    const started = await startSession(session);
    const round1Question = started.question!;

    const first = await postInterrogate({
      sessionId: session.id,
      action: 'answer',
      answer: '不知道',
    });
    assert.strictEqual(first.status, 200);
    assert.strictEqual(first.body.uncertainStreak, 1);
    assert.strictEqual(first.body.round, 1, 'a streak-1 answer must NOT advance the round');
    assert.strictEqual(first.body.strategy, 'M1_evidence', 'no re-plan while uncertain');
    assert.ok(first.body.hint && first.body.hint.message.includes('缩小'));
    // #17: the narrowing question is a context-driven rewrite of the current
    // question (quotes the stance claim), not fixed text.
    assert.ok(first.body.question, 'a narrowed question stays pending');
    assert.ok(
      first.body.question!.includes('先聚焦'),
      `narrowed question must rewrite the current question, got: ${first.body.question}`
    );
    assert.ok(
      first.body.question!.includes(VIEWPOINT.text),
      `narrowed question must still quote the stance claim, got: ${first.body.question}`
    );

    // The first input is persisted as an uncertain user message.
    const stored1 = await scope.sessions.loadSession(session.id);
    assert.ok(stored1);
    assert.deepStrictEqual(
      uncertainInputs(stored1.messages).map((m) => m.text),
      ['不知道']
    );
    assert.strictEqual(stored1.interrogation?.round, 1);
    assert.strictEqual(stored1.interrogation?.uncertainStreak, 1);

    const second = await postInterrogate({
      sessionId: session.id,
      action: 'answer',
      answer: '我不清楚',
    });
    assert.strictEqual(second.status, 200);
    assert.strictEqual(second.body.uncertainStreak, 2);
    assert.strictEqual(second.body.round, 1, 'a streak-2 answer must NOT advance the round');
    assert.ok(second.body.hint && Array.isArray(second.body.hint.hint));
    assert.strictEqual(second.body.hint?.hint?.length, 2);
    assert.strictEqual(
      second.body.question,
      first.body.question,
      'the narrowed question is kept for the second uncertain answer'
    );

    const stored2 = await scope.sessions.loadSession(session.id);
    assert.ok(stored2);
    assert.deepStrictEqual(
      uncertainInputs(stored2.messages).map((m) => m.text),
      ['不知道', '我不清楚']
    );
  });

  it('the third uncertain answer is persisted and returns an explicit decision gate, never auto-complete', async () => {
    const session = seedSession();
    await scope.sessions.saveSession(session);
    await startSession(session);
    await postInterrogate({ sessionId: session.id, action: 'answer', answer: '不知道' });
    await postInterrogate({ sessionId: session.id, action: 'answer', answer: '我不清楚' });

    const third = await postInterrogate({
      sessionId: session.id,
      action: 'answer',
      answer: '不确定',
    });
    assert.strictEqual(third.status, 200);
    assert.strictEqual(third.body.decisionPending, true, 'explicit decision gate');
    assert.strictEqual(third.body.suggestComplete, true);
    assert.strictEqual(third.body.uncertainStreak, 3);
    assert.strictEqual(third.body.round, 1);
    assert.ok(third.body.hint && third.body.hint.message.includes('建议结束'));

    // #17: the THIRD input must be persisted too — never discarded — and the
    // session must NOT be completed automatically.
    const stored = await scope.sessions.loadSession(session.id);
    assert.ok(stored);
    assert.deepStrictEqual(
      uncertainInputs(stored.messages).map((m) => m.text),
      ['不知道', '我不清楚', '不确定']
    );
    assert.strictEqual(stored.interrogation?.pendingDecision, true);
    assert.strictEqual(stored.completed, false);
  });

  it('continue from the decision gate resets the streak and plans a fresh question in the same round', async () => {
    const session = seedSession();
    await scope.sessions.saveSession(session);
    const started = await startSession(session);
    await postInterrogate({ sessionId: session.id, action: 'answer', answer: '不知道' });
    await postInterrogate({ sessionId: session.id, action: 'answer', answer: '我不清楚' });
    await postInterrogate({ sessionId: session.id, action: 'answer', answer: '不确定' });

    const cont = await postInterrogate({ sessionId: session.id, action: 'continue' });
    assert.strictEqual(cont.status, 200);
    assert.strictEqual(cont.body.decisionPending, false);
    assert.strictEqual(cont.body.uncertainStreak, 0, 'the streak resets on explicit continue');
    assert.strictEqual(cont.body.round, 1, 'still round 1: no round was completed');
    assert.ok(cont.body.question && cont.body.question.length > 0);
    assert.notStrictEqual(
      cont.body.question,
      '让我们把问题缩小一些',
      'a fresh question replaces the narrowed one'
    );

    // The user can answer again and rounds advance normally from here.
    const ans = await postInterrogate({
      sessionId: session.id,
      action: 'answer',
      answer: ANSWER_ROUND(1),
    });
    assert.strictEqual(ans.status, 200);
    assert.strictEqual(ans.body.round, 2, 'a substantive answer advances the round');
    assert.strictEqual(ans.body.strategy, 'M2_premise');
  });

  it('rejects answers with 409 while the decision gate is pending', async () => {
    const session = seedSession();
    await scope.sessions.saveSession(session);
    await startSession(session);
    await postInterrogate({ sessionId: session.id, action: 'answer', answer: '不知道' });
    await postInterrogate({ sessionId: session.id, action: 'answer', answer: '我不清楚' });
    await postInterrogate({ sessionId: session.id, action: 'answer', answer: '不确定' });

    const ans = await postInterrogate({ sessionId: session.id, action: 'answer', answer: '随便答一下' });
    assert.strictEqual(ans.status, 409);
  });

  it('a substantive answer after uncertainty resets the streak and advances the round', async () => {
    const session = seedSession();
    await scope.sessions.saveSession(session);
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
    assert.strictEqual(res.body.round, 2, 'the round advances only via substantive answers');
  });
});

describe('POST /api/interrogate: explicit complete action (#17)', () => {
  it('completes server-side: builds and persists the result card, then start returns 409', async () => {
    const session = seedSession();
    await scope.sessions.saveSession(session);
    await startSession(session);
    await answerRounds(session, 2);

    const res = await postInterrogate({ sessionId: session.id, action: 'complete' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.completed, true);

    const card = res.body.session!.resultCard;
    assert.ok(card, 'the response must carry the persisted result card');
    assert.strictEqual(card!.finalPosition, ANSWER_ROUND(2));
    assert.ok(card!.messageIds.length >= 2, 'every answer is traced');

    const stored = await scope.sessions.loadSession(session.id);
    assert.ok(stored);
    assert.strictEqual(stored.completed, true);
    assert.ok(stored.resultCard);
    assert.strictEqual(stored.resultCard!.finalPosition, ANSWER_ROUND(2));

    // #15 P2-1 fix evidence: a completed session rejects start with 409.
    const again = await postInterrogate({
      sessionId: session.id,
      action: 'start',
      viewpoint: VIEWPOINT,
    });
    assert.strictEqual(again.status, 409);

    // Completion is idempotent: re-posting complete returns the same card.
    const retry = await postInterrogate({ sessionId: session.id, action: 'complete' });
    assert.strictEqual(retry.status, 200);
    assert.deepStrictEqual(retry.body.session!.resultCard, card);
  });

  it('returns 500 without corrupting the session when persistence fails', async () => {
    const session = seedSession();
    await scope.sessions.saveSession(session);
    // The route resolves the same cached per-owner scope object, so patching
    // the scoped view's saveSession injects the failure exactly where the
    // route persists.
    const original = scope.sessions.saveSession;
    scope.sessions.saveSession = async () => {
      throw new Error('disk full');
    };
    try {
      const res = await postInterrogate({ sessionId: session.id, action: 'complete' });
      assert.strictEqual(res.status, 500);
    } finally {
      scope.sessions.saveSession = original;
    }

    const stored = await scope.sessions.loadSession(session.id);
    assert.ok(stored, 'the session must survive a failed completion');
    assert.strictEqual(stored.completed, false);
    assert.strictEqual(stored.resultCard, null);
  });
});

describe('POST /api/interrogate: adaptive questioning intensity', () => {
  it('starts gentle, raises intensity only after sustained detail, and lowers it on hesitation', async () => {
    const session = seedSession();
    await scope.sessions.saveSession(session);
    const started = await startSession(session);
    assert.strictEqual(started.session?.questioningIntensity, 'gentle');
    assert.strictEqual(started.session?.interrogation?.questioningIntensity, 'gentle');

    const first = await postInterrogate({
      sessionId: session.id,
      action: 'answer',
      answer: '我会比较短期效率、长期组织学习和执行成本，不能只看其中一个指标。',
    });
    assert.strictEqual(first.status, 200);
    assert.strictEqual(first.body.session?.questioningIntensity, 'gentle');

    const second = await postInterrogate({
      sessionId: session.id,
      action: 'answer',
      answer: '还应收集不同团队规模的案例，并检验沟通成本是否会改变这个判断。',
    });
    assert.strictEqual(second.status, 200);
    assert.strictEqual(second.body.session?.questioningIntensity, 'standard');

    const third = await postInterrogate({
      sessionId: session.id,
      action: 'answer',
      answer: '我会补充一个反例，并说明它是否足以推翻原来的结论。',
    });
    assert.strictEqual(third.status, 200);
    assert.strictEqual(third.body.session?.questioningIntensity, 'challenging');

    const hesitant = await postInterrogate({
      sessionId: session.id,
      action: 'answer',
      answer: '暂时说不出更多依据',
    });
    assert.strictEqual(hesitant.status, 200);
    assert.strictEqual(hesitant.body.session?.questioningIntensity, 'standard');
  });

  it('de-escalates the next steelman question after two low-engagement substantive answers', async () => {
    const session = seedSession();
    await scope.sessions.saveSession(session);
    await startSession(session);

    const first = await postInterrogate({
      sessionId: session.id,
      action: 'answer',
      answer: '暂时说不出更多依据',
    });
    assert.strictEqual(first.status, 200);
    assert.strictEqual(first.body.strategy, 'M2_premise');
    assert.strictEqual(first.body.session?.interrogation?.adaptiveMode, 'scaffolded');
    assert.ok(first.body.hint?.message.includes('先说一个'));

    const second = await postInterrogate({
      sessionId: session.id,
      action: 'answer',
      answer: '我先不展开了',
    });
    assert.strictEqual(second.status, 200);
    assert.strictEqual(second.body.strategy, 'M7_metacognition');
    assert.ok(second.body.hint?.message.includes('更容易进入'));
    assert.strictEqual(second.body.session?.interrogation?.adaptiveMode, 'deescalated');
    assert.deepStrictEqual(second.body.session?.interrogationIntensityLog, [{
      round: 3,
      from: 'M4_steelman',
      to: 'M7_metacognition',
      mode: 'deescalated',
      reasons: ['avoidance'],
    }]);
  });
});
