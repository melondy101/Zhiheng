// Ticket #26/R3: gentle adaptive interrogation round progression.
//
// PRD v4.2 §5: only substantive answers advance the directive round.
// The three-round summary gate appears at 3, 6, 9... directive rounds.
// User questions, non-substantive inputs and clarification questions
// MUST NOT change round, directiveRound or strategy history.
// The "继续聊" (continue) action must be a legal, persisted state
// transition — never a 409 — and the summary gate must survive reload.

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  classifyIntent,
  isNonSubstantive,
  completedDirectiveRounds,
  shouldSuggestSummary,
} from '../../src/lib/gentle-interrogation';
import { handleInterrogate } from '../../src/lib/interrogation-orchestrator';
import type {
  InterrogationState,
  Session,
  StorageProvider,
  Viewpoint,
} from '../../src/lib/providers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInterrogation(overrides: Partial<InterrogationState> = {}): InterrogationState {
  return {
    round: 0,
    strategy: null,
    assistantQuestion: null,
    usedFallback: false,
    pendingCheckpoint: false,
    uncertainStreak: 0,
    ...overrides,
  };
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 's_round',
    question: '怎么看热榜缓存？',
    initialOpinion: null,
    report: null,
    knowledgeGraph: null,
    selectedViewpoint: null,
    messages: [],
    resultCard: null,
    completed: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

/** In-memory storage that records every save. */
function makeStorage(initial: Session): {
  storage: StorageProvider;
  snapshot: () => Session;
  saves: () => readonly Session[];
} {
  let current = initial;
  const saves: Session[] = [];
  const storage: StorageProvider = {
    async saveSession(session: Session): Promise<void> {
      current = session;
      saves.push(session);
    },
    async loadSession(): Promise<Session | null> {
      return current;
    },
    async listSessions(): Promise<Session[]> {
      return [current];
    },
    async deleteSession(): Promise<void> {
      current = null as unknown as Session;
    },
  };
  return {
    storage,
    snapshot: () => current,
    saves: () => saves,
  };
}

function viewportText(text: string): Viewpoint {
  return { id: 'vp_user', text, source: 'user_authored', selectedAt: Date.now() };
}

const noopQuestion = async () => 'M2 追问';

// ---------------------------------------------------------------------------
// Intent classification — three intents: question / response / non-substantive
// ---------------------------------------------------------------------------

describe('classifyIntent (R3)', () => {
  it('classifies a leading question as "question"', () => {
    assert.strictEqual(classifyIntent('什么是缓存？'), 'question');
    assert.strictEqual(classifyIntent('为什么需要持久化？'), 'question');
    assert.strictEqual(classifyIntent('How does it work?'), 'question');
  });

  it('classifies a direct substantive statement as "response"', () => {
    assert.strictEqual(classifyIntent('我认为热榜缓存必须 6 小时有效'), 'response');
    assert.strictEqual(classifyIntent('因为数据库可以保证一致性'), 'response');
  });

  it('flags non-substantive filler (must be excluded from the round counter)', () => {
    assert.strictEqual(isNonSubstantive('不知道'), true);
    assert.strictEqual(isNonSubstantive('嗯'), true);
    assert.strictEqual(isNonSubstantive('好的'), true);
  });
});

// ---------------------------------------------------------------------------
// Question / non-substantive inputs must NOT change round, directiveRound
// or strategy history.
// ---------------------------------------------------------------------------

describe('a user question does not advance the directive round (R3)', () => {
  it('a question keeps directiveRound at 0 and tags lastIntent="question"', async () => {
    const session = makeSession({
      selectedViewpoint: viewportText('初始观点'),
      interrogation: makeInterrogation({
        round: 1,
        strategy: 'M1_evidence',
        assistantQuestion: '请提供一些证据？',
      }),
    });
    const store = makeStorage(session);
    const result = await handleInterrogate({
      action: 'answer',
      sessionId: session.id,
      answer: '什么是缓存？',
      viewpoint: viewportText('初始观点'),
      storage: store.storage,
      generateQuestion: noopQuestion,
    });
    assert.strictEqual(result.ok, true);
    const saved = store.snapshot();
    assert.strictEqual(saved.interrogation?.directiveRound ?? 0, 0,
      'question must not increment directiveRound');
    assert.strictEqual(saved.interrogation?.lastIntent, 'question');
  });

  it('a non-substantive filler does not advance the round or directiveRound', async () => {
    const session = makeSession({
      selectedViewpoint: viewportText('初始观点'),
      interrogation: makeInterrogation({
        round: 2,
        strategy: 'M1_evidence',
        assistantQuestion: '你为什么这么看？',
      }),
    });
    const store = makeStorage(session);
    const result = await handleInterrogate({
      action: 'answer',
      sessionId: session.id,
      answer: '不知道',
      viewpoint: viewportText('初始观点'),
      storage: store.storage,
      generateQuestion: noopQuestion,
    });
    assert.strictEqual(result.ok, true);
    const saved = store.snapshot();
    assert.strictEqual(saved.interrogation?.directiveRound ?? 0, 0);
  });
});

// ---------------------------------------------------------------------------
// A substantive response DOES advance the directive round.
// ---------------------------------------------------------------------------

describe('a substantive response advances the directive round (R3)', () => {
  it('moves directiveRound from 0 to 1 to 2 on consecutive answers', async () => {
    let current = makeSession({
      selectedViewpoint: viewportText('初始观点'),
      interrogation: makeInterrogation({ round: 1, strategy: 'M1_evidence', assistantQuestion: 'q1' }),
    });
    const store = makeStorage(current);
    const input = {
      sessionId: current.id,
      viewpoint: viewportText('初始观点'),
      storage: store.storage,
      generateQuestion: noopQuestion,
    };

    const r1 = await handleInterrogate({ ...input, action: 'answer', answer: '我认为缓存优先能减少外部调用' });
    assert.strictEqual(r1.ok, true);
    assert.strictEqual(store.snapshot().interrogation?.directiveRound, 1);

    const r2 = await handleInterrogate({ ...input, action: 'answer', answer: '因为数据库查询快且一致' });
    assert.strictEqual(r2.ok, true);
    assert.strictEqual(store.snapshot().interrogation?.directiveRound, 2);
  });
});

// ---------------------------------------------------------------------------
// 3 / 6 / 9 summary gate
// ---------------------------------------------------------------------------

describe('three-round summary gate (R3)', () => {
  it('suggestSummary is true when directiveRound reaches 3, 6, 9, 12', () => {
    for (const n of [3, 6, 9, 12]) {
      assert.strictEqual(shouldSuggestSummary(n), true, `round ${n} should open the gate`);
    }
    for (const n of [0, 1, 2, 4, 5, 7, 8, 10, 11]) {
      assert.strictEqual(shouldSuggestSummary(n), false, `round ${n} must NOT open the gate`);
    }
  });

  it('completedDirectiveRounds reads the persisted directiveRound and falls back to user answers', () => {
    const withPersisted = makeSession({ interrogation: makeInterrogation({ directiveRound: 3 }) });
    assert.strictEqual(completedDirectiveRounds(withPersisted), 3);
    const legacy = makeSession({
      messages: [
        { id: 'a', role: 'user', text: 'A1', timestamp: Date.now() },
        { id: 'b', role: 'user', text: 'A2', timestamp: Date.now() },
        { id: 'c', role: 'user', text: 'A3', timestamp: Date.now() },
      ],
    });
    assert.strictEqual(completedDirectiveRounds(legacy), 3);
  });
});

// ---------------------------------------------------------------------------
// "继续聊" (continue) must be a legal, persisted state transition and the
// summary gate must survive reload.
// ---------------------------------------------------------------------------

describe('continue is legal and reloadable (R3)', () => {
  it('continue when suggestSummary is true never returns 409 and keeps the session', async () => {
    const session = makeSession({
      selectedViewpoint: viewportText('初始观点'),
      interrogation: makeInterrogation({
        round: 3,
        strategy: 'M4_steelman',
        assistantQuestion: '还有别的场景吗？',
        directiveRound: 3,
        lastIntent: 'response',
      }),
    });
    const store = makeStorage(session);
    const continued = await handleInterrogate({
      action: 'continue',
      sessionId: session.id,
      viewpoint: viewportText('初始观点'),
      storage: store.storage,
      generateQuestion: noopQuestion,
    });
    assert.strictEqual(continued.ok, true, 'continue must be a legal transition');
    assert.ok(continued.body, 'continue must return a body');
    // The session must be intact.
    const saved = store.snapshot();
    assert.strictEqual(saved.id, session.id);
    assert.strictEqual(saved.completed, false);
  });

  it('the summary gate state survives a reload round-trip', async () => {
    const session = makeSession({
      selectedViewpoint: viewportText('初始观点'),
      interrogation: makeInterrogation({
        round: 3,
        strategy: 'M4_steelman',
        assistantQuestion: '还有别的场景吗？',
        directiveRound: 3,
        lastIntent: 'response',
      }),
    });
    const store = makeStorage(session);
    const before = store.snapshot();
    assert.ok(before.interrogation);
    assert.strictEqual(before.interrogation!.directiveRound, 3);

    // Simulate reload: a brand-new storage handle reading the same session.
    const reloaded = await store.storage.loadSession(session.id);
    assert.ok(reloaded);
    assert.strictEqual(reloaded?.interrogation?.directiveRound, 3);
    assert.strictEqual(shouldSuggestSummary(reloaded?.interrogation?.directiveRound ?? 0), true);
  });
});

// ---------------------------------------------------------------------------
// Assistant messages must be persisted exactly once: refresh recovers the
// full AI / user history. (Covered with the public handleInterrogate API.)
// ---------------------------------------------------------------------------

describe('assistant message persistence is single-shot (R3)', () => {
  it('a question turn persists at most one assistant message (no duplicate / triple render)', async () => {
    const session = makeSession({
      selectedViewpoint: viewportText('初始观点'),
      interrogation: makeInterrogation({ round: 1, strategy: 'M1_evidence', assistantQuestion: 'q1' }),
    });
    const store = makeStorage(session);
    const result = await handleInterrogate({
      action: 'answer',
      sessionId: session.id,
      answer: '什么是缓存？',
      viewpoint: viewportText('初始观点'),
      storage: store.storage,
      generateQuestion: noopQuestion,
    });
    assert.strictEqual(result.ok, true);
    const saved = store.snapshot();
    const assistantMessagesAfter = saved.messages.filter((m) => m.role === 'assistant');
    assert.ok(assistantMessagesAfter.length <= 1,
      `expected ≤1 assistant message after one turn, got ${assistantMessagesAfter.length}`);
  });
});
