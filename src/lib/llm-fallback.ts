// LLM fallback wrapper for ticket #10.
// Retries once on failure, then uses strategy template.
// Tracks fallback events for observability.

import { STRATEGIES, type StrategyId } from './strategy-engine';
import type { Session } from './providers';
import { extractClaimFragment, selectRoundSources } from './interrogation-context';

export interface FallbackEvent {
  type: 'retry' | 'template' | 'success';
  strategy: StrategyId;
  attempts: number;
  error?: string;
  reason?: LLMFailureReason;
  timestamp: number;
}

/** Stable, user-safe classification for a failed LLM attempt. */
export type LLMFailureReason = 'timeout' | 'network' | 'http' | 'invalid_response' | 'invalid_synthesis' | 'unknown';

export class LLMRequestError extends Error {
  constructor(public readonly reason: LLMFailureReason, message: string) {
    super(message);
    this.name = 'LLMRequestError';
  }
}

export function classifyLLMFailure(error: unknown): LLMFailureReason {
  if (error instanceof LLMRequestError) return error.reason;
  if (error instanceof DOMException && error.name === 'AbortError') return 'timeout';
  if (error instanceof TypeError) return 'network';
  return 'unknown';
}

export interface FallbackResult {
  question: string;
  usedFallback: boolean;
  events: FallbackEvent[];
  failureReason?: LLMFailureReason;
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

type UncertainPromptBuilder = (
  session: Session,
  currentQuestion: string | null
) => UncertainResponse;

/**
 * #17: the focus a narrowing prompt quotes — the current pending question
 * (the one the user could not answer), falling back to the session topic.
 * Deterministic; never invented.
 */
function narrowingFocus(session: Session, currentQuestion: string | null): string {
  return extractClaimFragment(currentQuestion ?? session.question) ?? '当前问题';
}

/**
 * #17: the uncertain responses are context-driven. Level 1 quotes the current
 * question it narrows; level 2 anchors both directions in the current
 * question and, when the report has usable citations, in a real source title.
 */
const PROMPTS: Record<0 | 1 | 2 | 3, UncertainPromptBuilder> = {
  0: () => ({ level: 0, message: '' }),
  1: (s, q) => {
    const focus = narrowingFocus(s, q);
    return {
      level: 1,
      message: `看来这个问题有点宽泛。我们把它缩小一些：能否举一个具体的小例子来帮助理解"${focus}"？`,
    };
  },
  2: (s, q) => {
    const focus = narrowingFocus(s, q);
    const sourceTitle = selectRoundSources(s)[0]?.source.title ?? null;
    return {
      level: 2,
      message: '没关系。这里有两个思考方向供你参考：',
      hint: [
        `方向 A：回到"${focus}"，从你的个人经验出发，描述你曾经遇到的具体情形。`,
        sourceTitle
          ? `方向 B：参考报告来源"${sourceTitle}"的核心论点，看看它是否启发了你。`
          : '方向 B：参考报告中的某个来源，看看它的核心论点是否启发了你。',
      ],
    };
  },
  3: () => ({
    level: 3,
    message:
      '看起来这个话题目前对你来说确实有难度。建议结束本次诘问并生成成果卡；也可以选择继续，换个角度讨论。',
  }),
};

/** Determine response for consecutive uncertain answers (#17 semantics). */
export function uncertainResponse(
  uncertainStreak: number,
  session: Session,
  currentQuestion: string | null = null
): UncertainResponse {
  if (uncertainStreak <= 0) return PROMPTS[0](session, currentQuestion);
  if (uncertainStreak === 1) return PROMPTS[1](session, currentQuestion);
  if (uncertainStreak === 2) return PROMPTS[2](session, currentQuestion);
  return PROMPTS[3](session, currentQuestion);
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
      reason: classifyLLMFailure(err),
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
      reason: classifyLLMFailure(err),
      timestamp: Date.now(),
    });
  }

  // Fallback to strategy template
  const fallback = STRATEGIES[strategy].fallbackTemplate(session);
  return { question: fallback, usedFallback: true, events, failureReason: events.at(-1)?.reason };
}
