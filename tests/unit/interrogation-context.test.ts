// Ticket #16: unit tests for the structured interrogation context —
// deterministic claim extraction, context construction, evidence-source
// selection, and the context-driven fixture question behavior/guardrails.
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  buildInterrogationContext,
  contextClaimFragment,
  extractClaimFragment,
  selectRoundSources,
} from '../../src/lib/interrogation-context';
import { FixtureLLMProvider } from '../../src/lib/fixture-providers';
import type { Message, Session, Source, Viewpoint } from '../../src/lib/providers';
import type { StrategyId } from '../../src/lib/strategy-engine';

const STANCE: Viewpoint = {
  id: 'v1',
  text: '我认为AI会增强而非取代创造力',
  source: 'ai_suggested_and_selected',
};

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 's_ctx',
    question: '测试问题：这个观点的依据是什么？',
    initialOpinion: null,
    report: null,
    selectedViewpoint: null,
    messages: [],
    resultCard: null,
    completed: false,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function userMessage(text: string, timestamp: number): Message {
  return { id: `u_${timestamp}`, role: 'user', text, timestamp };
}

const source = (id: string, url: string | null): Source => ({
  id,
  type: 'zhihu',
  author: null,
  title: `标题 ${id}`,
  url,
  excerpt: null,
});

describe('extractClaimFragment (#16 deterministic claim extraction)', () => {
  it('returns a single-sentence answer verbatim without trailing punctuation', () => {
    assert.strictEqual(
      extractClaimFragment('远程工作减少通勤时间。'),
      '远程工作减少通勤时间'
    );
  });

  it('picks the longest sentence from a multi-sentence answer', () => {
    const fragment = extractClaimFragment(
      '远程工作减少通勤时间。它还提升了员工的自主权与幸福感，这是许多团队此前忽视的一点。'
    );
    assert.strictEqual(fragment, '它还提升了员工的自主权与幸福感，这是许多团队此前忽视的一点');
  });

  it('breaks ties by keeping the earliest sentence', () => {
    assert.strictEqual(extractClaimFragment('第一句一样长。第二句一样长。'), '第一句一样长');
  });

  it('truncates overly long sentences deterministically with an ellipsis', () => {
    const long = '这'.repeat(80);
    const fragment = extractClaimFragment(long);
    assert.ok(fragment !== null);
    assert.strictEqual(fragment.length, 51); // 50 chars + ellipsis
    assert.ok(fragment.endsWith('…'));
  });

  it('returns null for empty or whitespace-only text', () => {
    assert.strictEqual(extractClaimFragment(''), null);
    assert.strictEqual(extractClaimFragment('   \n  '), null);
  });
});

describe('buildInterrogationContext (#16 structured context)', () => {
  it('derives round 1 with the stance claim and no last answer', () => {
    const session = makeSession({ selectedViewpoint: STANCE });
    const ctx = buildInterrogationContext(session, 'M1_evidence');
    assert.strictEqual(ctx.round, 1);
    assert.strictEqual(ctx.strategy, 'M1_evidence');
    assert.deepStrictEqual(ctx.stance, { text: STANCE.text, source: STANCE.source });
    assert.strictEqual(ctx.lastAnswer, null);
    assert.deepStrictEqual(ctx.citations, []);
    assert.strictEqual(ctx.question, '测试问题：这个观点的依据是什么？');
  });

  it('uses the most recent user answer as lastAnswer and counts the round', () => {
    const session = makeSession({
      selectedViewpoint: STANCE,
      messages: [
        { id: 'a0', role: 'assistant', text: 'q1', timestamp: 1 },
        userMessage('第一个回答', 2),
        { id: 'a1', role: 'assistant', text: 'q2', timestamp: 3 },
        userMessage('第二个回答', 4),
      ],
    });
    const ctx = buildInterrogationContext(session, 'M2_premise');
    assert.strictEqual(ctx.round, 3);
    assert.strictEqual(ctx.lastAnswer, '第二个回答');
  });

  it('lists all citations in ascending citation-number order', () => {
    const s1 = source('src_1', 'https://example.com/1');
    const s2 = source('src_2', null);
    const session = makeSession({
      report: {
        question: 'q',
        title: 't',
        knowledgePoints: [],
        content: 'c',
        viewpoints: [],
        references: [s1, s2],
        citations: { 2: s2, 1: s1 },
      },
    });
    const ctx = buildInterrogationContext(session, 'M1_evidence');
    assert.deepStrictEqual(ctx.citations, [
      { index: 1, source: s1 },
      { index: 2, source: s2 },
    ]);
  });
});

describe('contextClaimFragment (#16 claim selection)', () => {
  it('prefers the user answer over the stance', () => {
    const ctx = buildInterrogationContext(
      makeSession({ selectedViewpoint: STANCE, messages: [userMessage('远程工作减少通勤时间', 1)] }),
      'M1_evidence'
    );
    assert.strictEqual(contextClaimFragment(ctx), '远程工作减少通勤时间');
  });

  it('falls back to the stance for round 1', () => {
    const ctx = buildInterrogationContext(makeSession({ selectedViewpoint: STANCE }), 'M1_evidence');
    assert.strictEqual(contextClaimFragment(ctx), STANCE.text);
  });

  it('returns null when neither answer nor stance exists', () => {
    assert.strictEqual(contextClaimFragment(buildInterrogationContext(makeSession(), 'M1_evidence')), null);
  });
});

describe('selectRoundSources (#16 deterministic evidence selection)', () => {
  it('takes the first limit citations with a usable URL, in citation order, skipping url-less ones', () => {
    const s1 = source('src_1', 'https://example.com/1');
    const s2 = source('src_2', 'https://example.com/2');
    const s3 = source('src_3', null); // no URL — never selectable as a link
    const s4 = source('src_4', 'https://example.com/4');
    const s5 = source('src_5', 'https://example.com/5');
    const session = makeSession({
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
    const selected = selectRoundSources(session, 3);
    assert.deepStrictEqual(selected, [
      { index: 1, source: s1 },
      { index: 2, source: s2 },
      { index: 4, source: s4 },
    ]);
  });

  it('passes the exact citation objects through (no re-created sources)', () => {
    const s1 = source('src_1', 'https://example.com/1');
    const session = makeSession({
      report: {
        question: 'q',
        title: 't',
        knowledgePoints: [],
        content: 'c',
        viewpoints: [],
        references: [s1],
        citations: { 1: s1 },
      },
    });
    const selected = selectRoundSources(session);
    assert.strictEqual(selected[0]!.source, session.report!.citations[1]);
  });

  it('returns an empty list when the report has no citations', () => {
    assert.deepStrictEqual(selectRoundSources(makeSession()), []);
    assert.deepStrictEqual(selectRoundSources(makeSession({ report: null })), []);
  });
});

describe('FixtureLLMProvider context-driven questions (#16)', () => {
  const STRATEGY_SEQUENCE: StrategyId[] = [
    'M1_evidence',
    'M2_premise',
    'M4_steelman',
    'M6_reversal',
    'M5_restate',
  ];
  const provider = new FixtureLLMProvider();

  it('round 1 quotes the selected stance instead of returning fixed text', async () => {
    const session = makeSession({ selectedViewpoint: STANCE });
    const q = await provider.generateStrategyQuestion('M1_evidence', session);
    assert.ok(q.includes(STANCE.text), `question must quote the stance, got: ${q}`);
    assert.notStrictEqual(q, '你能提供一个具体的数据或例子来支持这个观点吗？');
    assert.notStrictEqual(q, '第 1 轮：请进一步阐述你的观点。');
  });

  it('quotes a claim fragment from the user\'s latest answer', async () => {
    const session = makeSession({
      selectedViewpoint: STANCE,
      messages: [userMessage('远程工作减少通勤时间，并提升员工的自主权。', 1)],
    });
    const q = await provider.generateStrategyQuestion('M2_premise', session);
    assert.ok(
      q.includes('远程工作减少通勤时间'),
      `question must quote the answer's claim, got: ${q}`
    );
  });

  it('different user answers produce different questions for the same strategy', async () => {
    const base: Partial<Session> = { selectedViewpoint: STANCE };
    const a = await provider.generateStrategyQuestion(
      'M1_evidence',
      makeSession({ ...base, messages: [userMessage('远程工作减少通勤时间。', 1)] })
    );
    const b = await provider.generateStrategyQuestion(
      'M1_evidence',
      makeSession({ ...base, messages: [userMessage('AI工具让创作门槛大幅降低。', 1)] })
    );
    assert.notStrictEqual(a, b);
    assert.ok(a.includes('远程工作减少通勤时间'));
    assert.ok(b.includes('AI工具让创作门槛大幅降低'));
  });

  it('each strategy keeps its interrogative intent', async () => {
    const session = makeSession({
      selectedViewpoint: STANCE,
      messages: [userMessage('一个具体的主张', 1)],
    });
    const expectedPhrases: Record<StrategyId, string> = {
      M1_evidence: '具体的数据或例子',
      M2_premise: '隐含的前提',
      M3_anchoring: '最初吸引你的事实',
      M4_steelman: '对立观点重新论证',
      M5_system2: '系统二激活',
      M6_reversal: '相反的立场辩护',
      M7_metacognition: '元认知',
      M8_contradiction: '冲突',
      M5_restate: '重新表述你当前的观点',
    };
    for (const strategy of STRATEGY_SEQUENCE) {
      const q = await provider.generateStrategyQuestion(strategy, session);
      assert.ok(
        q.includes(expectedPhrases[strategy]),
        `${strategy} question should contain "${expectedPhrases[strategy]}" but was "${q}"`
      );
    }
  });

  it('guardrail: every question ends with a question mark and contains no verdict language', async () => {
    const session = makeSession({
      selectedViewpoint: STANCE,
      messages: [userMessage('一个具体的主张', 1)],
    });
    const forbidden = ['你说得对', '你说错了', '你是对的', '你错了', '显然正确', '显然错误'];
    for (const strategy of STRATEGY_SEQUENCE) {
      const withClaim = await provider.generateStrategyQuestion(strategy, session);
      assert.ok(withClaim.endsWith('？'), `${strategy} question must end with ？: ${withClaim}`);
      for (const phrase of forbidden) {
        assert.ok(!withClaim.includes(phrase), `${strategy} question must not judge: ${withClaim}`);
      }
      const plainSession = makeSession({ selectedViewpoint: STANCE });
      const plain = await provider.generateStrategyQuestion(strategy, plainSession);
      assert.ok(plain.endsWith('？'), `${strategy} plain question must end with ？: ${plain}`);
      for (const phrase of forbidden) {
        assert.ok(!plain.includes(phrase), `${strategy} plain question must not judge: ${plain}`);
      }
    }
  });

  it('is deterministic: identical inputs yield identical questions', async () => {
    const make = () =>
      makeSession({
        selectedViewpoint: STANCE,
        messages: [userMessage('远程工作减少通勤时间。', 1)],
      });
    const a = await provider.generateStrategyQuestion('M2_premise', make());
    const b = await provider.generateStrategyQuestion('M2_premise', make());
    assert.strictEqual(a, b);
  });
});
