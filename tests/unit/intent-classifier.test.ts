// Ticket #26/T5: intent classification and gentle response contract tests.
// Pure functions; no LLM or network required.

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  classifyIntent,
  isNonSubstantive,
  completedDirectiveRounds,
  shouldSuggestSummary,
  generateGentleResponse,
  type UserIntent,
} from '../../src/lib/gentle-interrogation';
import type { Session, Viewpoint } from '../../src/lib/providers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildSession(overrides: Partial<Session> = {}): Session {
  const base: Session = {
    id: 's_test',
    question: 'Test question',
    initialOpinion: null,
    report: null,
    knowledgeGraph: null,
    selectedViewpoint: null,
    messages: [],
    resultCard: null,
    completed: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  return { ...base, ...overrides };
}

function buildViewpoint(text: string): Viewpoint {
  return {
    id: 'vp_test',
    text,
    source: 'user_authored',
    selectedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// classifyIntent
// ---------------------------------------------------------------------------

describe('classifyIntent', () => {
  it('returns "question" for inputs ending with a question mark', () => {
    assert.strictEqual(classifyIntent('什么是热榜缓存？'), 'question');
    assert.strictEqual(classifyIntent('How does this work?'), 'question');
  });

  it('returns "question" for inputs starting with question words', () => {
    assert.strictEqual(classifyIntent('什么是缓存？'), 'question');
    assert.strictEqual(classifyIntent('怎么实现持久化？'), 'question');
    assert.strictEqual(classifyIntent('为什么热榜要缓存？'), 'question');
    assert.strictEqual(classifyIntent('请问能解释一下吗？'), 'question');
  });

  it('returns "response" for substantive answers', () => {
    assert.strictEqual(classifyIntent('我认为热榜缓存可以减少API调用'), 'response');
    assert.strictEqual(classifyIntent('根据材料，缓存可以提升性能'), 'response');
  });

  it('returns "response" for non-substantive inputs', () => {
    assert.strictEqual(classifyIntent('不知道'), 'response');
    assert.strictEqual(classifyIntent('嗯'), 'response');
    assert.strictEqual(classifyIntent('好的'), 'response');
  });
});

// ---------------------------------------------------------------------------
// isNonSubstantive
// ---------------------------------------------------------------------------

describe('isNonSubstantive', () => {
  it('flags known non-substantive inputs', () => {
    assert.strictEqual(isNonSubstantive('不知道'), true);
    assert.strictEqual(isNonSubstantive('不清楚'), true);
    assert.strictEqual(isNonSubstantive('不确定'), true);
    assert.strictEqual(isNonSubstantive('嗯'), true);
    assert.strictEqual(isNonSubstantive('哦'), true);
    assert.strictEqual(isNonSubstantive('好的'), true);
    assert.strictEqual(isNonSubstantive('行'), true);
    assert.strictEqual(isNonSubstantive('可以'), true);
    assert.strictEqual(isNonSubstantive('OK'), true);
    assert.strictEqual(isNonSubstantive('随便'), true);
    assert.strictEqual(isNonSubstantive('都行'), true);
  });

  it('does not flag substantive answers', () => {
    assert.strictEqual(isNonSubstantive('我认为热榜缓存很重要'), false);
    assert.strictEqual(isNonSubstantive('根据我的经验，这很有用'), false);
    assert.strictEqual(isNonSubstantive('我建议采用第一种方案'), false);
  });

  it('does not flag questions', () => {
    assert.strictEqual(isNonSubstantive('什么是缓存？'), false);
    assert.strictEqual(isNonSubstantive('怎么实现？'), false);
  });
});

// ---------------------------------------------------------------------------
// completedDirectiveRounds
// ---------------------------------------------------------------------------

describe('completedDirectiveRounds', () => {
  it('returns 0 for a session with no directiveRound', () => {
    const session = buildSession();
    assert.strictEqual(completedDirectiveRounds(session), 0);
  });

  it('returns the persisted directiveRound when present', () => {
    const session = buildSession({
      interrogation: { directiveRound: 3 } as any,
    });
    assert.strictEqual(completedDirectiveRounds(session), 3);
  });

  it('falls back to round-answer count for legacy sessions', () => {
    const session = buildSession({
      messages: [
        { id: 'm1', role: 'user', text: 'Answer 1', timestamp: Date.now() },
        { id: 'm2', role: 'user', text: 'Answer 2', timestamp: Date.now() },
      ],
    });
    assert.strictEqual(completedDirectiveRounds(session), 2);
  });
});

// ---------------------------------------------------------------------------
// shouldSuggestSummary
// ---------------------------------------------------------------------------

describe('shouldSuggestSummary', () => {
  it('returns false for round 0', () => {
    assert.strictEqual(shouldSuggestSummary(0), false);
  });

  it('returns false for round 1-2', () => {
    assert.strictEqual(shouldSuggestSummary(1), false);
    assert.strictEqual(shouldSuggestSummary(2), false);
  });

  it('returns true after every 3rd directive round', () => {
    assert.strictEqual(shouldSuggestSummary(3), true);
    assert.strictEqual(shouldSuggestSummary(6), true);
    assert.strictEqual(shouldSuggestSummary(9), true);
  });

  it('returns false for non-multiples of 3', () => {
    assert.strictEqual(shouldSuggestSummary(4), false);
    assert.strictEqual(shouldSuggestSummary(5), false);
    assert.strictEqual(shouldSuggestSummary(7), false);
  });
});

// ---------------------------------------------------------------------------
// generateGentleResponse
// ---------------------------------------------------------------------------

describe('generateGentleResponse', () => {
  const strategy: any = 'M1_evidence';

  it('returns aiReply + followUp for questions without advancing directiveRound', () => {
    const session = buildSession({
      selectedViewpoint: buildViewpoint('Test stance'),
    });
    const result = generateGentleResponse('什么是热榜缓存？', session, strategy, true);
    assert.strictEqual(result.intent, 'question');
    assert.ok(result.aiReply && result.aiReply.length > 0);
    assert.ok(result.followUp && result.followUp.length > 0);
    assert.strictEqual(result.directiveRound, 0);
    assert.strictEqual(result.suggestSummary, false);
  });

  it('returns acknowledgment + strategy follow-up for substantive responses', () => {
    const session = buildSession({
      selectedViewpoint: buildViewpoint('Test stance'),
    });
    const result = generateGentleResponse('我认为缓存可以减少API调用', session, strategy, true);
    assert.strictEqual(result.intent, 'response');
    assert.ok(result.aiReply && result.aiReply.length > 0);
    assert.ok(result.followUp && result.followUp.length > 0);
    assert.strictEqual(result.directiveRound, 1);
    assert.strictEqual(result.suggestSummary, false);
  });

  it('does not advance directiveRound for non-substantive responses', () => {
    const session = buildSession();
    const result = generateGentleResponse('不知道', session, strategy, true);
    assert.strictEqual(result.intent, 'response');
    assert.strictEqual(result.aiReply, null);
    assert.ok(result.followUp && result.followUp.length > 0);
    assert.strictEqual(result.directiveRound, 0);
    assert.strictEqual(result.suggestSummary, false);
  });

  it('sets suggestSummary after every 3rd directive round', () => {
    const session = buildSession({
      interrogation: { directiveRound: 2 } as any,
    });
    const result = generateGentleResponse('我认为这很有用', session, strategy, true);
    assert.strictEqual(result.directiveRound, 3);
    assert.strictEqual(result.suggestSummary, true);
  });

  it('includes degradation notice when LLM is unavailable', () => {
    const session = buildSession();
    const result = generateGentleResponse('什么是缓存？', session, strategy, false);
    assert.ok(result.aiReply!.includes('【策略模板降级】'));
  });
});
