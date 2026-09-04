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

export type StrategyId = 'M1_evidence' | 'M2_premise' | 'M4_steelman' | 'M6_reversal' | 'M5_restate';

export interface Strategy {
  id: StrategyId;
  name: string;
  description: string;
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
 * Interrogative question templates per strategy (#16). Every template quotes
 * a claim fragment from the user's input and is phrased as a question —
 * never a verdict, never an answer on the user's behalf.
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
  M4_steelman: {
    plain: '请尝试用最强的一种对立观点重新论证。哪种反驳最难回应？',
    withClaim: (claim) =>
      `针对你的说法"${claim}"，请尝试用最强的一种对立观点重新论证。哪种反驳最难回应？`,
  },
  M6_reversal: {
    plain: '如果你必须为相反的立场辩护，你最有力的论据是什么？',
    withClaim: (claim) =>
      `围绕你提到的"${claim}"，如果你必须为相反的立场辩护，你最有力的论据是什么？`,
  },
  M5_restate: {
    plain: '基于以上讨论，你能用一两句话重新表述你当前的观点吗？',
    withClaim: (claim) =>
      `结合你提到的"${claim}"，你能用一两句话重新表述你当前的观点吗？`,
  },
};

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

/**
 * Pure: pick the next strategy. By default uses the round-advancing answer
 * count (directive round when the gentle system has set directiveRound on the
 * interrogation state). Pass `directiveRound` explicitly to override (used by
 * the gentle system when the round has been advanced but directiveRound
 * tracks separately).
 */
export function pickNextStrategy(session: Session, directiveRound?: number): StrategyId {
  const round = directiveRound !== undefined
    ? directiveRound + 1
    : roundCount(session) + 1; // next round number (1-based)
  const history = strategyHistory(session);

  // Round-by-round planned sequence
  const planned: StrategyId[] = [
    'M1_evidence', // 1. evidence
    'M2_premise',  // 2. premise
    'M4_steelman', // 3. steel-man
    'M6_reversal', // 4. reversal
    'M5_restate',  // 5. restate
  ];

  if (round <= planned.length) {
    return planned[round - 1]!;
  }

  // After round 5: rotate strategies, avoiding immediate repeats
  const fallbackOrder: StrategyId[] = ['M1_evidence', 'M2_premise', 'M4_steelman', 'M6_reversal'];
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
    isApplicable: () => true,
    fallbackTemplate: (s, ctx) => templateQuestion(s, ctx, 'M1_evidence'),
  },
  M2_premise: {
    id: 'M2_premise',
    name: '前提追问',
    description: '揭示未明说的前提假设',
    isApplicable: () => true,
    fallbackTemplate: (s, ctx) => templateQuestion(s, ctx, 'M2_premise'),
  },
  M4_steelman: {
    id: 'M4_steelman',
    name: '钢铁人反驳',
    description: '面对对方最强论点',
    isApplicable: () => true,
    fallbackTemplate: (s, ctx) => templateQuestion(s, ctx, 'M4_steelman'),
  },
  M6_reversal: {
    id: 'M6_reversal',
    name: '立场反转',
    description: '从对立立场重新论证',
    isApplicable: () => true,
    fallbackTemplate: (s, ctx) => templateQuestion(s, ctx, 'M6_reversal'),
  },
  M5_restate: {
    id: 'M5_restate',
    name: '观点重述',
    description: '重新表述当前观点',
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
