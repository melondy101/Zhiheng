// Interrogation strategy engine for ticket #9.
// Standard mode: 5 rounds covering M1 (evidence) → M2 (premise) → M4 (steel-man) → M6 (reversal) → M5 (restate).
// Checkpoint after round 5, then every 3 rounds (8, 11, 14…).
// Strategy selection is deterministic; LLM only fills in the question text.

import type { Session, Message } from './providers';

export type StrategyId = 'M1_evidence' | 'M2_premise' | 'M4_steelman' | 'M6_reversal' | 'M5_restate';

export interface Strategy {
  id: StrategyId;
  name: string;
  description: string;
  /** Allowed at this round given the session state. */
  isApplicable: (session: Session, history: StrategyId[]) => boolean;
  /** Fallback question if LLM fails. */
  fallbackTemplate: (session: Session) => string;
}

const roundCount = (session: Session): number =>
  session.messages.filter((m) => m.role === 'user').length;

const strategyHistory = (session: Session): StrategyId[] => {
  // For MVP, use session messages to derive strategy history if not stored
  // (a real implementation would persist each strategy id in the message metadata)
  return ((session as unknown as { _strategyHistory?: StrategyId[] })._strategyHistory) ?? [];
};

/** Pure: pick the next strategy based on round number and history. */
export function pickNextStrategy(session: Session): StrategyId {
  const round = roundCount(session) + 1; // next round number (1-based)
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
    fallbackTemplate: (s) =>
      `关于"${s.question}"，你能给出一个具体的数据或例子来支持你目前的观点吗？`,
  },
  M2_premise: {
    id: 'M2_premise',
    name: '前提追问',
    description: '揭示未明说的前提假设',
    isApplicable: () => true,
    fallbackTemplate: (s) =>
      `你的观点背后，是否有一个隐含的前提？如果该前提不成立，你的结论会改变吗？`,
  },
  M4_steelman: {
    id: 'M4_steelman',
    name: '钢铁人反驳',
    description: '面对对方最强论点',
    isApplicable: () => true,
    fallbackTemplate: (s) =>
      `请尝试用你认为最强的一种对立观点，重新论证一次。哪种反驳最难回应？`,
  },
  M6_reversal: {
    id: 'M6_reversal',
    name: '立场反转',
    description: '从对立立场重新论证',
    isApplicable: () => true,
    fallbackTemplate: (s) =>
      `如果你必须为相反的立场辩护，你最有力的论据是什么？`,
  },
  M5_restate: {
    id: 'M5_restate',
    name: '观点重述',
    description: '重新表述当前观点',
    isApplicable: () => true,
    fallbackTemplate: (s) =>
      `基于以上讨论，请用一两句话重新表述你当前对"${s.question}"的观点。`,
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
  const answeredRounds = session.messages.filter((m) => m.role === 'user').length;
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

export interface InterrogationResult {
  strategy: StrategyId;
  question: string;
  isCheckpoint: boolean;
  round: number;
}

/** Plan the next round. The LLM is responsible only for filling in the question text. */
export function planNextRound(
  session: Session,
  generateQuestion: (strategy: StrategyId, session: Session) => Promise<string>
): Promise<InterrogationResult> {
  const round = roundCount(session) + 1;
  const strategy = pickNextStrategy(session);
  return generateQuestion(strategy, session).then((q) => ({
    strategy,
    question: q || STRATEGIES[strategy].fallbackTemplate(session),
    isCheckpoint: isCheckpointRound(round),
    round,
  }));
}
