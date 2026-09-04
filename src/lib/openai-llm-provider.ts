// Server-side real LLM question generation against any OpenAI-compatible
// chat-completions endpoint (#20).
//
// The strategy engine (strategy-engine.ts) and the orchestration API own the
// strategy, the round and every state transition. This provider ONLY fills in
// the question text for the strategy it is given — it cannot skip rounds,
// answer on the user's behalf, or output a verdict, because every response is
// validated and anything non-conforming is rejected as a failure. Callers are
// expected to wrap it in withFallback (llm-fallback.ts): one retry, then the
// deterministic strategy template. This module never retries and never
// degrades silently — it either returns a validated question or throws.
//
// Request boundary (guardrail): the prompt contains ONLY the allowed
// structured interrogation context — the strategy instruction, the selected
// stance, the user's most recent round answer, truncated report evidence
// fragments (from selectRoundSources), and the safety constraints. No other
// session data (ids, full history, URLs, report body) ever leaves the server.
//
// Honesty red lines:
//   - without a configured key/model the factory returns null and the caller
//     keeps the fixture provider — fixture output is never labeled as a real
//     model response;
//   - an invalid model response is a failure (throw → retry → template), it
//     is never relaxed, never coerced, never written into user messages.
//
// Secrets are read from the server environment only. No NEXT_PUBLIC_ variable
// is used anywhere in this module, so nothing here can reach the browser.

import type { LLMProvider, ReportSynthesis, Session } from './providers';
import { STRATEGIES, type StrategyId } from './strategy-engine';
import { buildInterrogationContext, selectRoundSources } from './interrogation-context';
import { buildSynthesisMessages, parseSynthesisResponse } from './report-synthesis';
import type { SynthesisRequest } from './report-synthesis';

// ---------------------------------------------------------------------------
// Server-side configuration (env-only, never exposed to the browser)
// ---------------------------------------------------------------------------

export const DEFAULT_LLM_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_LLM_TIMEOUT_MS = 10_000;

/** Maximum characters of a validated model question (issue #20 guardrail). */
export const MAX_QUESTION_CHARS = 500;

/** Truncation bounds for the evidence/context fragments sent to the model. */
export const EVIDENCE_TITLE_MAX_CHARS = 60;
export const EVIDENCE_EXCERPT_MAX_CHARS = 160;
export const STANCE_MAX_CHARS = 200;
export const LAST_ANSWER_MAX_CHARS = 400;

export interface OpenAILLMConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
}

/**
 * Read the LLM configuration from the server environment. Returns null when
 * no API key or model name is configured — the system then keeps the honest
 * fixture path and never touches the network.
 */
export function readOpenAILLMConfig(
  env: Record<string, string | undefined> = process.env
): OpenAILLMConfig | null {
  const apiKey = env.LLM_API_KEY?.trim();
  const model = env.LLM_MODEL?.trim();
  if (!apiKey || !model) return null;
  const baseUrl = (env.LLM_BASE_URL?.trim() || DEFAULT_LLM_BASE_URL).replace(/\/+$/, '');
  const timeoutRaw = Number(env.LLM_TIMEOUT_MS?.trim());
  const timeoutMs =
    Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : DEFAULT_LLM_TIMEOUT_MS;
  return { baseUrl, apiKey, model, timeoutMs };
}

// ---------------------------------------------------------------------------
// Injectable HTTP transport (contract tests fake this; production uses fetch)
// ---------------------------------------------------------------------------

export interface LLMCallOptions {
  method: 'POST';
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal;
}

export type LLMHttpTransport = (url: string, options: LLMCallOptions) => Promise<Response>;

export const defaultLLMHttpTransport: LLMHttpTransport = (url, options) => fetch(url, options);

// ---------------------------------------------------------------------------
// Prompt construction — the request boundary (guardrail)
// ---------------------------------------------------------------------------

export interface LLMChatMessage {
  role: 'system' | 'user';
  content: string;
}

/**
 * Safety constraints embedded into every request: the model only asks, it
 * never answers for the user, never judges, and outputs exactly one question.
 */
const SAFETY_CONSTRAINTS =
  '安全约束：只提问，不回答；不替用户作答或表态；不输出观点裁决、正确性判断或评分；' +
  '只输出一个以问号结尾的单个问题，不要任何解释、前缀、引号或额外内容。';

const SYSTEM_PREAMBLE =
  '你是"知研"诘问引擎的问题生成器。你的唯一任务：针对下面给定的追问策略，生成一个追问问题。';

/** Truncate a text fragment to `max` characters (never invent content). */
function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * Build the system + user messages for a strategy question. Only the allowed
 * context is included: strategy instruction (name + requirement from the
 * STRATEGIES table — the single source of truth), the selected stance, the
 * user's most recent round answer, and truncated report evidence fragments.
 * No session ids, no full history, no URLs, no report body.
 */
export function buildStrategyQuestionMessages(
  strategy: StrategyId,
  session: Session
): LLMChatMessage[] {
  const context = buildInterrogationContext(session, strategy);
  const strategyInfo = STRATEGIES[strategy];

  const system = [
    SYSTEM_PREAMBLE,
    `当前追问策略：${strategyInfo.name}（${strategyInfo.description}）。`,
    SAFETY_CONSTRAINTS,
  ].join('\n');

  const evidenceLines = selectRoundSources(session).map(({ index, source }) => {
    const title = truncate(source.title ?? '', EVIDENCE_TITLE_MAX_CHARS) || '（无标题）';
    const excerpt = truncate(source.excerpt ?? '', EVIDENCE_EXCERPT_MAX_CHARS) || '（无摘要）';
    return `${index}. ${title}：${excerpt}`;
  });

  const stance = context.stance
    ? truncate(context.stance.text, STANCE_MAX_CHARS)
    : '（未选择）';
  const lastAnswer =
    context.lastAnswer !== null
      ? truncate(context.lastAnswer, LAST_ANSWER_MAX_CHARS)
      : '（尚未回答）';

  const user = [
    `用户选择的立场：${stance}`,
    `用户最新回答：${lastAnswer}`,
    '可参考的报告证据（来自报告真实引用，最多三条）：',
    evidenceLines.length > 0 ? evidenceLines.join('\n') : '（无）',
  ].join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

// ---------------------------------------------------------------------------
// Response validation — untrusted output, never relaxed
// ---------------------------------------------------------------------------

/**
 * Extended verdict/answer-on-behalf markers (#25) — must never pass as a
 * question.  The original VERDICT_PATTERNS are preserved for backward
 * compatibility; JUDGMENT_PATTERNS adds the patterns identified in #25.
 */
const VERDICT_PATTERNS: RegExp[] = [
  /你是对的/,
  /你错了/,
  /你说得(对|不对)/,
  /你的观点是(正确|错误|对的|错的)/,
  /评[分级][:：]/,
  /裁决[:：]/,
  /正确性[:：]/,
];

/** Additional patterns added for ticket #25. */
const JUDGMENT_PATTERNS: RegExp[] = [
  /你应该(放弃|改变|重新考虑|调整)/,
  /[这该]?个?观点(是)?(错误|正确|错的|对的|不可接受|站不住)/,
  /结论(是|为|就)/,
  /评分[:：]\s*\d+/,
  /评\s*[一二三四五六七八九十0-9]+\s*[级分]/,
  /你(必须|应该|需要)?\s*(接受|拒绝|放弃|改变)\s*(这个|该)?\s*(观点|立场|看法)/,
  /对.*(打|评)\s*[0-9]+\s*分/,
  /评级[:：]\s*[0-9]+/,
];

/**
 * Standalone contract function (#25): throws if the text contains a judging
 * pattern, otherwise returns silently.  Callers can use this to validate
 * arbitrary strings (e.g. user-provided text that may have been cached or
 * re-submitted) without having to go through isValidQuestionText.
 * @throws Error with a message that names the failing pattern category
 */
export function assertNonJudgingQuestion(text: string): void {
  const t = text.trim();
  const verdictMatch = VERDICT_PATTERNS.find((p) => p.test(t));
  if (verdictMatch) {
    throw new Error(`Judging content detected (verdict pattern): ${verdictMatch}`);
  }
  const judgmentMatch = JUDGMENT_PATTERNS.find((p) => p.test(t));
  if (judgmentMatch) {
    throw new Error(`Judging content detected (judgment pattern): ${judgmentMatch}`);
  }
}

/**
 * Validate that the model output is a single, bounded question that does not
 * answer on the user's behalf or deliver a verdict. Anything else is a
 * failure the caller must degrade on — never silently relaxed.
 */
export function isValidQuestionText(content: string): boolean {
  const text = content.trim();
  if (text.length === 0) return false;
  if (text.length > MAX_QUESTION_CHARS) return false;
  if (/[\r\n]/.test(text)) return false; // one question, one line
  const questionMarks = (text.match(/[？?]/g) ?? []).length;
  if (questionMarks !== 1) return false; // single question only
  if (!text.endsWith('？') && !text.endsWith('?')) return false;
  try {
    assertNonJudgingQuestion(text);
  } catch {
    return false;
  }
  return true;
}

/**
 * Extract `choices[0].message.content` from an untrusted response body,
 * field-by-field. Anything missing or non-string is null (no coercion).
 */
export function extractChoiceContent(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const record = body as Record<string, unknown>;
  const choices = record.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0];
  if (typeof first !== 'object' || first === null) return null;
  const message = (first as Record<string, unknown>).message;
  if (typeof message !== 'object' || message === null) return null;
  const content = (message as Record<string, unknown>).content;
  return typeof content === 'string' ? content : null;
}

// ---------------------------------------------------------------------------
// Provider — one attempt per call; retry/template degradation is withFallback's
// job (llm-fallback.ts), so this class always throws on failure.
// ---------------------------------------------------------------------------

export interface OpenAICompatibleLLMProviderOptions {
  config: OpenAILLMConfig;
  transport?: LLMHttpTransport;
}

export class OpenAICompatibleLLMProvider implements LLMProvider {
  private readonly config: OpenAILLMConfig;
  private readonly transport: LLMHttpTransport;

  constructor(options: OpenAICompatibleLLMProviderOptions) {
    this.config = options.config;
    this.transport = options.transport ?? defaultLLMHttpTransport;
  }

  /**
   * Generate the question text for the engine-chosen strategy. Throws on any
   * timeout, network error, HTTP error, malformed body, or non-conforming
   * content — withFallback turns that into one retry and then the template.
   */
  async generateStrategyQuestion(strategy: StrategyId, session: Session): Promise<string> {
    const messages = buildStrategyQuestionMessages(strategy, session);
    const body = await this.postChatCompletion(
      JSON.stringify({
        model: this.config.model,
        messages,
        temperature: 0.7,
        max_tokens: 1024,
      })
    );
    const content = extractChoiceContent(body);
    if (content === null) {
      throw new Error('LLM API returned an unexpected response shape');
    }
    const question = content.trim();
    if (!isValidQuestionText(question)) {
      throw new Error(
        'LLM response failed question validation (empty, overlong, multi-question, or verdict-like)'
      );
    }
    return question;
  }

  /**
   * Synthesize the report's multiple viewpoints (PRD v4.2 §3). Unlike the
   * question path there is no template to degrade into, so a non-conforming
   * response throws once and the caller records the degradation and uses its
   * own deterministic synthesis. This method never retries: report generation
   * already costs search quota and PRD §2.2 forbids unbounded retries.
   */
  async generateSynthesis(request: SynthesisRequest): Promise<ReportSynthesis | null> {
    if (request.sources.length === 0) return null;

    const messages = buildSynthesisMessages(request);
    const body = await this.postChatCompletion(
      JSON.stringify({
        model: this.config.model,
        messages,
        temperature: 0.3,
        max_tokens: 2048,
      })
    );
    const content = extractChoiceContent(body);
    if (content === null) {
      throw new Error('LLM API returned an unexpected response shape');
    }
    const synthesis = parseSynthesisResponse(content, request.sources);
    if (!synthesis) {
      throw new Error(
        'LLM synthesis failed validation (unparseable, or every viewpoint was a source title, an excerpt lift, or unbacked by a real citation)'
      );
    }
    return synthesis;
  }

  /**
   * POST {baseUrl}/chat/completions with both an abort signal (cancels a real
   * fetch) and a hard timeout race (a transport that ignores the signal still
   * cannot stall the caller). Non-200 status or unparseable JSON throws.
   */
  private async postChatCompletion(requestBody: string): Promise<unknown> {
    const url = `${this.config.baseUrl}/chat/completions`;
    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error(`LLM API timeout after ${this.config.timeoutMs}ms`)),
        this.config.timeoutMs
      );
    });
    try {
      const response = await Promise.race([
        this.transport(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: requestBody,
          signal: controller.signal,
        }),
        timeoutPromise,
      ]);
      if (response.status !== 200) {
        throw new Error(`LLM API HTTP ${response.status}`);
      }
      return await response.json();
    } finally {
      clearTimeout(abortTimer);
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
  }
}

// ---------------------------------------------------------------------------
// Route-facing factory — configured from the server env; no key → null
// (the caller keeps the fixture provider; nothing pretends to be live)
// ---------------------------------------------------------------------------

export function createLLMProviderFromEnv(
  env: Record<string, string | undefined> = process.env
): LLMProvider | null {
  const config = readOpenAILLMConfig(env);
  if (!config) return null;
  return new OpenAICompatibleLLMProvider({ config });
}
