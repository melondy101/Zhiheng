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

import type { LLMProvider, ReportSynthesis, Session, Report, Source } from './providers';
import type { KnowledgeGraph } from './knowledge-graph';
import {
  buildGraphExtractionMessages,
  parseGraphExtractionResponse,
} from './knowledge-graph-llm';
import { STRATEGIES, type StrategyId } from './strategy-engine';
import { buildInterrogationContext, selectRoundSources } from './interrogation-context';
import { getKnowledgeBaseItemForStrategy } from './knowledge-base/provider';
import { logRequest, maskSensitiveHeaders, previewBody } from './request-log';
import {
  buildFinalSynthesisMessages,
  buildSynthesisMessages,
  parseSynthesisResponse,
  partitionSynthesisSources,
} from './report-synthesis';
import type { SynthesisRequest, SynthesisSource } from './report-synthesis';
import {
  buildQuestionRewriteMessages,
  parseQuestionRewriteResponse,
  type QuestionRewriteResult,
} from './question-rewriter';
import { logStartupPath } from './startup-log';
import { LLMRequestError } from './llm-fallback';

// Log environment configuration on module load (once).
logStartupPath();

// ---------------------------------------------------------------------------
// Server-side configuration (env-only, never exposed to the browser)
// ---------------------------------------------------------------------------

export const DEFAULT_LLM_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_LLM_TIMEOUT_MS = 10_000;
/** Reports tolerate slower model responses than interactive follow-up questions. */
export const DEFAULT_SYNTHESIS_TIMEOUT_MS = 45_000;

/** Maximum characters of a validated model question (issue #20 guardrail). */
export const MAX_QUESTION_CHARS = 500;

/** Truncation bounds for the evidence/context fragments sent to the model. */
export const EVIDENCE_TITLE_MAX_CHARS = 60;
export const EVIDENCE_EXCERPT_MAX_CHARS = 160;
export const STANCE_MAX_CHARS = 200;
export const LAST_ANSWER_MAX_CHARS = 400;
/** Hard ceiling for one interactive strategy-question prompt (system + user). */
export const QUESTION_PROMPT_MAX_CHARS = 400;

export interface OpenAILLMConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  synthesisTimeoutMs: number;
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
  const readTimeout = (value: string | undefined, fallback: number) => {
    const timeout = Number(value?.trim());
    return Number.isFinite(timeout) && timeout > 0 ? timeout : fallback;
  };
  const timeoutMs = readTimeout(env.LLM_TIMEOUT_MS, DEFAULT_LLM_TIMEOUT_MS);
  const synthesisTimeoutMs = readTimeout(env.LLM_SYNTHESIS_TIMEOUT_MS, DEFAULT_SYNTHESIS_TIMEOUT_MS);
  return { baseUrl, apiKey, model, timeoutMs, synthesisTimeoutMs };
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
const SAFETY_CONSTRAINTS = '只提一个开放式问题（问号结尾）；不替用户作答；不输出观点裁决、正确性判断或评分。';

const INTENSITY_GUIDANCE = {
  gentle: '低强度：从一个具体例子或直觉切入，不要求完整论证。',
  standard: '中强度：检查依据、前提或边界条件。',
  challenging: '高强度：可检验反例、对立观点或推理张力。',
} as const;

/** Truncate a text fragment to `max` characters (never invent content). */
function truncate(text: string, max: number): string {
  if (max <= 1) return text.slice(0, Math.max(0, max));
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
  const kbItem = context.kbFramework ?? getKnowledgeBaseItemForStrategy(strategy);
  const intensity = session.questioningIntensity ?? 'gentle';
  const system = [
    '你是知研追问助手。',
    `当前追问策略：${strategyInfo.name}（${truncate(strategyInfo.description, 48)}）。`,
    kbItem ? `方法：【${truncate(kbItem.topic, 48)}】。` : '',
    `追问导向：${INTENSITY_GUIDANCE[intensity]}`,
    SAFETY_CONSTRAINTS,
  ].join('');

  const evidenceLines = selectRoundSources(session).slice(0, 1).map(({ index, source }) => {
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

  const userDraft = [
    `用户选择的立场：${stance}`,
    `用户最新回答：${lastAnswer}`,
    '可参考证据（最多一条）：',
    evidenceLines.length > 0 ? evidenceLines.join('\n') : '（无）',
  ].join('\n');
  // Keep the complete interactive prompt small even when a client submits
  // unusually long stance/answer/evidence fields.
  const userBudget = QUESTION_PROMPT_MAX_CHARS - system.length;
  const user = userBudget > 1 ? truncate(userDraft, userBudget - 1) : '';

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
 * field-by-field. Handles models (e.g. DeepSeek reasoner/flash) that return
 * non-empty reasoning_content when content is empty.
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
  if (typeof content === 'string' && content.trim().length > 0) {
    return content;
  }
  const reasoningContent = (message as Record<string, unknown>).reasoning_content;
  if (typeof reasoningContent === 'string' && reasoningContent.trim().length > 0) {
    return reasoningContent;
  }
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
   * For more than five materials, first-pass requests run in parallel and a
   * compact, cited candidate set is sent to one final pass. Failed groups are
   * discarded; a final result is accepted only when it cites original report
   * materials. This method never retries a failed call.
   */
  async generateSynthesis(request: SynthesisRequest): Promise<ReportSynthesis | null> {
    if (request.sources.length === 0) return null;

    const batches = partitionSynthesisSources(request.sources);
    if (batches.length === 1) {
      return this.generateSynthesisPass(buildSynthesisMessages(request), request.sources, request.question);
    }

    const settled = await Promise.allSettled(
      batches.map((sources) =>
        this.generateSynthesisPass(buildSynthesisMessages({ question: request.question, sources }), sources, request.question)
      )
    );
    const candidates = settled.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : []
    );
    if (candidates.length === 0) {
      throw new Error('LLM synthesis failed for every material batch');
    }

    return this.generateSynthesisPass(
      buildFinalSynthesisMessages(request.question, candidates),
      request.sources,
      request.question
    );
  }

  private async generateSynthesisPass(
    messages: Array<{ role: 'system' | 'user'; content: string }>,
    validationSources: SynthesisSource[],
    question: string
  ): Promise<ReportSynthesis> {
    const body = await this.postChatCompletion(
      JSON.stringify({
        model: this.config.model,
        messages,
        temperature: 0.3,
        // DeepSeek's JSON mode is enforced server-side. The prompt alone is
        // insufficient for strict downstream parsing, especially when the
        // provider's thinking mode is enabled by default.
        response_format: { type: 'json_object' },
        ...(this.isDeepSeekEndpoint() ? { thinking: { type: 'disabled' } } : {}),
        // The report schema is compact. A large output budget makes the
        // reasoning model spend tens of seconds on unnecessary verbosity.
        max_tokens: 1536,
      }),
      this.config.synthesisTimeoutMs
    );
    const content = extractChoiceContent(body);
    if (content === null) {
      throw new Error('LLM API returned an unexpected response shape');
    }
    const synthesis = parseSynthesisResponse(content, validationSources, question);
    if (!synthesis) {
      throw new Error(
        'LLM synthesis failed validation (unparseable, or every viewpoint was a source title, an excerpt lift, or unbacked by a real citation)'
      );
    }
    return synthesis;
  }

  /**
   * Extract semantic knowledge graph (entities and logical relations) for a report via LLM.
   */
  async generateKnowledgeGraph(args: {
    report: Report;
    sources: Source[];
  }): Promise<KnowledgeGraph | null> {
    const { report, sources } = args;
    if (!report.question) return null;

    const messages = buildGraphExtractionMessages(report, sources);
    const body = await this.postChatCompletion(
      JSON.stringify({
        model: this.config.model,
        messages,
        temperature: 0.3,
        max_tokens: 1536,
      }),
      this.config.synthesisTimeoutMs
    );

    const content = extractChoiceContent(body);
    if (content === null) {
      throw new Error('LLM API returned an unexpected response shape for knowledge graph extraction');
    }

    const graph = parseGraphExtractionResponse(content, report);
    if (!graph) {
      throw new Error('LLM knowledge graph extraction failed validation');
    }

    return graph;
  }

  /**
   * Rewrite question into a deep inquiry question and generate a punchy subtitle via LLM.
   */
  async generateQuestionRewrite(question: string, timeoutMs = this.config.timeoutMs): Promise<QuestionRewriteResult | null> {
    if (!question || !question.trim()) return null;

    const messages = buildQuestionRewriteMessages(question);
    const body = await this.postChatCompletion(
      JSON.stringify({
        model: this.config.model,
        messages,
        temperature: 0.3,
        // O-3: this response is machine-parsed by parseQuestionRewriteResponse.
        // Prompt wording alone does not stop prose/reasoning wrappers, so the
        // JSON mode is requested server-side as the first line of defence;
        // extractJsonObject remains the client-side safety net.
        response_format: { type: 'json_object' },
        ...(this.isDeepSeekEndpoint() ? { thinking: { type: 'disabled' } } : {}),
        max_tokens: 1024,
      }),
      timeoutMs
    );

    const content = extractChoiceContent(body);
    if (content === null) {
      throw new Error('LLM API returned an unexpected response shape for question rewrite');
    }

    return parseQuestionRewriteResponse(content, question);
  }

  /**
   * True when the configured base URL points at DeepSeek, whose reasoning
   * ("thinking") mode is on by default and otherwise leaks chain-of-thought
   * prose into a response the caller parses as JSON.
   */
  private isDeepSeekEndpoint(): boolean {
    try {
      return new URL(this.config.baseUrl).hostname.endsWith('deepseek.com');
    } catch {
      return false;
    }
  }

  /**
   * Generic completion helper for custom prompt messages.
   *
   * O-3: every current caller feeds the result to JSON.parse, so the JSON mode
   * is requested server-side here too. `extractJsonObject` still guards the
   * parse, because not every provider honours response_format.
   */
  async generateCustomCompletion(
    messages: Array<{ role: string; content: string }>,
    timeoutMs = this.config.timeoutMs
  ): Promise<string | null> {
    const body = await this.postChatCompletion(
      JSON.stringify({
        model: this.config.model,
        messages,
        temperature: 0.3,
        response_format: { type: 'json_object' },
        ...(this.isDeepSeekEndpoint() ? { thinking: { type: 'disabled' } } : {}),
        max_tokens: 2048,
      }),
      timeoutMs
    );

    return extractChoiceContent(body);
  }

  /**
   * POST {baseUrl}/chat/completions with both an abort signal (cancels a real
   * fetch) and a hard timeout race (a transport that ignores the signal still
   * cannot stall the caller). Non-200 status or unparseable JSON throws.
   *
   * Every call emits a [req:llm_chat] log line (start / success / failure)
   * so operators see model, message structure, latency, and the first bytes
   * of the response — never the API key.
   */
  private async postChatCompletion(
    requestBody: string,
    timeoutMs = this.config.timeoutMs
  ): Promise<unknown> {
    const url = `${this.config.baseUrl}/chat/completions`;
    const headers = {
      Authorization: `Bearer ${this.config.apiKey}`,
      'Content-Type': 'application/json',
    };
    const startedAt = Date.now();

    // Pull model + message shape from the request body for the start log.
    // We parse defensively — a malformed requestBody should not break logging.
    let model = this.config.model;
    let messageRoles: string[] = [];
    try {
      const parsed = JSON.parse(requestBody) as { model?: string; messages?: Array<{ role: string }> };
      if (typeof parsed.model === 'string') model = parsed.model;
      if (Array.isArray(parsed.messages)) messageRoles = parsed.messages.map((m) => m.role);
    } catch {
      // ignore — logging should never throw
    }

    logRequest({
      stage: 'llm_chat',
      phase: 'start',
      url,
      method: 'POST',
      headers: maskSensitiveHeaders(headers),
      bodyPreview: `model=${model}, messages=[${messageRoles.join(', ')}], body=${previewBody(requestBody)}`,
      durationMs: 0,
    });

    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), timeoutMs);
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new LLMRequestError('timeout', `LLM API timeout after ${timeoutMs}ms`)),
        timeoutMs
      );
    });
    try {
      const response = await Promise.race([
        this.transport(url, {
          method: 'POST',
          headers,
          body: requestBody,
          signal: controller.signal,
        }),
        timeoutPromise,
      ]);
      const durationMs = Date.now() - startedAt;
      const contentType = response.headers.get('content-type');
      const bodyText = await response.text();
      const responsePreview = previewBody(bodyText);
      if (response.status !== 200) {
        logRequest({
          stage: 'llm_chat',
          phase: 'failure',
          url,
          method: 'POST',
          headers: maskSensitiveHeaders(headers),
          bodyPreview: `model=${model}`,
          status: response.status,
          contentType,
          durationMs,
          error: `LLM API HTTP ${response.status}`,
          responsePreview,
        });
        throw new LLMRequestError('http', `LLM API HTTP ${response.status}`);
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(bodyText);
      } catch (err) {
        logRequest({
          stage: 'llm_chat',
          phase: 'failure',
          url,
          method: 'POST',
          headers: maskSensitiveHeaders(headers),
          bodyPreview: `model=${model}`,
          status: response.status,
          contentType,
          durationMs,
          error: `LLM API returned non-JSON body: ${err instanceof Error ? err.message : String(err)}`,
          responsePreview,
        });
        throw new LLMRequestError('invalid_response', 'LLM API returned non-JSON body');
      }
      const content = extractChoiceContent(parsed);
      logRequest({
        stage: 'llm_chat',
        phase: 'success',
        url,
        method: 'POST',
        headers: maskSensitiveHeaders(headers),
        bodyPreview: `model=${model}`,
        status: response.status,
        contentType,
        durationMs,
        responsePreview: content ? `content=${previewBody(content)}` : responsePreview,
      });
      return parsed;
    } catch (err) {
      if (controller.signal.aborted && !(err instanceof LLMRequestError)) {
        throw new LLMRequestError('timeout', `LLM API timeout after ${timeoutMs}ms`);
      }
      const knownLLMError = err instanceof Error && err.message.startsWith('LLM ');
      if (!knownLLMError) {
        logRequest({
          stage: 'llm_chat',
          phase: 'failure',
          url,
          method: 'POST',
          headers: maskSensitiveHeaders(headers),
          bodyPreview: `model=${model}`,
          durationMs: Date.now() - startedAt,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      throw err;
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

/** Separate provider factory for the graph pipeline (prefers GRAPH_LLM_*, falls back to LLM_*). */
export function createGraphLLMProviderFromEnv(
  env: Record<string, string | undefined> = process.env
): LLMProvider | null {
  const apiKey = env.GRAPH_LLM_API_KEY?.trim() || env.LLM_API_KEY?.trim();
  const model = env.GRAPH_LLM_MODEL?.trim() || env.LLM_MODEL?.trim();
  if (!apiKey || !model) return null;
  const baseUrl = (
    env.GRAPH_LLM_BASE_URL?.trim() ||
    env.LLM_BASE_URL?.trim() ||
    DEFAULT_LLM_BASE_URL
  ).replace(/\/+$/, '');
  const timeout = Number(env.GRAPH_LLM_TIMEOUT_MS?.trim() || env.LLM_SYNTHESIS_TIMEOUT_MS?.trim());
  const timeoutMs = Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_SYNTHESIS_TIMEOUT_MS;
  return new OpenAICompatibleLLMProvider({
    config: { baseUrl, apiKey, model, timeoutMs, synthesisTimeoutMs: timeoutMs },
  });
}
