// Ticket #5: unit tests for directive round progression in gentle-interrogation.ts.
// Covers round counting, summary gate timing, and mixed question/response flows.
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  classifyIntent,
  completedDirectiveRounds,
  shouldSuggestSummary,
  generateGentleResponse,
} from '../../src/lib/gentle-interrogation';
import type { Session } from '../../src/lib/providers';

function makeSession(directiveRound = 0, round = 1, strategy: string = 'M1_evidence'): Session {
  return {
    id: 's_test',
    question: '测试问题',
    initialOpinion: '初步看法',
    report: null,
    selectedViewpoint: { id: 'v1', text: '测试观点', source: 'user_authored' },
    messages: [],
    resultCard: null,
    completed: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    interrogation: {
      round,
      strategy: strategy as 'M1_evidence',
      assistantQuestion: '当前问题',
      usedFallback: false,
      pendingCheckpoint: false,
      uncertainStreak: 0,
      directiveRound,
    },
  };
}

describe('completedDirectiveRounds (#5 directive round derivation)', () => {
  it('returns 0 for a session with directiveRound 0', () => {
    assert.strictEqual(completedDirectiveRounds(makeSession(0)), 0);
  });

  it('returns the persisted directiveRound when > 0', () => {
    assert.strictEqual(completedDirectiveRounds(makeSession(3)), 3);
  });

  it('returns 0 for a session without interrogation state', () => {
    const session: Session = {
      id: 's_legacy',
      question: 'q',
      initialOpinion: null,
      report: null,
      selectedViewpoint: null,
      messages: [],
      resultCard: null,
      completed: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    assert.strictEqual(completedDirectiveRounds(session), 0);
  });
});

describe('shouldSuggestSummary (#5 summary gate)', () => {
  it('returns false for 0, 1, 2', () => {
    assert.strictEqual(shouldSuggestSummary(0), false);
    assert.strictEqual(shouldSuggestSummary(1), false);
    assert.strictEqual(shouldSuggestSummary(2), false);
  });

  it('returns true for 3, 6, 9', () => {
    assert.strictEqual(shouldSuggestSummary(3), true);
    assert.strictEqual(shouldSuggestSummary(6), true);
    assert.strictEqual(shouldSuggestSummary(9), true);
  });

  it('returns false for 4, 5, 7, 8', () => {
    assert.strictEqual(shouldSuggestSummary(4), false);
    assert.strictEqual(shouldSuggestSummary(5), false);
    assert.strictEqual(shouldSuggestSummary(7), false);
    assert.strictEqual(shouldSuggestSummary(8), false);
  });
});

describe('Mixed question/response flow (#5 directive round progression)', () => {
  const session = makeSession(0, 1, 'M1_evidence');

  it('step 1: substantive response advances directive round to 1', () => {
    const result = generateGentleResponse(
      '我认为AI会增强而非取代创造力。',
      session,
      'M1_evidence'
    );
    assert.strictEqual(result.intent, 'response');
    assert.strictEqual(result.directiveRound, 1);
    assert.strictEqual(result.suggestSummary, false);
  });

  it('step 2: user question does not advance directive round, stays at 1', () => {
    const afterStep1 = makeSession(1, 2, 'M2_premise');
    const result = generateGentleResponse('你能再详细说明吗？', afterStep1, 'M2_premise');
    assert.strictEqual(result.intent, 'question');
    assert.strictEqual(result.directiveRound, 1, 'directive round stays at 1 after a question');
  });

  it('step 3: another substantive response advances directive round to 2', () => {
    const afterStep2 = makeSession(1, 2, 'M2_premise');
    const result = generateGentleResponse(
      '摄影术没有消灭绘画，反而催生了新艺术。',
      afterStep2,
      'M2_premise'
    );
    assert.strictEqual(result.intent, 'response');
    assert.strictEqual(result.directiveRound, 2);
    assert.strictEqual(result.suggestSummary, false);
  });

  it('step 4: third substantive response advances directive round to 3 and triggers summary gate', () => {
    const afterStep3 = makeSession(2, 3, 'M4_steelman');
    const result = generateGentleResponse(
      '技术进步最终会扩大人类的表达空间。',
      afterStep3,
      'M4_steelman'
    );
    assert.strictEqual(result.intent, 'response');
    assert.strictEqual(result.directiveRound, 3);
    assert.strictEqual(result.suggestSummary, true, 'summary gate triggers at directive round 3');
    // The follow-up is still generated (summary gate is non-blocking).
    assert.ok(result.followUp && result.followUp.length > 0);
  });

  it('step 5: non-substantive response does not advance directive round', () => {
    const session = makeSession(2, 3, 'M4_steelman');
    const result = generateGentleResponse('不知道', session, 'M4_steelman');
    assert.strictEqual(result.intent, 'response');
    assert.strictEqual(result.directiveRound, 2, 'non-substantive response keeps directive round at 2');
    assert.strictEqual(result.suggestSummary, false);
  });
});

describe('Directive round summary gate boundaries (#5)', () => {
  const baseSession = makeSession();

  it('does not suggest summary at directive round 0', () => {
    const result = generateGentleResponse('用户回答', baseSession, 'M1_evidence');
    assert.strictEqual(result.directiveRound, 1);
    assert.strictEqual(result.suggestSummary, false);
  });

  it('suggests summary exactly at directive round 3', () => {
    const s3 = makeSession(2, 3, 'M4_steelman');
    const result = generateGentleResponse('第三轮回答', s3, 'M4_steelman');
    assert.strictEqual(result.directiveRound, 3);
    assert.strictEqual(result.suggestSummary, true);
  });

  it('does not suggest summary at directive round 4 (after continue)', () => {
    const s4 = makeSession(3, 4, 'M6_reversal');
    const result = generateGentleResponse('第四轮回答', s4, 'M6_reversal');
    assert.strictEqual(result.directiveRound, 4);
    assert.strictEqual(result.suggestSummary, false);
  });

  it('suggests summary again at directive round 6', () => {
    const s6 = makeSession(5, 6, 'M1_evidence');
    const result = generateGentleResponse('第六轮回答', s6, 'M1_evidence');
    assert.strictEqual(result.directiveRound, 6);
    assert.strictEqual(result.suggestSummary, true);
  });
});
