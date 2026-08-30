// Ticket #15: unit tests for the pure parts of the interrogation orchestrator
// (state derivation and round/streak math). The full storage-backed behavior
// is covered by tests/integration/interrogate-api.test.ts.
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  answeredRounds,
  evaluateStreak,
  interrogationStateOf,
} from '../../src/lib/interrogation-orchestrator';
import type { InterrogationState, Message, Session } from '../../src/lib/providers';

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
