// LLM fallback wrapper for ticket #10.
// Retries once on failure, then uses strategy template.
// Tracks fallback events for observability.

import { STRATEGIES, type StrategyId } from './strategy-engine';
import type { Session } from './providers';

export interface FallbackEvent {
  type: 'retry' | 'template' | 'success';
  strategy: StrategyId;
  attempts: number;
  error?: string;
  timestamp: number;
}

export interface FallbackResult {
  question: string;
  usedFallback: boolean;
  events: FallbackEvent[];
}

const UNCERTAIN_PATTERNS = [
  /^不知道/,
  /^不清楚/,
  /^不确定/,
  /^不明白/,
  /不知道/,
  /不清楚/,
  /不确定/,
];

export function isUncertainAnswer(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 2) return true;
  return UNCERTAIN_PATTERNS.some((p) => p.test(trimmed));
}

export interface UncertainResponse {
  level: 0 | 1 | 2 | 3;
  message: string;
  hint?: string[];
}

const PROMPTS: Record<0 | 1 | 2 | 3, (session: Session) => UncertainResponse> = {
  0: () => ({ level: 0, message: '' }),
  1: (s) => ({
    level: 1,
    message: `让我们把问题缩小一些。能否举一个具体的小例子来帮助理解"${s.question}"？`,
  }),
  2: (s) => ({
    level: 2,
    message: '这里有两个思考方向供你参考：',
    hint: [
      '方向 A：从你的个人经验出发，描述你曾经遇到的具体情形。',
      '方向 B：参考报告中提到的某个来源，看看该来源的核心论点是否启发了你。',
    ],
  }),
  3: () => ({
    level: 3,
    message: '看起来这个话题目前对你来说确实有难度。建议结束本次诘问并生成成果卡。',
  }),
};

/** Determine response for consecutive uncertain answers. */
export function uncertainResponse(uncertainStreak: number, session: Session): UncertainResponse {
  if (uncertainStreak <= 0) return PROMPTS[0](session);
  if (uncertainStreak === 1) return PROMPTS[1](session);
  if (uncertainStreak === 2) return PROMPTS[2](session);
  return PROMPTS[3](session);
}

/**
 * Wrap an LLM question generator with: retry once → strategy template fallback.
 * Never throws; always returns a question string.
 */
export async function withFallback(
  strategy: StrategyId,
  session: Session,
  generate: () => Promise<string>,
  onEvent?: (e: FallbackEvent) => void
): Promise<FallbackResult> {
  const events: FallbackEvent[] = [];
  const log = (e: FallbackEvent) => {
    events.push(e);
    onEvent?.(e);
  };

  // Attempt 1
  try {
    const q = await generate();
    if (q && q.trim().length > 0) {
      log({ type: 'success', strategy, attempts: 1, timestamp: Date.now() });
      return { question: q.trim(), usedFallback: false, events };
    }
    throw new Error('empty question');
  } catch (err) {
    log({
      type: 'retry',
      strategy,
      attempts: 1,
      error: err instanceof Error ? err.message : String(err),
      timestamp: Date.now(),
    });
  }

  // Attempt 2 (retry once)
  try {
    const q = await generate();
    if (q && q.trim().length > 0) {
      log({ type: 'success', strategy, attempts: 2, timestamp: Date.now() });
      return { question: q.trim(), usedFallback: false, events };
    }
    throw new Error('empty question on retry');
  } catch (err) {
    log({
      type: 'template',
      strategy,
      attempts: 2,
      error: err instanceof Error ? err.message : String(err),
      timestamp: Date.now(),
    });
  }

  // Fallback to strategy template
  const fallback = STRATEGIES[strategy].fallbackTemplate(session);
  return { question: fallback, usedFallback: true, events };
}
