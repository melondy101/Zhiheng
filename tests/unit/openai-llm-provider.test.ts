// Ticket #20 contract tests for the OpenAI-compatible LLM provider
// (src/lib/openai-llm-provider.ts). Every HTTP interaction is driven through
// an injectable fake transport — no real model is ever requested, no API key
// is needed and no quota is consumed.
//
// The contract under test:
//   - request boundary: only the allowed structured interrogation context is
//     sent (strategy instruction, selected stance, latest round answer,
//     truncated report evidence, safety constraints) — never unrelated
//     session data
//   - response validation: empty / malformed / verdict-like / overlong model
//     output is rejected (throws → withFallback retries once → template)
//   - guardrails: the model text is returned verbatim as the question, the
//     session is never mutated, verdicts on the user's behalf are refused
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  DEFAULT_LLM_BASE_URL,
  DEFAULT_LLM_TIMEOUT_MS,
  EVIDENCE_EXCERPT_MAX_CHARS,
  EVIDENCE_TITLE_MAX_CHARS,
  MAX_QUESTION_CHARS,
  OpenAICompatibleLLMProvider,
  buildStrategyQuestionMessages,
  createLLMProviderFromEnv,
  extractChoiceContent,
  isValidQuestionText,
  readOpenAILLMConfig,
  type LLMCallOptions,
  type LLMHttpTransport,
  type OpenAILLMConfig,
} from '../../src/lib/openai-llm-provider';
import { withFallback } from '../../src/lib/llm-fallback';
import { STRATEGIES } from '../../src/lib/strategy-engine';
import type { Session, Source } from '../../src/lib/providers';

// ---------------------------------------------------------------------------
// Fake transport helpers
// ---------------------------------------------------------------------------

const CONFIG: OpenAILLMConfig = {
  baseUrl: 'https://llm.example/v1',
  apiKey: 'test-key',
  model: 'test-model',
  timeoutMs: 5_000,
};

interface CapturedLLMCall {
  url: string;
  options: LLMCallOptions;
}

type FakeLLMHandler = (url: string, options: LLMCallOptions) => Response | Promise<Response>;

/** Wrap a handler so every call is recorded for assertions. */
function recordingLLMTransport(handler: FakeLLMHandler): {
  transport: LLMHttpTransport;
  calls: CapturedLLMCall[];
} {
  const calls: CapturedLLMCall[] = [];
  return {
    calls,
    transport: async (url, options) => {
      calls.push({ url, options });
      return handler(url, options);
    },
  };
}

function makeProvider(
  handler: FakeLLMHandler,
  overrides: Partial<OpenAILLMConfig> = {}
): { provider: OpenAICompatibleLLMProvider; calls: CapturedLLMCall[] } {
  const config: OpenAILLMConfig = { ...CONFIG, ...overrides };
  const { transport, calls } = recordingLLMTransport(handler);
  return { provider: new OpenAICompatibleLLMProvider({ config, transport }), calls };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** A minimal well-formed chat-completions body carrying `content`. */
function chatResponse(content: string): Record<string, unknown> {
  return { choices: [{ message: { role: 'assistant', content } }] };
}

// ---------------------------------------------------------------------------
// Session fixture — structured interrogation context with distinct strings
// ---------------------------------------------------------------------------

const STANCE_TEXT = '我认为AI会增强而非取代创造力';
const OLD_ANSWER = '旧回答：绘画在摄影术发明后反而迎来了新的艺术流派。';
const LATEST_ANSWER = '最新回答：我认为技术的价值取决于人如何使用它。';
const UNCERTAIN_TEXT = '不确定，我说不清楚';
const SOURCE_URL = 'https://www.zhihu.com/question/9527';
const SOURCE_TITLE = '真实来源标题：AI与创造力的边界';
const SOURCE_EXCERPT = '真实来源摘要：创造力更多体现为重组既有元素的能力。';
const REPORT_CONTENT = '完整报告正文不应进入模型请求。';
const KNOWLEDGE_POINT = '知识点文本不应进入模型请求。';

function makeSource(overrides: Partial<Source> = {}): Source {
  return {
    id: 'src_1',
    type: 'zhihu',
    author: '真实作者',
    title: SOURCE_TITLE,
    url: SOURCE_URL,
    excerpt: SOURCE_EXCERPT,
    ...overrides,
  };
}

function makeSession(overrides: Partial<Session> = {}): Session {
  const source = makeSource();
  return {
    id: 's_llm_test',
    question: 'AI是否会取代人类创造力？',
    initialOpinion: null,
    report: {
      question: 'AI是否会取代人类创造力？',
      title: '报告标题',
      knowledgePoints: [KNOWLEDGE_POINT],
      content: REPORT_CONTENT,
      viewpoints: [],
      references: [source],
      citations: { 1: source },
    },
    selectedViewpoint: { id: 'v1', text: STANCE_TEXT, source: 'user_authored' },
    messages: [
      { id: 'm_1', role: 'user', text: OLD_ANSWER, timestamp: 1 },
      { id: 'm_2', role: 'user', text: LATEST_ANSWER, timestamp: 2 },
      { id: 'm_3', role: 'user', text: UNCERTAIN_TEXT, timestamp: 3, uncertain: true },
    ],
    resultCard: null,
    completed: false,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

const VALID_QUESTION = '这个观点背后有哪些具体的数据支撑？';

// ---------------------------------------------------------------------------
// readOpenAILLMConfig — server-side, key-gated
// ---------------------------------------------------------------------------
describe('readOpenAILLMConfig', () => {
  it('returns null when no API key is configured', () => {
    assert.strictEqual(readOpenAILLMConfig({}), null);
    assert.strictEqual(readOpenAILLMConfig({ LLM_API_KEY: '' }), null);
    assert.strictEqual(readOpenAILLMConfig({ LLM_API_KEY: '   ' }), null);
  });

  it('returns null when the model name is missing', () => {
    assert.strictEqual(readOpenAILLMConfig({ LLM_API_KEY: 'k' }), null);
    assert.strictEqual(readOpenAILLMConfig({ LLM_API_KEY: 'k', LLM_MODEL: '  ' }), null);
  });

  it('applies the default base URL and timeout when only key and model are set', () => {
    const config = readOpenAILLMConfig({ LLM_API_KEY: 'k', LLM_MODEL: 'm' });
    assert.ok(config);
    assert.strictEqual(config.baseUrl, DEFAULT_LLM_BASE_URL);
    assert.strictEqual(config.timeoutMs, DEFAULT_LLM_TIMEOUT_MS);
    assert.strictEqual(config.apiKey, 'k');
    assert.strictEqual(config.model, 'm');
  });

  it('honors LLM_BASE_URL and strips trailing slashes', () => {
    const config = readOpenAILLMConfig({
      LLM_API_KEY: 'k',
      LLM_MODEL: 'm',
      LLM_BASE_URL: 'https://proxy.example.com/v1///',
    });
    assert.ok(config);
    assert.strictEqual(config.baseUrl, 'https://proxy.example.com/v1');
  });

  it('honors a positive LLM_TIMEOUT_MS and falls back to the default otherwise', () => {
    assert.strictEqual(
      readOpenAILLMConfig({ LLM_API_KEY: 'k', LLM_MODEL: 'm', LLM_TIMEOUT_MS: '2500' })?.timeoutMs,
      2500
    );
    assert.strictEqual(
      readOpenAILLMConfig({ LLM_API_KEY: 'k', LLM_MODEL: 'm', LLM_TIMEOUT_MS: 'nope' })?.timeoutMs,
      DEFAULT_LLM_TIMEOUT_MS
    );
    assert.strictEqual(
      readOpenAILLMConfig({ LLM_API_KEY: 'k', LLM_MODEL: 'm', LLM_TIMEOUT_MS: '-1' })?.timeoutMs,
      DEFAULT_LLM_TIMEOUT_MS
    );
  });
});

// ---------------------------------------------------------------------------
// Question text validation — single, bounded, non-verdict question
// ---------------------------------------------------------------------------
describe('isValidQuestionText', () => {
  it('accepts a normal single question', () => {
    assert.strictEqual(isValidQuestionText(VALID_QUESTION), true);
    assert.strictEqual(isValidQuestionText('  你能举一个例子吗？  '), true);
  });

  it('accepts a question at exactly the length limit', () => {
    assert.strictEqual(
      isValidQuestionText(`${'长'.repeat(MAX_QUESTION_CHARS - 1)}？`),
      true
    );
  });

  it('rejects empty or whitespace-only content', () => {
    assert.strictEqual(isValidQuestionText(''), false);
    assert.strictEqual(isValidQuestionText('   \n  '), false);
  });

  it('rejects overlong content', () => {
    assert.strictEqual(
      isValidQuestionText(`${'长'.repeat(MAX_QUESTION_CHARS)}？`),
      false
    );
  });

  it('rejects content that does not end with a question mark', () => {
    assert.strictEqual(isValidQuestionText('你的观点是正确的。'), false);
    assert.strictEqual(isValidQuestionText('这个观点很有道理！'), false);
  });

  it('rejects multiple questions', () => {
    assert.strictEqual(isValidQuestionText('第一个问题？第二个问题？'), false);
  });

  it('rejects content containing line breaks', () => {
    assert.strictEqual(isValidQuestionText('你觉得呢？\n再想想？'), false);
  });

  it('rejects verdicts and answers on the user\'s behalf', () => {
    assert.strictEqual(isValidQuestionText('你是对的，你同意吗？'), false);
    assert.strictEqual(isValidQuestionText('你的观点是正确的，需要补充什么吗？'), false);
    assert.strictEqual(isValidQuestionText('你的观点是错误的，你认同吗？'), false);
    assert.strictEqual(isValidQuestionText('评分：你的观点是正确的，你觉得呢？'), false);
    assert.strictEqual(isValidQuestionText('裁决：这个主张成立，你接受吗？'), false);
  });
});

// ---------------------------------------------------------------------------
// extractChoiceContent — untrusted response mapped field-by-field
// ---------------------------------------------------------------------------
describe('extractChoiceContent', () => {
  it('extracts the assistant content from a valid body', () => {
    assert.strictEqual(extractChoiceContent(chatResponse('你好？')), '你好？');
  });

  it('returns null for any malformed shape', () => {
    assert.strictEqual(extractChoiceContent(null), null);
    assert.strictEqual(extractChoiceContent('text'), null);
    assert.strictEqual(extractChoiceContent({}), null);
    assert.strictEqual(extractChoiceContent({ choices: [] }), null);
    assert.strictEqual(extractChoiceContent({ choices: ['nope'] }), null);
    assert.strictEqual(extractChoiceContent({ choices: [{ message: {} }] }), null);
    assert.strictEqual(extractChoiceContent({ choices: [{ message: { content: 42 } }] }), null);
    assert.strictEqual(extractChoiceContent({ choices: [{ message: { content: null } }] }), null);
  });
});

// ---------------------------------------------------------------------------
// buildStrategyQuestionMessages — the request boundary (guardrail)
// ---------------------------------------------------------------------------
describe('buildStrategyQuestionMessages: request boundary', () => {
  it('contains exactly one system and one user message', () => {
    const messages = buildStrategyQuestionMessages('M1_evidence', makeSession());
    assert.strictEqual(messages.length, 2);
    assert.deepStrictEqual(
      messages.map((m) => m.role),
      ['system', 'user']
    );
  });

  it('the system message carries the strategy instruction and the safety constraints', () => {
    const system = buildStrategyQuestionMessages('M1_evidence', makeSession())[0]!.content;
    assert.ok(system.includes('证据追问'), `system must name the strategy: ${system}`);
    assert.ok(
      system.includes('要求具体的数据或例子'),
      `system must carry the strategy requirement: ${system}`
    );
    assert.ok(
      system.includes('不替用户作答'),
      `system must forbid answering for the user: ${system}`
    );
    assert.ok(
      system.includes('不输出观点裁决'),
      `system must forbid verdicts: ${system}`
    );
    assert.ok(
      !system.includes(STANCE_TEXT),
      'the context must live in the user message, not the system message'
    );
  });

  it('the strategy instruction follows the engine-picked strategy', () => {
    const system = buildStrategyQuestionMessages('M2_premise', makeSession())[0]!.content;
    assert.ok(system.includes('前提追问'));
    assert.ok(system.includes('揭示未明说的前提假设'));
  });

  it('the user message carries only the allowed context: stance, latest answer, evidence', () => {
    const { content } = buildStrategyQuestionMessages('M1_evidence', makeSession())[1]!;
    assert.ok(content.includes(STANCE_TEXT), `must include the selected stance: ${content}`);
    assert.ok(content.includes(LATEST_ANSWER), `must include the latest answer: ${content}`);
    assert.ok(content.includes(SOURCE_TITLE), `must include evidence titles: ${content}`);
    assert.ok(content.includes(SOURCE_EXCERPT), `must include evidence excerpts: ${content}`);
  });

  it('excludes everything outside the allowed context', () => {
    const { content } = buildStrategyQuestionMessages('M1_evidence', makeSession())[1]!;
    assert.ok(!content.includes(OLD_ANSWER), 'older answers must not be sent');
    assert.ok(!content.includes(UNCERTAIN_TEXT), 'uncertain inputs are not round answers');
    assert.ok(!content.includes(SOURCE_URL), 'source URLs are not part of the evidence fragments');
    assert.ok(!content.includes('s_llm_test'), 'session ids must not be sent');
    assert.ok(!content.includes(REPORT_CONTENT), 'the full report content must not be sent');
    assert.ok(!content.includes(KNOWLEDGE_POINT), 'knowledge points are not report evidence');
    assert.ok(!content.includes('m_1'), 'message ids must not be sent');
  });

  it('truncates evidence titles and excerpts', () => {
    const longTitle = '标'.repeat(200);
    const longExcerpt = '摘'.repeat(300);
    const session = makeSession({
      report: {
        question: 'q',
        title: 't',
        knowledgePoints: [],
        content: 'c',
        viewpoints: [],
        references: [makeSource({ title: longTitle, excerpt: longExcerpt })],
        citations: { 1: makeSource({ title: longTitle, excerpt: longExcerpt }) },
      },
    });
    const { content } = buildStrategyQuestionMessages('M1_evidence', session)[1]!;
    assert.ok(content.includes('标'.repeat(EVIDENCE_TITLE_MAX_CHARS)));
    assert.ok(!content.includes(longTitle), 'the full overlong title must not be sent');
    assert.ok(content.includes('摘'.repeat(EVIDENCE_EXCERPT_MAX_CHARS)));
    assert.ok(!content.includes(longExcerpt), 'the full overlong excerpt must not be sent');
  });

  it('handles a session without stance, answers or usable citations', () => {
    const empty: Session = {
      ...makeSession({
        selectedViewpoint: null,
        report: null,
        messages: [],
      }),
    };
    const { content } = buildStrategyQuestionMessages('M5_restate', empty)[1]!;
    assert.ok(content.length > 0, 'the user message must still be constructible');
    assert.ok(!content.includes(LATEST_ANSWER));
  });
});

// ---------------------------------------------------------------------------
// OpenAICompatibleLLMProvider — success path and request shape
// ---------------------------------------------------------------------------
describe('OpenAICompatibleLLMProvider: success path', () => {
  it('returns the model question text from a valid response', async () => {
    const { provider, calls } = makeProvider(() => jsonResponse(chatResponse(VALID_QUESTION)));
    const question = await provider.generateStrategyQuestion('M1_evidence', makeSession());
    assert.strictEqual(question, VALID_QUESTION);
    assert.strictEqual(calls.length, 1);
  });

  it('posts to {baseUrl}/chat/completions with auth and the configured model', async () => {
    const { provider, calls } = makeProvider(() => jsonResponse(chatResponse(VALID_QUESTION)));
    await provider.generateStrategyQuestion('M4_steelman', makeSession());
    assert.strictEqual(calls[0]!.url, 'https://llm.example/v1/chat/completions');
    assert.strictEqual(calls[0]!.options.method, 'POST');
    assert.strictEqual(calls[0]!.options.headers.Authorization, 'Bearer test-key');
    assert.strictEqual(calls[0]!.options.headers['Content-Type'], 'application/json');
    const body = JSON.parse(calls[0]!.options.body) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
    };
    assert.strictEqual(body.model, 'test-model');
    assert.strictEqual(body.messages.length, 2);
    assert.strictEqual(body.messages[0]!.role, 'system');
    assert.strictEqual(body.messages[1]!.role, 'user');
  });

  it('never mutates the session (the model only fills in question text)', async () => {
    const session = makeSession();
    const snapshot = JSON.stringify(session);
    const ok = makeProvider(() => jsonResponse(chatResponse(VALID_QUESTION)));
    await ok.provider.generateStrategyQuestion('M1_evidence', session);
    assert.strictEqual(JSON.stringify(session), snapshot);
  });
});

// ---------------------------------------------------------------------------
// OpenAICompatibleLLMProvider — every external failure throws (→ withFallback)
// ---------------------------------------------------------------------------
describe('OpenAICompatibleLLMProvider: transport and HTTP failures', () => {
  const cases: Array<[string, FakeLLMHandler, RegExp]> = [
    ['HTTP 401', () => jsonResponse({ error: 'unauthorized' }, 401), /LLM API HTTP 401/],
    ['HTTP 403', () => jsonResponse({ error: 'forbidden' }, 403), /LLM API HTTP 403/],
    ['HTTP 429', () => jsonResponse({ error: 'rate limited' }, 429), /LLM API HTTP 429/],
    ['HTTP 451', () => jsonResponse({ error: 'unavailable' }, 451), /LLM API HTTP 451/],
    ['HTTP 500', () => jsonResponse({ error: 'server error' }, 500), /LLM API HTTP 500/],
  ];

  for (const [name, handler, pattern] of cases) {
    it(`throws on ${name}`, async () => {
      const { provider } = makeProvider(handler);
      await assert.rejects(
        provider.generateStrategyQuestion('M1_evidence', makeSession()),
        pattern
      );
    });
  }

  it('throws on a network error', async () => {
    const { provider } = makeProvider(() => {
      throw new Error('network down');
    });
    await assert.rejects(provider.generateStrategyQuestion('M1_evidence', makeSession()), /network down/);
  });

  it('times out when the transport ignores the abort signal and never settles', async () => {
    const { provider } = makeProvider(
      () => new Promise<Response>(() => {}),
      { timeoutMs: 20 }
    );
    await assert.rejects(
      provider.generateStrategyQuestion('M1_evidence', makeSession()),
      /timeout after 20ms/
    );
  });

  it('throws on an unparseable JSON body', async () => {
    const { provider } = makeProvider(
      () => new Response('not-json', { status: 200, headers: { 'Content-Type': 'application/json' } })
    );
    await assert.rejects(provider.generateStrategyQuestion('M1_evidence', makeSession()));
  });
});

describe('OpenAICompatibleLLMProvider: invalid model responses', () => {
  const invalidBodies: Array<[string, unknown]> = [
    ['an empty choices array', { choices: [] }],
    ['a missing message', { choices: [{ message: {} }] }],
    ['a non-string content', { choices: [{ message: { content: 42 } }] }],
    ['an empty content string', { choices: [{ message: { content: '' } }] }],
    ['a whitespace-only content', { choices: [{ message: { content: '   ' } }] }],
    ['a declarative answer (no question mark)', { choices: [{ message: { content: '你的观点是正确的。' } }] }],
    ['a verdict on the user\'s stance', { choices: [{ message: { content: '你是对的，你同意吗？' } }] }],
    ['multiple questions', { choices: [{ message: { content: '第一问？第二问？' } }] }],
    ['multi-line output', { choices: [{ message: { content: '第一个想法？\n另一个想法？' } }] }],
    ['an overlong answer', { choices: [{ message: { content: `${'长'.repeat(600)}？` } }] }],
  ];

  for (const [name, body] of invalidBodies) {
    it(`rejects ${name} as a failure`, async () => {
      const { provider } = makeProvider(() => jsonResponse(body));
      await assert.rejects(provider.generateStrategyQuestion('M1_evidence', makeSession()));
    });
  }
});

// ---------------------------------------------------------------------------
// withFallback integration: retry once, then the strategy template
// ---------------------------------------------------------------------------
describe('withFallback integration (#20)', () => {
  const session = makeSession();

  it('does not degrade when the retry succeeds', async () => {
    let attempt = 0;
    const { provider, calls } = makeProvider(() => {
      attempt += 1;
      return attempt === 1 ? jsonResponse({}, 500) : jsonResponse(chatResponse(VALID_QUESTION));
    });
    const fb = await withFallback('M1_evidence', session, () =>
      provider.generateStrategyQuestion('M1_evidence', session)
    );
    assert.strictEqual(fb.usedFallback, false, 'a successful retry must not be marked as fallback');
    assert.strictEqual(fb.question, VALID_QUESTION);
    assert.strictEqual(calls.length, 2, 'exactly one retry');
    assert.deepStrictEqual(
      fb.events.map((e) => e.type),
      ['retry', 'success']
    );
  });

  it('falls back to the strategy template after one retry on persistent HTTP failure', async () => {
    const { provider, calls } = makeProvider(() => jsonResponse({}, 503));
    const fb = await withFallback('M2_premise', session, () =>
      provider.generateStrategyQuestion('M2_premise', session)
    );
    assert.strictEqual(fb.usedFallback, true);
    assert.strictEqual(fb.question, STRATEGIES.M2_premise.fallbackTemplate(session));
    assert.strictEqual(calls.length, 2, 'at most one retry — never a third attempt');
    assert.deepStrictEqual(
      fb.events.map((e) => e.type),
      ['retry', 'template']
    );
  });

  it('falls back to the strategy template on timeout', async () => {
    const { provider } = makeProvider(() => new Promise<Response>(() => {}), { timeoutMs: 20 });
    const fb = await withFallback('M6_reversal', session, () =>
      provider.generateStrategyQuestion('M6_reversal', session)
    );
    assert.strictEqual(fb.usedFallback, true);
    assert.strictEqual(fb.question, STRATEGIES.M6_reversal.fallbackTemplate(session));
  });

  it('falls back to the strategy template when the model answers on the user\'s behalf', async () => {
    const { provider } = makeProvider(() =>
      jsonResponse(chatResponse('你的观点是正确的，无需进一步讨论。'))
    );
    const fb = await withFallback('M4_steelman', session, () =>
      provider.generateStrategyQuestion('M4_steelman', session)
    );
    assert.strictEqual(fb.usedFallback, true);
    assert.strictEqual(fb.question, STRATEGIES.M4_steelman.fallbackTemplate(session));
  });

  it('the template fallback question is a real question, never the model text', async () => {
    const { provider } = makeProvider(() => jsonResponse({}, 500));
    const fb = await withFallback('M1_evidence', session, () =>
      provider.generateStrategyQuestion('M1_evidence', session)
    );
    assert.notStrictEqual(fb.question, VALID_QUESTION);
    assert.ok(fb.question.includes('策略模板'), 'the fallback must honestly disclose degradation');
  });
});

// ---------------------------------------------------------------------------
// Factory and server wiring
// ---------------------------------------------------------------------------
describe('createLLMProviderFromEnv and server-providers selection', () => {
  it('returns null without key/model so the fixture path stays active', () => {
    assert.strictEqual(createLLMProviderFromEnv({}), null);
    assert.strictEqual(createLLMProviderFromEnv({ LLM_API_KEY: 'k' }), null);
    assert.strictEqual(createLLMProviderFromEnv({ LLM_MODEL: 'm' }), null);
    assert.strictEqual(createLLMProviderFromEnv({ LLM_API_KEY: ' ', LLM_MODEL: 'm' }), null);
  });

  it('builds a real provider when key and model are configured', () => {
    const provider = createLLMProviderFromEnv({ LLM_API_KEY: 'k', LLM_MODEL: 'm' });
    assert.ok(provider instanceof OpenAICompatibleLLMProvider);
  });

  it('the server picks the fixture provider when no LLM key is configured', async () => {
    const { llmProvider, FixtureLLMProvider } = await import('../../src/lib/server-providers');
    if (process.env.LLM_API_KEY?.trim() && process.env.LLM_MODEL?.trim()) {
      assert.ok(!(llmProvider instanceof FixtureLLMProvider), 'a configured key must enable the real provider');
    } else {
      assert.ok(llmProvider instanceof FixtureLLMProvider, 'without a key the fixture provider must stay active');
    }
  });
});
