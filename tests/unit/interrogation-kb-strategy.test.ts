import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  STRATEGIES,
  STRATEGY_QUESTION_TEMPLATES,
  SOCRATIC_STRATEGY_TEMPLATES,
  getSocraticQuestion,
  getStrategyKnowledgeBaseFramework,
  type StrategyId,
} from '../../src/lib/strategy-engine';
import {
  getKnowledgeBaseItemForStrategy,
  STRATEGY_TO_KB_ITEM_ID,
} from '../../src/lib/knowledge-base/provider';
import { buildInterrogationContext } from '../../src/lib/interrogation-context';
import {
  buildStrategyQuestionMessages,
  assertNonJudgingQuestion,
  isValidQuestionText,
} from '../../src/lib/openai-llm-provider';
import type { Session, Report } from '../../src/lib/providers';

const mockReport: Report = {
  title: 'AI发展对就业结构的影响',
  question: '生成式AI是否会导致结构性失业恶化？',
  content: '关于AI对就业的影响存在岗位替代与新需求创造的两派论证。',
  knowledgePoints: [
    '自动化替代：重复性认知劳动面临被大语言模型快速替代的风险。',
    '技能溢价：具备AI协同能力的复合型人才薪酬与需求增长。',
  ],
  viewpoints: [
    '生成式AI会导致短期结构性失业急剧恶化，社会转型成本高昂。',
    '生成式AI将催生新分工，长期看生产力红利远大于岗位净损失。',
  ],
  references: [
    {
      id: 'ref-1',
      type: 'web',
      author: '经济观察',
      title: '劳动经济学白皮书 2026',
      url: 'https://example.com/ref-1',
      excerpt: '初级白领岗位受生成式工具冲击最显著。',
    },
  ],
  citations: {
    1: {
      id: 'ref-1',
      type: 'web',
      author: '经济观察',
      title: '劳动经济学白皮书 2026',
      url: 'https://example.com/ref-1',
      excerpt: '初级白领岗位受生成式工具冲击最显著。',
    },
  },
};

function createMockSession(): Session {
  return {
    id: 'test-session-kb-1',
    question: mockReport.question,
    initialOpinion: null,
    report: mockReport,
    selectedViewpoint: {
      id: 'vp-1',
      text: '生成式AI会导致短期结构性失业急剧恶化，社会转型成本高昂。',
      source: 'ai_suggested_and_selected',
    },
    messages: [
      {
        id: 'msg-1',
        role: 'assistant',
        text: '你如何看待技术扩散带来的再就业缓冲期？',
        timestamp: 1000,
      },
      {
        id: 'msg-2',
        role: 'user',
        text: '再就业培训通常滞后至少两到三年，弱势群体很难迅速适应转型。',
        timestamp: 2000,
      },
    ],
    resultCard: null,
    completed: false,
    createdAt: 1000,
    updatedAt: 2000,
  };
}

describe('KB-05 / M2: Strategy Engine Knowledge Base Bindings', () => {
  const allStrategies: StrategyId[] = [
    'M1_evidence',
    'M2_premise',
    'M3_anchoring',
    'M4_steelman',
    'M5_system2',
    'M6_reversal',
    'M7_metacognition',
    'M8_contradiction',
    'M5_restate',
  ];

  it('binds every strategy in STRATEGIES to a curated KB item and framework name', () => {
    for (const sid of allStrategies) {
      const strat = STRATEGIES[sid];
      assert.ok(strat, `Strategy ${sid} must exist in STRATEGIES`);
      assert.ok(strat.kbItemId, `Strategy ${sid} must define kbItemId`);
      assert.ok(strat.kbFramework, `Strategy ${sid} must define kbFramework`);

      const kbItem = getKnowledgeBaseItemForStrategy(sid);
      assert.ok(kbItem, `Strategy ${sid} kbItemId ${strat.kbItemId} must resolve to a valid KB item`);
      assert.strictEqual(kbItem?.id, strat.kbItemId);
    }
  });

  it('specifically validates M5_system2 and M6_reversal knowledge bindings', () => {
    const m5 = STRATEGIES['M5_system2'];
    assert.strictEqual(m5.kbItemId, 'domain-unintended-consequences');
    assert.ok(m5.kbFramework?.includes('系统二'));

    const m5Item = getStrategyKnowledgeBaseFramework('M5_system2');
    assert.strictEqual(m5Item?.topic, '复杂系统与意外后果定律');
    assert.ok(m5Item?.summary.includes('非线性反馈'));

    const m6 = STRATEGIES['M6_reversal'];
    assert.strictEqual(m6.kbItemId, 'philo-rawls-veil');
    assert.ok(m6.kbFramework?.includes('无知之幕'));

    const m6Item = getStrategyKnowledgeBaseFramework('M6_reversal');
    assert.strictEqual(m6Item?.topic, '罗尔斯无知之幕与正义论');
    assert.ok(m6Item?.summary.includes('身份'));
    assert.ok(m6Item?.tags.includes('无知之幕'));
  });
});

describe('KB-05 / M2: Socratic Question Templates & Guardrails', () => {
  const allStrategies: StrategyId[] = [
    'M1_evidence',
    'M2_premise',
    'M3_anchoring',
    'M4_steelman',
    'M5_system2',
    'M6_reversal',
    'M7_metacognition',
    'M8_contradiction',
    'M5_restate',
  ];

  it('provides Socratic templates for all strategies that end with question marks', () => {
    for (const sid of allStrategies) {
      const template = SOCRATIC_STRATEGY_TEMPLATES[sid];
      assert.ok(template, `SOCRATIC_STRATEGY_TEMPLATES must contain ${sid}`);
      
      const plain = template.plain.trim();
      assert.ok(plain.length > 10, `Plain question for ${sid} must be substantial`);
      assert.ok(plain.endsWith('？') || plain.endsWith('?'), `Plain question for ${sid} must end with ?`);

      const withClaim = template.withClaim('再就业培训存在明显时滞').trim();
      assert.ok(withClaim.includes('再就业培训存在明显时滞'), `withClaim for ${sid} must quote the claim`);
      assert.ok(withClaim.endsWith('？') || withClaim.endsWith('?'), `withClaim for ${sid} must end with ?`);
    }
  });

  it('verifies getSocraticQuestion helper correctly handles claim and non-claim calls', () => {
    const qWithClaim = getSocraticQuestion('M5_system2', '再就业培训严重脱节');
    assert.ok(qWithClaim.includes('再就业培训严重脱节'));
    assert.ok(qWithClaim.includes('系统二'));

    const qPlain = getSocraticQuestion('M6_reversal', null);
    assert.ok(qPlain.includes('无知之幕'));
    assert.ok(qPlain.endsWith('？'));
  });

  it('strictly satisfies assertNonJudgingQuestion and isValidQuestionText across all templates', () => {
    for (const sid of allStrategies) {
      const plain = getSocraticQuestion(sid, null);
      const withClaim = getSocraticQuestion(sid, '测试主张样本');

      assert.ok(isValidQuestionText(plain), `Plain Socratic question for ${sid} must pass isValidQuestionText`);
      assert.ok(isValidQuestionText(withClaim), `withClaim Socratic question for ${sid} must pass isValidQuestionText`);

      assert.doesNotThrow(() => assertNonJudgingQuestion(plain), `Plain question for ${sid} must not throw non-judging`);
      assert.doesNotThrow(() => assertNonJudgingQuestion(withClaim), `withClaim question for ${sid} must not throw non-judging`);
    }
  });
});

describe('KB-05 / M2: Interrogation Context & LLM Prompt Integration', () => {
  it('enriches InterrogationContext with knowledge base framework', () => {
    const session = createMockSession();
    const ctxM5 = buildInterrogationContext(session, 'M5_system2');
    assert.ok(ctxM5.kbFramework !== null && ctxM5.kbFramework !== undefined);
    assert.strictEqual(ctxM5.kbFramework.id, 'domain-unintended-consequences');

    const ctxM6 = buildInterrogationContext(session, 'M6_reversal');
    assert.ok(ctxM6.kbFramework !== null && ctxM6.kbFramework !== undefined);
    assert.strictEqual(ctxM6.kbFramework.id, 'philo-rawls-veil');
  });

  it('buildStrategyQuestionMessages injects methodology and maintains safety constraints', () => {
    const session = createMockSession();
    const messagesM5 = buildStrategyQuestionMessages('M5_system2', session);

    assert.strictEqual(messagesM5.length, 2);
    const systemMsg = messagesM5[0].content;
    const userMsg = messagesM5[1].content;

    // Check methodology injection
    assert.ok(systemMsg.includes('当前追问策略：系统二激活'));
    assert.ok(systemMsg.includes('【复杂系统与意外后果定律】'));
    assert.ok(systemMsg.includes('追问导向：'));

    // Check safety guardrails still present
    assert.ok(systemMsg.includes('不输出观点裁决、正确性判断或评分'));

    // Check user context
    assert.ok(userMsg.includes('用户选择的立场：生成式AI会导致短期结构性失业急剧恶化'));
    assert.ok(userMsg.includes('用户最新回答：再就业培训通常滞后至少两到三年'));
  });

  it('verifies template degradation fallback retains honest disclosure', () => {
    const session = createMockSession();
    const m5Fallback = STRATEGIES['M5_system2'].fallbackTemplate(session);
    assert.ok(m5Fallback.includes('【策略模板降级】'));
    assert.ok(m5Fallback.includes('再就业培训通常滞后至少两到三年'));

    const m6Fallback = STRATEGIES['M6_reversal'].fallbackTemplate(session);
    assert.ok(m6Fallback.includes('【策略模板降级】'));
    assert.ok(m6Fallback.includes('再就业培训通常滞后至少两到三年'));
  });
});
