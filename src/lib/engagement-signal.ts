import type { StrategyId } from './strategy-engine';

export type EngagementLevel = 'engaged' | 'wavering' | 'disengaged';
export type AdaptiveQuestionMode = 'standard' | 'scaffolded' | 'deescalated';
/** Session-level questioning pressure. New sessions always begin gently. */
export type QuestioningIntensity = 'gentle' | 'standard' | 'challenging';

export interface EngagementSignal {
  level: EngagementLevel;
  reasons: string[];
}

export interface AdaptiveStrategyDecision {
  strategy: StrategyId;
  mode: AdaptiveQuestionMode;
  signal: EngagementSignal;
}

const AVOIDANCE = /^(不知道|不清楚|没想过|没想法|不确定|随便|都行|你说呢|算了|暂时说不出更多依据|我先不展开了)[。！？!?\s]*$/;

function normalized(text: string): string {
  return text.replace(/\s+/g, '').trim();
}

function weakAnswer(text: string): boolean {
  const clean = normalized(text);
  return clean.length < 20 && AVOIDANCE.test(clean);
}

function detailedAnswer(text: string): boolean {
  const clean = normalized(text);
  return clean.length >= 24 && !AVOIDANCE.test(clean);
}

const INTENSITY_ORDER: QuestioningIntensity[] = ['gentle', 'standard', 'challenging'];

/**
 * Advance one session-level intensity step at most. It is deliberately local
 * and conservative: two concrete answers are required to raise pressure,
 * while any detected hesitation immediately lowers it by one step.
 */
export function nextQuestioningIntensity(
  current: QuestioningIntensity | undefined,
  recentAnswers: string[]
): QuestioningIntensity {
  const intensity = current ?? 'gentle';
  const signal = detectEngagement(recentAnswers);
  const index = INTENSITY_ORDER.indexOf(intensity);
  if (signal.level !== 'engaged') return INTENSITY_ORDER[Math.max(0, index - 1)]!;

  const recent = recentAnswers.map(normalized).filter(Boolean).slice(-2);
  if (recent.length === 2 && recent.every(detailedAnswer)) {
    return INTENSITY_ORDER[Math.min(INTENSITY_ORDER.length - 1, index + 1)]!;
  }
  return intensity;
}

/**
 * Conservative local engagement signal. It can only reduce questioning
 * pressure: normal answers never cause a strategy escalation.
 */
export function detectEngagement(recentAnswers: string[]): EngagementSignal {
  const answers = recentAnswers.map(normalized).filter(Boolean).slice(-3);
  if (answers.length === 0) return { level: 'engaged', reasons: [] };

  const latest = answers[answers.length - 1]!;
  const reasons: string[] = [];
  if (AVOIDANCE.test(latest) && latest.length < 20) reasons.push('avoidance');

  if (answers.length >= 3) {
    const previousAverage = (answers[0]!.length + answers[1]!.length) / 2;
    if (previousAverage >= 20 && latest.length < previousAverage * 0.4) reasons.push('length_drop');
  }
  if (answers.length >= 2 && latest === answers[answers.length - 2]!) reasons.push('repeated_answer');

  const trailingWeak = answers.length >= 2 && answers.slice(-2).every(weakAnswer);
  if (trailingWeak) return { level: 'disengaged', reasons: reasons.length ? reasons : ['repeated_avoidance'] };
  if (reasons.length > 0) return { level: 'wavering', reasons };
  return { level: 'engaged', reasons: [] };
}

export const INTENSITY_FALLBACK: Partial<Record<StrategyId, StrategyId>> = {
  M4_steelman: 'M7_metacognition',
  M6_reversal: 'M3_anchoring',
  M8_contradiction: 'M1_evidence',
};

export function resolveAdaptiveStrategy(
  strategy: StrategyId,
  signal: EngagementSignal
): AdaptiveStrategyDecision {
  if (signal.level === 'disengaged') {
    const fallback = INTENSITY_FALLBACK[strategy];
    if (fallback) return { strategy: fallback, mode: 'deescalated', signal };
  }
  return {
    strategy,
    mode: signal.level === 'wavering' ? 'scaffolded' : 'standard',
    signal,
  };
}

/** A neutral, user-facing scaffold; it never exposes the internal diagnosis. */
export function adaptiveGuidance(mode: AdaptiveQuestionMode): string | null {
  if (mode === 'scaffolded') return '如果一时难以展开，先说一个最接近的例子或直觉即可。';
  if (mode === 'deescalated') return '我们先换一个更容易进入的角度，不必立刻形成完整论证。';
  return null;
}
