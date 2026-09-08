// Interrogation strategy engine for ticket #9.
// Standard mode: 5 rounds covering M1 (evidence) → M2 (premise) → M4 (steel-man) → M6 (reversal) → M5 (restate).
// Checkpoint after round 5, then every 3 rounds (8, 11, 14…).
// Strategy selection is deterministic; LLM only fills in the question text.
// Ticket #16: the question text is context-driven — templates quote a claim
// fragment from the user's input (or selected stance) instead of fixed text.

import type { Session, Message } from './providers';
import { isRoundAnswer } from './providers';
import {
  buildInterrogationContext,
  contextClaimFragment,
  type InterrogationContext,
} from './interrogation-context';
import type { KnowledgeBaseItem } from './knowledge-base/types';
import { getKnowledgeBaseItemForStrategy } from './knowledge-base/provider';

export type StrategyId =
  | 'M1_evidence'
  | 'M2_premise'
  | 'M3_anchoring'
  | 'M4_steelman'
  | 'M5_system2'
  | 'M6_reversal'
  | 'M7_metacognition'
  | 'M8_contradiction'
  | 'M5_restate';

export interface Strategy {
  id: StrategyId;
  name: string;
  description: string;
  /** Curated knowledge base item id mapped to this strategy (#M2). */
  kbItemId?: string;
  /** High-level philosophical/argumentation framework name (#M2). */
  kbFramework?: string;
  /** Allowed at this round given the session state. */
  isApplicable: (session: Session, history: StrategyId[]) => boolean;
  /**
   * Fallback question if LLM fails (#16: context-driven — quotes the user's
   * latest claim and honestly discloses the template degradation). The
   * optional context may be passed by callers that already built one;
   * otherwise it is derived from the session.
   */
  fallbackTemplate: (session: Session, context?: InterrogationContext) => string;
}

/**
 * Interrogative question templates per strategy (#16, #D-01, #D-02). Every
 * template quotes a claim fragment from the user's input and is phrased as
 * a question — never a verdict, never an answer on the user's behalf.
 */
export interface StrategyQuestionTemplate {
  /** Question when no claim fragment is available. */
  plain: string;
  /** Question quoting a claim fragment from the user's input. */
  withClaim: (claim: string) => string;
}

export const STRATEGY_QUESTION_TEMPLATES: Record<StrategyId, StrategyQuestionTemplate> = {
  M1_evidence: {
    plain: '你能给出一个具体的数据或例子来支持你目前的观点吗？',
    withClaim: (claim) => `你提到"${claim}"。这个主张有具体的数据或例子支持吗？`,
  },
  M2_premise: {
    plain: '你的观点背后，是否有一个隐含的前提？如果该前提不成立，你的结论会改变吗？',
    withClaim: (claim) =>
      `你提到"${claim}"。这一说法背后是否有一个隐含的前提？如果该前提不成立，你的结论会改变吗？`,
  },
  M3_anchoring: {
    plain: '我们最初接触的第一印象或初始数据，是否影响了你对这个问题的判断？如果换一个起始基准，结论是否会有所不同？',
    withClaim: (claim) =>
      `你提到"${claim}"。我们最初接触的第一印象或基准数据，是否在无形中锚定了判断？如果换一个参照起点，结论是否不同？`,
  },
  M4_steelman: {
    plain: '请尝试用最强的一种对立观点重新论证。哪种反驳最难回应？',
    withClaim: (claim) =>
      `针对你的说法"${claim}"，请尝试用最强的一种对立观点重新论证。哪种反驳最难回应？`,
  },
  M5_system2: {
    plain: '如果跳出第一直觉，从全局约束、长远连锁影响或多变量权衡的角度，你会如何更严密地审视这一结论？',
    withClaim: (claim) =>
      `结合你指出的"${claim}"，如果跳出第一直觉，从全局约束、长远连锁影响或多变量权衡的角度，你会如何更严密地审视这一结论？`,
  },
  M6_reversal: {
    plain: '如果你必须为相反的立场辩护，你最有力的论据是什么？',
    withClaim: (claim) =>
      `围绕你提到的"${claim}"，如果你必须为相反的立场辩护，你最有力的论据是什么？`,
  },
  M7_metacognition: {
    plain: '回溯一下，你是通过哪些关键信息源、个人经验或思考节点逐步形成这一判断的？如果其中某个支撑点动摇，你的信心会发生什么变化？',
    withClaim: (claim) =>
      `针对你提出的"${claim}"，回溯一下，你是通过哪些关键信息源或思考节点形成这一判断的？如果其中某个支撑点动摇，你的信心会发生什么变化？`,
  },
  M8_contradiction: {
    plain: '对比讨论中出现的不同维度判断，似乎存在一些潜在的张力或不兼容处。你觉得这两者之间应当如何协调？',
    withClaim: (claim) =>
      `对比讨论中先前的阐述与你提到的"${claim}"，似乎存在一些潜在的张力或不兼容处。你觉得这两者之间应当如何协调？`,
  },
  M5_restate: {
    plain: '基于以上讨论，你能用一两句话重新表述你当前的观点吗？',
    withClaim: (claim) =>
      `结合你提到的"${claim}"，你能用一两句话重新表述你当前的观点吗？`,
  },
};

/**
 * Socratic question templates grounded in classical philosophy, debate models,
 * and cognitive fallacy discernment (#M2, KB-05).
 */
export const SOCRATIC_STRATEGY_TEMPLATES: Record<StrategyId, StrategyQuestionTemplate> = {
  M1_evidence: {
    plain: '根据举证责任原则，支撑这一判断最核心的观察、数据或事实依据是什么？',
    withClaim: (claim) =>
      `根据举证责任原则，关于"${claim}"，支持它的最核心事实证据或具体观察是什么？`,
  },
  M2_premise: {
    plain: '运用苏格拉底反诘法深入审视：这个论断立足于怎样的深层假设，若该假设在极端情境下动摇，结论又会如何调整？',
    withClaim: (claim) =>
      `运用苏格拉底反诘法深入审视：针对"${claim}"，这一说法立足于怎样的深层假设，若该假设动摇，结论又会如何调整？`,
  },
  M3_anchoring: {
    plain: '反思认知锚定与确认偏误：在这个议题上，你是否优先吸纳了符合预期的证据，而忽略了可能推翻它的矛盾线索？',
    withClaim: (claim) =>
      `反思认知锚定与确认偏误：关于"${claim}"，我们是否优先关注了支持它的线索，而忽略了可能推翻它的矛盾迹象？`,
  },
  M4_steelman: {
    plain: '实践最强反驳原则：站在最理性、最严密的反对者立场，你认为对方能对你的主张提出的最强质疑是什么？',
    withClaim: (claim) =>
      `实践最强反驳原则：针对你提出的"${claim}"，站在最理性且深思熟虑的对立立场，他们能给出的最有力反驳是什么？`,
  },
  M5_system2: {
    plain: '激活系统二审慎思维：跳出即时直觉，从复杂系统的意外后果与长远连锁影响考量，这一主张有哪些边界条件？',
    withClaim: (claim) =>
      `激活系统二审慎思维：跳出即时直觉，针对"${claim}"，在复杂系统的意外后果与多变量权衡下，它是否存在隐性代价？`,
  },
  M6_reversal: {
    plain: '置于罗尔斯无知之幕后重新审视：如果不预设自身所处的利益或立场，为完全相反的观点辩护，最站得住脚的理由是什么？',
    withClaim: (claim) =>
      `置于罗尔斯无知之幕后重新审视：关于"${claim}"，如果不预设原有立场，站在受该论断冲击最大的视角，你会如何辩护相反观点？`,
  },
  M7_metacognition: {
    plain: '依循笛卡尔方法怀疑溯源：这一观点是基于哪些关键信息源或推导节点形成的，其中最容易受到质疑的环节是什么？',
    withClaim: (claim) =>
      `依循笛卡尔方法怀疑溯源：针对"${claim}"，这个判断是基于哪些关键信息源逐步建立的，其中最脆弱的推导环节是什么？`,
  },
  M8_contradiction: {
    plain: '运用黑格尔辩证矛盾分析：讨论中出现的不同维度之间是否存在内在张力，这两者如何在更高层次的命题中达成综合？',
    withClaim: (claim) =>
      `运用黑格尔辩证矛盾分析：对比前后观点与你提到的"${claim}"，它们之间的张力究竟源于何处，能否在更高维度完成综合？`,
  },
  M5_restate: {
    plain: '参照图尔敏论证模型：在历经推演审视后，请明确你的主张（Claim）与限定条件（Qualifier），重新凝练你当前的立场？',
    withClaim: (claim) =>
      `参照图尔敏论证模型：在历经多轮思辨后，结合你提到的"${claim}"与必要的限定条件，你能重新凝练现在的最终立场吗？`,
  },
};

/**
 * Retrieve the Socratic probing question for a given strategy, quoting the user's claim if available.
 */
export function getSocraticQuestion(strategy: StrategyId, claim?: string | null): string {
  const template = SOCRATIC_STRATEGY_TEMPLATES[strategy];
  if (!template) {
    const fallback = STRATEGY_QUESTION_TEMPLATES[strategy];
    return claim ? fallback.withClaim(claim) : fallback.plain;
  }
  return claim ? template.withClaim(claim) : template.plain;
}

/**
 * Retrieve the curated knowledge base framework mapped to a strategy.
 */
export function getStrategyKnowledgeBaseFramework(strategy: StrategyId): KnowledgeBaseItem | null {
  return getKnowledgeBaseItemForStrategy(strategy);
}

/** Honest degradation notice prepended to every strategy-template question. */
const TEMPLATE_FALLBACK_DISCLOSURE =
  '【策略模板降级】AI 服务暂不可用，本问句由策略模板生成，未结合完整对话与报告证据。';

/**
 * Build the context-driven fallback question for a strategy: quote the
 * user's latest claim deterministically and disclose that this question
 * comes from the strategy template, not the LLM (#16 honest degradation).
 */
function templateQuestion(
  session: Session,
  context: InterrogationContext | undefined,
  strategy: StrategyId
): string {
  const claim = contextClaimFragment(context ?? buildInterrogationContext(session, strategy));
  const template = STRATEGY_QUESTION_TEMPLATES[strategy];
  return `${TEMPLATE_FALLBACK_DISCLOSURE}${claim ? template.withClaim(claim) : template.plain}`;
}

// #17: the round count only counts round-advancing answers — uncertain
// inputs stay in the current round and are never counted here.
const roundCount = (session: Session): number =>
  session.messages.filter(isRoundAnswer).length;

const strategyHistory = (session: Session): StrategyId[] => {
  // For MVP, use session messages to derive strategy history if not stored
  // (a real implementation would persist each strategy id in the message metadata)
  return ((session as unknown as { _strategyHistory?: StrategyId[] })._strategyHistory) ?? [];
};

/** Pure: pick the next strategy based on round number, mode, target, and history. */
export function pickNextStrategy(session: Session, directiveRound?: number): StrategyId {
  // #5: when a directiveRound is provided (gentle interrogation), use it
  // instead of the message-based round count so strategy selection follows
  // the user's substantive responses, not every input.
  const round = directiveRound !== undefined ? directiveRound + 1 : roundCount(session) + 1;
  const history = strategyHistory(session);

  // #Q-02 / #D-02: Mode and target aware planned sequence
  let planned: StrategyId[] = [
    'M1_evidence', // 1. evidence
    'M2_premise',  // 2. premise
    'M4_steelman', // 3. steel-man
    'M6_reversal', // 4. reversal
    'M5_restate',  // 5. restate
  ];

  if (session.mode === 'deep') {
    planned = [
      'M1_evidence',
      'M2_premise',
      'M3_anchoring',
      'M4_steelman',
      'M5_system2',
      'M6_reversal',
      'M7_metacognition',
      'M8_contradiction',
    ];
  } else if (session.target === 'clarify_position') {
    planned = ['M1_evidence', 'M2_premise', 'M4_steelman', 'M6_reversal', 'M5_system2'];
  } else if (session.target === 'weigh_decision') {
    planned = ['M4_steelman', 'M6_reversal', 'M1_evidence', 'M2_premise', 'M5_system2'];
  } else if (session.target === 'refine_expression') {
    planned = ['M5_system2', 'M3_anchoring', 'M2_premise', 'M4_steelman', 'M1_evidence'];
  }

  if (round <= planned.length) {
    return planned[round - 1]!;
  }

  // After planned sequence: rotate strategies, avoiding immediate repeats
  const fallbackOrder: StrategyId[] =
    session.mode === 'deep'
      ? [
          'M1_evidence',
          'M2_premise',
          'M3_anchoring',
          'M4_steelman',
          'M5_system2',
          'M6_reversal',
          'M7_metacognition',
          'M8_contradiction',
        ]
      : ['M1_evidence', 'M2_premise', 'M4_steelman', 'M6_reversal', 'M5_system2'];

  const last = history[history.length - 1];
  for (const s of fallbackOrder) {
    if (s !== last) return s;
  }
  return 'M1_evidence';
}

export const STRATEGIES: Record<StrategyId, Strategy> = {
  M1_evidence: {
    id: 'M1_evidence',
    name: '证据追问',
    description: '要求具体的数据或例子',
    kbItemId: 'debate-burden-of-proof',
    kbFramework: '举证责任原则',
    isApplicable: () => true,
    fallbackTemplate: (s, ctx) => templateQuestion(s, ctx, 'M1_evidence'),
  },
  M2_premise: {
    id: 'M2_premise',
    name: '前提追问',
    description: '揭示未明说的前提假设',
    kbItemId: 'philo-socratic-elenchus',
    kbFramework: '苏格拉底反诘法',
    isApplicable: () => true,
    fallbackTemplate: (s, ctx) => templateQuestion(s, ctx, 'M2_premise'),
  },
  M3_anchoring: {
    id: 'M3_anchoring',
    name: '锚定揭露',
    description: '反思初始参考基准与先入为主',
    kbItemId: 'logic-confirmation-bias',
    kbFramework: '确认偏误与认知锚定',
    isApplicable: () => true,
    fallbackTemplate: (s, ctx) => templateQuestion(s, ctx, 'M3_anchoring'),
  },
  M4_steelman: {
    id: 'M4_steelman',
    name: '钢铁人反驳',
    description: '面对对方最强论点',
    kbItemId: 'debate-steelmanning',
    kbFramework: '最强反驳/Steelmanning',
    isApplicable: () => true,
    fallbackTemplate: (s, ctx) => templateQuestion(s, ctx, 'M4_steelman'),
  },
  M5_system2: {
    id: 'M5_system2',
    name: '系统二激活',
    description: '跳出直觉，长远约束与多变量权衡',
    kbItemId: 'domain-unintended-consequences',
    kbFramework: '意外后果法则与系统二审慎',
    isApplicable: () => true,
    fallbackTemplate: (s, ctx) => templateQuestion(s, ctx, 'M5_system2'),
  },
  M6_reversal: {
    id: 'M6_reversal',
    name: '立场反转',
    description: '从对立立场重新论证',
    kbItemId: 'philo-rawls-veil',
    kbFramework: '罗尔斯无知之幕与视角转换',
    isApplicable: () => true,
    fallbackTemplate: (s, ctx) => templateQuestion(s, ctx, 'M6_reversal'),
  },
  M7_metacognition: {
    id: 'M7_metacognition',
    name: '元认知溯源',
    description: '追溯观点形成的信息源与思考节点',
    kbItemId: 'philo-cartesian-doubt',
    kbFramework: '笛卡尔方法怀疑与元认知',
    isApplicable: () => true,
    fallbackTemplate: (s, ctx) => templateQuestion(s, ctx, 'M7_metacognition'),
  },
  M8_contradiction: {
    id: 'M8_contradiction',
    name: '内部矛盾核验',
    description: '对照前后潜在张力与不一致',
    kbItemId: 'philo-hegel-dialectic',
    kbFramework: '黑格尔辩证矛盾与综合',
    isApplicable: () => true,
    fallbackTemplate: (s, ctx) => templateQuestion(s, ctx, 'M8_contradiction'),
  },
  M5_restate: {
    id: 'M5_restate',
    name: '观点重述',
    description: '重新表述当前观点',
    kbItemId: 'debate-toulmin-model',
    kbFramework: '图尔敏论证六要素模型',
    isApplicable: () => true,
    fallbackTemplate: (s, ctx) => templateQuestion(s, ctx, 'M5_restate'),
  },
};

/** Round numbers at which a checkpoint should be offered. */
export function isCheckpointRound(round: number): boolean {
  return round === 5 || (round > 5 && (round - 5) % 3 === 0);
}

// ---------------------------------------------------------------------------
// Ticket #14: five-round state machine helpers.
// The checkpoint decision appears AFTER the user answers a checkpoint round
// (5, 8, 11, 14…), not when the question of that round is asked.
// ---------------------------------------------------------------------------

/** What should happen after the user answers `justAnsweredRound`. */
export type AfterAnswerAction = 'checkpoint' | 'next_round';

export function actionAfterAnswer(justAnsweredRound: number): AfterAnswerAction {
  return isCheckpointRound(justAnsweredRound) ? 'checkpoint' : 'next_round';
}

export interface ResumePlan {
  action: AfterAnswerAction;
  /** Number of user answers already preserved in the session. */
  answeredRounds: number;
}

/**
 * How a restored (e.g. after refresh) session should resume: a session whose
 * last answered round is a checkpoint round resumes at the checkpoint
 * decision; otherwise it resumes by planning the next round's question.
 */
export function resumePlan(session: Session): ResumePlan {
  // #17: only round-advancing answers count (uncertain inputs stay in round).
  const answeredRounds = session.messages.filter(isRoundAnswer).length;
  return { action: actionAfterAnswer(answeredRounds), answeredRounds };
}

/** Record a strategy on the session for future picks. */
export function recordStrategy(session: Session, strategy: StrategyId): Session {
  const history = strategyHistory(session);
  (session as unknown as { _strategyHistory?: StrategyId[] })._strategyHistory = [
    ...history,
    strategy,
  ];
  return session;
}

// Ticket #18 dead-code cleanup: `InterrogationResult` and `planNextRound`
// were removed — since #15 the orchestration API (interrogation-orchestrator)
// owns round planning with its own planner, so this session-level planner had
// zero production callers (only its own tests referenced it).
