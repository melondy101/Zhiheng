// Ticket #5: unit tests for the intent classifier in gentle-interrogation.ts.
// Covers question detection, response detection, and non-substantive filtering.
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  classifyIntent,
  isNonSubstantive,
  completedDirectiveRounds,
  shouldSuggestSummary,
  generateGentleResponse,
  type GentleResponse,
} from '../../src/lib/gentle-interrogation';
import type { Session, Message } from '../../src/lib/providers';

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 's_test',
    question: 'AI是否会取代人类创造力？',
    initialOpinion: '我的初步看法',
    report: null,
    selectedViewpoint: { id: 'v1', text: '我认为AI会增强而非取代创造力', source: 'ai_suggested_and_selected' },
    messages: [],
    resultCard: null,
    completed: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe('classifyIntent (#5 intent classifier)', () => {
  // ---- Question detection ----
  it('classifies a Chinese question-mark sentence as a question', () => {
    assert.strictEqual(classifyIntent('你能举个例子吗？'), 'question');
  });

  it('classifies a sentence with an embedded question mark as a question', () => {
    assert.strictEqual(classifyIntent('我想知道这个观点是否有数据支持？你怎么看？'), 'question');
  });

  it('classifies a sentence starting with 什么 as a question', () => {
    assert.strictEqual(classifyIntent('什么是证据？'), 'question');
  });

  it('classifies a sentence starting with 如何 as a question', () => {
    assert.strictEqual(classifyIntent('如何论证这一点？'), 'question');
  });

  it('classifies a sentence starting with 为什么 as a question', () => {
    assert.strictEqual(classifyIntent('为什么这个结论成立？'), 'question');
  });

  it('classifies a sentence starting with 请解释 as a question', () => {
    assert.strictEqual(classifyIntent('请解释一下这个逻辑。'), 'question');
  });

  it('classifies a sentence starting with 请问 as a question', () => {
    assert.strictEqual(classifyIntent('请问你能详细说明吗？'), 'question');
  });

  it('classifies a short question-like phrase as a question', () => {
    assert.strictEqual(classifyIntent('为什么？'), 'question');
    assert.strictEqual(classifyIntent('真的吗？'), 'question');
  });

  it('classifies a sentence containing ？ as a question', () => {
    assert.strictEqual(classifyIntent('这合理吗？'), 'question');
  });

  // ---- Response detection ----
  it('classifies a statement without question mark as a response', () => {
    assert.strictEqual(classifyIntent('我认为AI会增强而非取代创造力。'), 'response');
  });

  it('classifies a multi-sentence answer as a response', () => {
    assert.strictEqual(
      classifyIntent('摄影术没有消灭绘画，反而催生了全新的艺术表达形式。'),
      'response'
    );
  });

  it('classifies an English statement as a response', () => {
    assert.strictEqual(classifyIntent('AI will enhance human creativity rather than replace it.'), 'response');
  });

  it('classifies a statement ending with a period as a response', () => {
    assert.strictEqual(classifyIntent('这是基于数据得出的结论。'), 'response');
  });

  // ---- Edge cases ----
  it('classifies empty string as response (default fallback)', () => {
    assert.strictEqual(classifyIntent(''), 'response');
  });

  it('classifies whitespace-only string as response', () => {
    assert.strictEqual(classifyIntent('   '), 'response');
  });

  it('classifies a statement with no question words and no question mark as response', () => {
    assert.strictEqual(classifyIntent('技术进步带来了新的可能性。'), 'response');
  });
});

describe('isNonSubstantive (#5 non-substantive filter)', () => {
  it('flags 不知道 as non-substantive', () => {
    assert.strictEqual(isNonSubstantive('不知道'), true);
  });

  it('flags 不清楚 as non-substantive', () => {
    assert.strictEqual(isNonSubstantive('不清楚'), true);
  });

  it('flags 不确定 as non-substantive', () => {
    assert.strictEqual(isNonSubstantive('不确定'), true);
  });

  it('flags 没想法 as non-substantive', () => {
    assert.strictEqual(isNonSubstantive('没想法'), true);
  });

  it('flags 随便 as non-substantive', () => {
    assert.strictEqual(isNonSubstantive('随便'), true);
  });

  it('flags 4-or-fewer-character strings as non-substantive', () => {
    assert.strictEqual(isNonSubstantive('好的'), true);
    assert.strictEqual(isNonSubstantive('嗯'), true);
    assert.strictEqual(isNonSubstantive('OK'), true);
  });

  it('does not flag substantive responses as non-substantive', () => {
    assert.strictEqual(isNonSubstantive('我认为AI会增强创造力'), false);
    assert.strictEqual(isNonSubstantive('摄影术催生了新艺术形式'), false);
  });
});

describe('completedDirectiveRounds (#5 directive round counter)', () => {
  it('returns 0 for a fresh session without interrogation state', () => {
    assert.strictEqual(completedDirectiveRounds(makeSession()), 0);
  });

  it('returns the persisted directiveRound when present', () => {
    const session = makeSession({
      interrogation: { round: 2, strategy: 'M2_premise', assistantQuestion: 'q', usedFallback: false, pendingCheckpoint: false, uncertainStreak: 0, directiveRound: 2 },
    });
    assert.strictEqual(completedDirectiveRounds(session), 2);
  });

  it('returns 0 for a session with directiveRound explicitly 0', () => {
    const session = makeSession({
      interrogation: { round: 1, strategy: 'M1_evidence', assistantQuestion: 'q', usedFallback: false, pendingCheckpoint: false, uncertainStreak: 0, directiveRound: 0 },
    });
    assert.strictEqual(completedDirectiveRounds(session), 0);
  });
});

describe('shouldSuggestSummary (#5 three-round gate)', () => {
  it('does not suggest summary at directive round 0', () => {
    assert.strictEqual(shouldSuggestSummary(0), false);
  });

  it('suggests summary at directive round 3', () => {
    assert.strictEqual(shouldSuggestSummary(3), true);
  });

  it('suggests summary at directive round 6', () => {
    assert.strictEqual(shouldSuggestSummary(6), true);
  });

  it('does not suggest summary at directive round 1', () => {
    assert.strictEqual(shouldSuggestSummary(1), false);
  });

  it('does not suggest summary at directive round 2', () => {
    assert.strictEqual(shouldSuggestSummary(2), false);
  });

  it('does not suggest summary at directive round 4', () => {
    assert.strictEqual(shouldSuggestSummary(4), false);
  });

  it('does not suggest summary at directive round 5', () => {
    assert.strictEqual(shouldSuggestSummary(5), false);
  });
});

describe('generateGentleResponse (#5 response generator)', () => {
  const sessionWithViewpoint = makeSession({
    selectedViewpoint: { id: 'v1', text: '我认为AI会增强而非取代创造力', source: 'ai_suggested_and_selected' },
  });

  describe('question intent', () => {
    it('returns aiReply and followUp for a question input', () => {
      const result = generateGentleResponse('你能举个例子吗？', sessionWithViewpoint, 'M1_evidence');
      assert.strictEqual(result.intent, 'question');
      assert.ok(result.aiReply && result.aiReply.length > 0, 'aiReply must not be empty for questions');
      assert.ok(result.followUp && result.followUp.length > 0, 'followUp must not be empty for questions');
      assert.strictEqual(result.directiveRound, 0, 'questions must not advance directive round');
      assert.strictEqual(result.suggestSummary, false);
    });

    it('does not advance directive round for a question', () => {
      const session = makeSession({
        interrogation: { round: 1, strategy: 'M1_evidence', assistantQuestion: 'q', usedFallback: false, pendingCheckpoint: false, uncertainStreak: 0, directiveRound: 1 },
      });
      const result = generateGentleResponse('为什么？', session, 'M1_evidence');
      assert.strictEqual(result.intent, 'question');
      assert.strictEqual(result.directiveRound, 1, 'directive round must not change for questions');
    });

    it('includes the selected viewpoint in the direct answer', () => {
      const result = generateGentleResponse('你能详细说明吗？', sessionWithViewpoint, 'M1_evidence');
      assert.ok(
        result.aiReply!.includes('AI会增强而非取代创造力'),
        `aiReply must reference the selected viewpoint, got: ${result.aiReply}`
      );
    });
  });

  describe('response intent — substantive', () => {
    it('returns aiReply and followUp for a substantive response', () => {
      const result = generateGentleResponse(
        '我认为AI会增强而非取代创造力，因为摄影术催生了新艺术。',
        sessionWithViewpoint,
        'M1_evidence'
      );
      assert.strictEqual(result.intent, 'response');
      assert.ok(result.aiReply && result.aiReply.length > 0, 'aiReply must not be empty');
      assert.ok(result.followUp && result.followUp.length > 0, 'followUp must not be empty');
    });

    it('advances directive round for a substantive response', () => {
      const session = makeSession({
        interrogation: { round: 1, strategy: 'M1_evidence', assistantQuestion: 'q', usedFallback: false, pendingCheckpoint: false, uncertainStreak: 0, directiveRound: 0 },
      });
      const result = generateGentleResponse(
        '我认为AI会增强而非取代创造力。',
        session,
        'M1_evidence'
      );
      assert.strictEqual(result.directiveRound, 1);
    });

    it('suggests summary at directive round 3', () => {
      const session = makeSession({
        interrogation: { round: 3, strategy: 'M4_steelman', assistantQuestion: 'q', usedFallback: false, pendingCheckpoint: false, uncertainStreak: 0, directiveRound: 2 },
      });
      const result = generateGentleResponse(
        '我的第三轮实质性回答，包含具体数据与例子。',
        session,
        'M4_steelman'
      );
      assert.strictEqual(result.directiveRound, 3);
      assert.strictEqual(result.suggestSummary, true);
      // The follow-up is still generated (summary gate is a non-blocking UI
      // suggestion alongside the next question, not a replacement).
      assert.ok(result.followUp && result.followUp.length > 0);
    });

    it('does not suggest summary at directive round 2', () => {
      const session = makeSession({
        interrogation: { round: 2, strategy: 'M2_premise', assistantQuestion: 'q', usedFallback: false, pendingCheckpoint: false, uncertainStreak: 0, directiveRound: 1 },
      });
      const result = generateGentleResponse(
        '我的第二轮实质性回答。',
        session,
        'M2_premise'
      );
      assert.strictEqual(result.directiveRound, 2);
      assert.strictEqual(result.suggestSummary, false);
      assert.ok(result.followUp && result.followUp.length > 0);
    });
  });

  describe('response intent — non-substantive', () => {
    it('returns followUp without aiReply for non-substantive response', () => {
      const session = makeSession({
        interrogation: { round: 1, strategy: 'M1_evidence', assistantQuestion: 'q', usedFallback: false, pendingCheckpoint: false, uncertainStreak: 0, directiveRound: 0 },
      });
      const result = generateGentleResponse('不知道', session, 'M1_evidence');
      assert.strictEqual(result.intent, 'response');
      assert.strictEqual(result.aiReply, null, 'non-substantive responses get no aiReply');
      assert.ok(result.followUp && result.followUp.length > 0);
      assert.strictEqual(result.directiveRound, 0, 'non-substantive responses must not advance directive round');
    });

    it('does not advance directive round for non-substantive responses', () => {
      const session = makeSession({
        interrogation: { round: 1, strategy: 'M1_evidence', assistantQuestion: 'q', usedFallback: false, pendingCheckpoint: false, uncertainStreak: 0, directiveRound: 1 },
      });
      const result = generateGentleResponse('不清楚', session, 'M1_evidence');
      assert.strictEqual(result.directiveRound, 1, 'directive round must not advance for non-substantive');
    });
  });

  describe('LLM degradation', () => {
    it('prepends degradation notice when LLM is unavailable', () => {
      const result = generateGentleResponse(
        '我认为AI会增强而非取代创造力。',
        sessionWithViewpoint,
        'M1_evidence',
        false // llmAvailable = false
      );
      assert.ok(
        result.aiReply!.includes('策略模板降级'),
        `aiReply must disclose degradation, got: ${result.aiReply}`
      );
    });
  });
});
