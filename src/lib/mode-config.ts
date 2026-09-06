// Mode and Orientation Configuration for M1 (#Q-01, #Q-02, #Q-03, #D-03)
//
// Defines shared contracts for Quick, Deep, Fun, and Story modes.
// ModeConfig governs orientation limits, strategy availability, checkpoints,
// and presentation styles without cloning the state machine.

import type { StrategyId } from './strategy-engine';

export type SessionMode = 'quick' | 'deep' | 'fun' | 'story';

export type SessionPhase = 'orientation' | 'transitionChoice' | 'interrogation' | 'completed';

export type QuickTargetId = 'understand_report' | 'clarify_position' | 'weigh_decision' | 'refine_expression';

export type TransitionActionId =
  | 'challenge_claim'
  | 'start_challenge'
  | 'inspect_evidence'
  | 'inspect_counterargument'
  | 'continue_orientation';

export interface TransitionAction {
  id: TransitionActionId;
  title: string;
  label?: string;
  description: string;
  recommended?: boolean;
}

export interface QuickTarget {
  id: QuickTargetId;
  title: string;
  tagline: string;
  description: string;
  recommendedStrategy: StrategyId;
}

export interface ModeConfig {
  mode: SessionMode;
  name: string;
  description: string;
  orientationMaxRounds: number;
  allowedStrategies: StrategyId[];
  checkpointPolicy: {
    frequency: number;
    firstCheckpointRound: number;
  };
  intensityPolicy: {
    allowDirectAnswer: boolean;
    challengeLevel: 'gentle' | 'deep';
  };
  presentationStyle: string;
}

export const TRANSITION_ACTIONS: TransitionAction[] = [
  {
    id: 'challenge_claim',
    title: '开始挑战当前判断',
    label: '开始挑战当前判断',
    description: '进入正式诘问，深入检验观点的逻辑自洽与隐含漏洞。',
    recommended: true,
  },
  {
    id: 'inspect_evidence',
    title: '先检查判断依据',
    label: '先检查判断依据',
    description: '查看报告核心证据链与事实引用，检验论据支撑力度。',
  },
  {
    id: 'inspect_counterargument',
    title: '先理解最强反方',
    label: '先理解最强反方',
    description: '剖析对立立场的核心质疑与反例，评估反驳难度。',
  },
  {
    id: 'continue_orientation',
    title: '继续梳理报告',
    label: '继续梳理报告',
    description: '继续围绕报告进行轻量梳理，澄清背景与核心概念。',
  },
];

export const QUICK_TARGETS: QuickTarget[] = [
  {
    id: 'clarify_position',
    title: '厘清立场',
    tagline: '澄清观点与理由',
    description: '明确自身观点的核心主张，检视支撑事实与未明说的关键假设。',
    recommendedStrategy: 'M1_evidence',
  },
  {
    id: 'weigh_decision',
    title: '权衡决策',
    tagline: '比较收益、代价与前提',
    description: '直面最强对立论据，模拟相反立场，评估真实决策成本。',
    recommendedStrategy: 'M4_steelman',
  },
  {
    id: 'refine_expression',
    title: '推敲表达',
    tagline: '为答辩、写作与沟通打磨',
    description: '激活深度系统二思考，暴露潜在锚定，让论述经得起严苛推敲。',
    recommendedStrategy: 'M5_system2',
  },
];

export const MODE_CONFIGS: Record<SessionMode, ModeConfig> = {
  quick: {
    mode: 'quick',
    name: '快速思辨',
    description: '轻量定向（0–2轮），3–5轮目标导向追问，高效收敛观点。',
    orientationMaxRounds: 2,
    allowedStrategies: ['M1_evidence', 'M2_premise', 'M4_steelman', 'M6_reversal', 'M5_system2'],
    checkpointPolicy: {
      frequency: 3,
      firstCheckpointRound: 3,
    },
    intensityPolicy: {
      allowDirectAnswer: true,
      challengeLevel: 'gentle',
    },
    presentationStyle: 'gentle_dialogue',
  },
  deep: {
    mode: 'deep',
    name: '深度诘问',
    description: '全八策略调度，系统二激活与认知轨迹记录，层层严密推演。',
    orientationMaxRounds: 2,
    allowedStrategies: [
      'M1_evidence',
      'M2_premise',
      'M3_anchoring',
      'M4_steelman',
      'M5_system2',
      'M6_reversal',
      'M7_metacognition',
      'M8_contradiction',
    ],
    checkpointPolicy: {
      frequency: 3,
      firstCheckpointRound: 3,
    },
    intensityPolicy: {
      allowDirectAnswer: true,
      challengeLevel: 'deep',
    },
    presentationStyle: 'socratic_rigorous',
  },
  fun: {
    mode: 'fun',
    name: '趣味模式',
    description: '角色化思辨伙伴（轻松朋友/古风辩友/二次元搭档），生动互动。',
    orientationMaxRounds: 2,
    allowedStrategies: ['M1_evidence', 'M2_premise', 'M4_steelman', 'M6_reversal', 'M5_system2'],
    checkpointPolicy: {
      frequency: 3,
      firstCheckpointRound: 3,
    },
    intensityPolicy: {
      allowDirectAnswer: true,
      challengeLevel: 'gentle',
    },
    presentationStyle: 'character_partner',
  },
  story: {
    mode: 'story',
    name: '情境思辨 (GalGame)',
    description: '基于研报生成情境世界短篇，通过抉择卡沉浸式推演思辨。',
    orientationMaxRounds: 1,
    allowedStrategies: ['M1_evidence', 'M4_steelman', 'M6_reversal'],
    checkpointPolicy: {
      frequency: 3,
      firstCheckpointRound: 3,
    },
    intensityPolicy: {
      allowDirectAnswer: false,
      challengeLevel: 'gentle',
    },
    presentationStyle: 'interactive_story',
  },
};

export function getModeConfig(mode?: SessionMode | null): ModeConfig {
  if (mode && MODE_CONFIGS[mode]) {
    return MODE_CONFIGS[mode];
  }
  return MODE_CONFIGS.quick;
}
