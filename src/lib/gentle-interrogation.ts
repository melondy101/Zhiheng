// Gentle adaptive interrogation for PRD v4.2 §5.
//
// This module implements the "老师式" dialogue guidance:
// - Input intent classification: question vs. response
// - Directive round progression: only substantive answers advance定向轮次
// - Gentle response generation: direct answer + follow-up for questions,
//   acknowledgment + strategy question for responses
// - Three-round summary gate: after 3 directive rounds, offer 继续/总结
//
// Pure functions for testability; the orchestrator wires in the LLM provider
// and session state. LLM failure falls back to honest deterministic templates.

import type { Session, Viewpoint } from './providers';
import type { StrategyId } from './strategy-engine';
import { isRoundAnswer } from './providers';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Classified user intent for the most recent input.
 */
export type UserIntent = 'question' | 'response';

/**
 * Gentle response returned by the response generator.
 */
export interface GentleResponse {
  /** The intent that was classified. */
  intent: UserIntent;
  /** AI direct answer text; null when the user was expressing a viewpoint (not asking). */
  aiReply: string | null;
  /** Follow-up question to display to the user; null when the summary gate is being shown. */
  followUp: string | null;
  /** Number of completed directive (strategy-directed) rounds after this input. */
  directiveRound: number;
  /** True when the summary gate should be shown (after every 3rd directive round). */
  suggestSummary: boolean;
}

/**
 * Gentle-interrogation state persisted on the session's interrogation object.
 */
export interface GentleState {
  directiveRound: number;
  lastIntent: UserIntent | null;
}

// ---------------------------------------------------------------------------
// Intent classifier (deterministic, rule-based)
// ---------------------------------------------------------------------------

/**
 * Heuristic question patterns: lines that look like the user is asking
 * the AI something rather than answering a strategy question.
 */
const QUESTION_MARKERS = [
  // Ends with a Chinese question mark or contains one mid-string
  /[？?]/,
  // Starts with a Chinese question word
  /^(什么|怎么|如何|为什么|为何|哪|哪个|哪些|是不是|有没有|可以|能|会不会|何时|多少|几)/,
  // Common question starters
  /^(请问|我想问|我问|告诉我|请解释|请说明|帮忙|帮我|请教)/,
  // Short clarifying questions (≤15 chars with question-like structure)
  /^.{0,15}[？?]$/,
];

/**
 * Heuristic non-substantive indicators: inputs that should NOT count as
 * directive-round responses even if they are not questions.
 */
const NON_SUBSTANTIVE_PATTERNS = [
  /^(不知道|不清楚|不确定|不明白|没想法|随便|都行|嗯|哦|好的|行|可以|OK|ok|无所谓|没所谓)$/,
  // Very short ambiguous inputs (≤3 chars): "嗯", "哦", "额", "啊", "哈"
  /^[嗯哦额啊哈\s]{1,3}$/,
];

/**
 * Classify a user input as a question or a response.
 *
 * Rules (applied in order):
 * 1. If the input contains a question mark or starts with a question word → question
 * 2. If the input matches non-substantive patterns → response (doesn't advance round)
 * 3. Otherwise → response (substantive answer)
 *
 * @param text The raw user input text
 * @returns 'question' or 'response'
 */
export function classifyIntent(text: string): UserIntent {
  const trimmed = text.trim();

  // Rule 1: Check for explicit question markers
  for (const pattern of QUESTION_MARKERS) {
    if (pattern.test(trimmed)) {
      return 'question';
    }
  }

  // Rule 2: Non-substantive → still 'response' (orchestrator decides round advance)
  // Rule 3: Default to response
  return 'response';
}

/**
 * True when the input is non-substantive and should NOT advance the directive
 * round even if classified as 'response'.
 */
export function isNonSubstantive(text: string): boolean {
  const trimmed = text.trim();
  return NON_SUBSTANTIVE_PATTERNS.some((p) => p.test(trimmed));
}

// ---------------------------------------------------------------------------
// Directive round progression
// ---------------------------------------------------------------------------

/**
 * Count the number of completed directive rounds already recorded in the
 * session. Only round-advancing, non-question, substantive responses count.
 */
export function completedDirectiveRounds(session: Session): number {
  const interr = session.interrogation as { directiveRound?: number } | undefined;
  // Use the persisted directiveRound if present (even if 0, meaning explicitly
  // set by the gentle system); fall back to legacy round-count derivation.
  if (interr && Object.prototype.hasOwnProperty.call(interr, 'directiveRound')) {
    return interr.directiveRound ?? 0;
  }
  // Legacy fallback: derive from messages (no intent field → count all round answers)
  return session.messages.filter(isRoundAnswer).length;
}

/**
 * True when the summary gate should be shown: after every 3 completed
 * directive rounds (3, 6, 9, ...).
 */
export function shouldSuggestSummary(directiveRound: number): boolean {
  return directiveRound > 0 && directiveRound % 3 === 0;
}

// ---------------------------------------------------------------------------
// Gentle response templates (deterministic fallback when LLM is unavailable)
// ---------------------------------------------------------------------------

/**
 * Build a direct answer to a user question, referencing the selected viewpoint
 * and report context honestly.
 */
function buildDirectAnswer(session: Session, questionText: string): string {
  const stance = session.selectedViewpoint?.text;
  const topic = session.question;
  if (stance) {
    return `关于你提出的问题，结合我们正在讨论的「${stance.slice(0, 30)}${stance.length > 30 ? '…' : ''}」这一立场，在当前的信息范围内，这需要我们进一步辨析。建议你可以从报告中的观点对比来理解，也可以继续追问具体细节。`;
  }
  return `关于你提出的问题，在当前的信息范围内，需要我们进一步辨析。建议你可以从报告中的观点对比来理解，也可以继续追问具体细节。`;
}

/**
 * Build a gentle follow-up question after answering a user question.
 * Uses a pool of neutral, non-pressuring follow-ups.
 */
function buildQuestionFollowUp(session: Session, _questionText: string): string {
  const followUps = [
    '关于这一点，你怎么看？',
    '这有没有让你想到什么不同的角度？',
    '你对此有什么初步的想法吗？',
    '如果换个角度来看，你会怎么考虑？',
    '这个话题中，你最想深入了解的是哪个方面？',
  ];
  // Deterministic selection based on session id
  const index = session.id.split('').reduce((acc: number, c: string) => acc + c.charCodeAt(0), 0) % followUps.length;
  return followUps[index]!;
}

/**
 * Build an acknowledgment for a user's substantive response, referencing
 * their selected viewpoint.
 */
function buildAcknowledgment(session: Session, answerText: string): string {
  const stance = session.selectedViewpoint?.text;
  const fragment = answerText.length > 20 ? answerText.slice(0, 20) + '…' : answerText;
  return `我理解你的思考。你提到了「${fragment}」，这很有价值。`;
}

/**
 * Build a strategy-grounded follow-up question for the next directive round.
 * Uses the strategy template from the strategy engine.
 */
function buildStrategyFollowUp(
  strategy: StrategyId,
  session: Session,
  _answerText: string
): string {
  const templates: Record<StrategyId, string> = {
    M1_evidence: '请描述一个最能支持你目前想法的具体的数据或例子，并说明它为什么重要？',
    M2_premise: '你的观点背后，是否有一个隐含的前提？如果该前提不成立，你的结论会改变吗？',
    M3_anchoring: '在形成这个看法时，最初吸引你的事实是否主导了后续的全部判断？',
    M4_steelman: '请尝试用最强的一种对立观点重新论证。哪种反驳最难回应？',
    M5_system2: '如果暂时搁置直觉反应，用冷静态势拆解每一步推导，中间存在跳跃吗？',
    M6_reversal: '如果你必须为相反的立场辩护，你最有力的论据是什么？',
    M7_metacognition: '回顾你得出这个结论的过程，哪些信息源对你的影响最大？',
    M8_contradiction: '如果上述两条看似自洽的依据发生直接冲突，哪一条具有更根本的决定权？',
    M5_restate: '基于以上讨论，你能用一两句话重新表述你当前的观点吗？',
  };
  return templates[strategy] || templates.M1_evidence;
}

/**
 * Build an honest degradation message when the LLM is unavailable.
 * Consistent with the strategy-engine's TEMPLATE_FALLBACK_DISCLOSURE.
 */
function buildDegradationNotice(): string {
  return '【策略模板降级】AI 服务暂不可用，以下回复由模板生成：';
}

// ---------------------------------------------------------------------------
// Gentle response generator
// ---------------------------------------------------------------------------

/**
 * Generate the appropriate gentle response for a user input.
 *
 * The response differs based on intent:
 * - question: direct answer + follow-up (does NOT advance directive round)
 * - response: acknowledgment + strategy question (advances directive round if substantive)
 *
 * @param userText The user's raw input
 * @param session The current session state
 * @param currentStrategy The strategy for the upcoming directive round
 * @param llmAvailable Whether the LLM is available for richer responses
 * @returns GentleResponse with AI reply, follow-up, and directive round info
 */
export function generateGentleResponse(
  userText: string,
  session: Session,
  currentStrategy: StrategyId,
  llmAvailable = true
): GentleResponse {
  const intent = classifyIntent(userText);
  const currentDirectiveRound = completedDirectiveRounds(session);

  if (intent === 'question') {
    // User is asking: give a direct answer + follow-up, no round advance
    const degradation = llmAvailable ? '' : `${buildDegradationNotice()} `;
    const aiReply = `${degradation}${buildDirectAnswer(session, userText)}`;
    const followUp = buildQuestionFollowUp(session, userText);
    return {
      intent,
      aiReply,
      followUp,
      directiveRound: currentDirectiveRound,
      suggestSummary: false,
    };
  }

  // User is responding: check if substantive
  const substantive = !isNonSubstantive(userText);
  const nextDirectiveRound = substantive ? currentDirectiveRound + 1 : currentDirectiveRound;

  if (!substantive) {
    // Non-substantive: gentle encouragement, no round advance
    const degradation = llmAvailable ? '' : `${buildDegradationNotice()} `;
    const followUp = '没关系，你可以从任何你想聊的角度继续。';
    return {
      intent,
      aiReply: null,
      followUp: `${degradation}${followUp}`,
      directiveRound: currentDirectiveRound,
      suggestSummary: false,
    };
  }

  // Substantive response: acknowledge + strategy question
  const degradation = llmAvailable ? '' : `${buildDegradationNotice()} `;
  const aiReply = `${degradation}${buildAcknowledgment(session, userText)}`;
  const followUp = buildStrategyFollowUp(currentStrategy, session, userText);

  return {
    intent,
    aiReply,
    followUp,
    directiveRound: nextDirectiveRound,
    suggestSummary: shouldSuggestSummary(nextDirectiveRound),
  };
}

// ---------------------------------------------------------------------------
// Gentle state helpers
// ---------------------------------------------------------------------------

/**
 * Derive the GentleState from the session's interrogation state.
 */
export function gentleStateOf(session: Session): GentleState {
  const interr = session.interrogation as { directiveRound?: number; lastIntent?: UserIntent } | undefined;
  return {
    directiveRound: interr?.directiveRound ?? 0,
    lastIntent: interr?.lastIntent ?? null,
  };
}

/**
 * Build an updated interrogation state fragment with the new gentle state.
 */
export function withGentleState(
  current: Record<string, unknown>,
  gentle: GentleState
): Record<string, unknown> {
  return {
    ...current,
    directiveRound: gentle.directiveRound,
    lastIntent: gentle.lastIntent,
  };
}
