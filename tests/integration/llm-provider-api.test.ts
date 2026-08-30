// Ticket #20: degradation contract driven through the REAL API route and the
// REAL OpenAI-compatible provider, with the provider's HTTP transport replaced
// by a fake — no real model is ever requested, no API key or quota is used.
//
// Proven here end-to-end (issue #20 acceptance criteria 1-3):
//   - the strategy engine still owns rounds/strategies when the model succeeds
//   - persistent model failure degrades to the strategy template after at most
//     one retry, and the session, its rounds and every user answer survive
//   - usedFallback is identical in the API response and the persisted session
//   - model text becomes the assistant question, never a user message
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { POST } from '../../src/app/api/interrogate/route';
import { llmProvider, serverStorage } from '../../src/lib/server-providers';
import {
  OpenAICompatibleLLMProvider,
  type LLMCallOptions,
  type OpenAILLMConfig,
} from '../../src/lib/openai-llm-provider';
import { STRATEGIES } from '../../src/lib/strategy-engine';
import type { InterrogateResponseBody, Session, Viewpoint } from '../../src/lib/providers';

const VIEWPOINT: Viewpoint = {
  id: 'v1',
  text: '我认为AI会增强而非取代创造力',
  source: 'ai_suggested_and_selected',
};

const CONFIG: OpenAILLMConfig = {
  baseUrl: 'https://llm.example/v1',
  apiKey: 'test-key',
  model: 'test-model',
  timeoutMs: 5_000,
};

let sessionCounter = 0;

function seedSession(): Session {
  sessionCounter += 1;
  return {
    id: `s_llm_api_${sessionCounter}`,
    question: '测试问题：这个观点的依据是什么？',
    initialOpinion: '我的初始看法',
    report: null,
    selectedViewpoint: null,
    messages: [],
    resultCard: null,
    completed: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

interface HttpResult {
  status: number;
  body: Partial<InterrogateResponseBody> & { error?: string };
}

async function postInterrogate(payload: Record<string, unknown>): Promise<HttpResult> {
  const request = new Request('http://localhost:3000/api/interrogate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const response = await POST(request);
  const body = (await response.json()) as Partial<InterrogateResponseBody> & { error?: string };
  return { status: response.status, body };
}

function chatJson(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Route the interrogation seam through a REAL OpenAICompatibleLLMProvider
 * backed by a fake transport. Returns a restore function that must be called
 * in a finally block.
 */
function installFakeModel(
  handler: (url: string, options: LLMCallOptions) => Response | Promise<Response>,
  overrides: Partial<OpenAILLMConfig> = {}
): () => void {
  const config: OpenAILLMConfig = { ...CONFIG, ...overrides };
  const fake = new OpenAICompatibleLLMProvider({
    config,
    transport: async (url, options) => handler(url, options),
  });
  const original = llmProvider.generateStrategyQuestion.bind(llmProvider);
  llmProvider.generateStrategyQuestion = (strategy, session) =>
    fake.generateStrategyQuestion(strategy, session);
  return () => {
    llmProvider.generateStrategyQuestion = original;
  };
}

describe('POST /api/interrogate with the real OpenAI-compatible provider (#20)', () => {
  it('uses the live model question when the model responds validly; the engine still owns the round', async () => {
    const MODEL_QUESTION = '模型问题：这个主张背后有哪些具体的数据支撑？';
    const restore = installFakeModel(() => chatJson(MODEL_QUESTION));
    try {
      const session = seedSession();
      await serverStorage.saveSession(session);
      const res = await postInterrogate({ sessionId: session.id, action: 'start', viewpoint: VIEWPOINT });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.strategy, 'M1_evidence', 'the engine must still pick the strategy');
      assert.strictEqual(res.body.round, 1, 'the model must not change the round');
      assert.strictEqual(res.body.question, MODEL_QUESTION);
      assert.strictEqual(res.body.usedFallback, false);

      const stored = await serverStorage.loadSession(session.id);
      assert.ok(stored);
      assert.strictEqual(stored.interrogation?.usedFallback, false);
      assert.strictEqual(stored.interrogation?.assistantQuestion, MODEL_QUESTION);
      // The model text is the assistant question — never written into a user message.
      assert.ok(!stored.messages.some((m) => m.text === MODEL_QUESTION));
      assert.deepStrictEqual(stored.messages, []);
    } finally {
      restore();
    }
  });

  it('degrades to the strategy template after one retry on persistent failure and loses nothing', async () => {
    let transportCalls = 0;
    const restore = installFakeModel(() => {
      transportCalls += 1;
      return new Response('{}', { status: 500 });
    });
    try {
      const session = seedSession();
      await serverStorage.saveSession(session);
      const res = await postInterrogate({ sessionId: session.id, action: 'start', viewpoint: VIEWPOINT });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(transportCalls, 2, 'at most one retry — never a third attempt');
      assert.strictEqual(res.body.usedFallback, true, 'the fallback state must be visible in the API response');

      const expectedTemplate = STRATEGIES.M1_evidence.fallbackTemplate({
        ...session,
        selectedViewpoint: VIEWPOINT,
      });
      assert.strictEqual(res.body.question, expectedTemplate);
      assert.ok(expectedTemplate.includes('策略模板'), 'the degradation must disclose itself honestly');

      // The persisted session matches the API response.
      const stored = await serverStorage.loadSession(session.id);
      assert.ok(stored);
      assert.strictEqual(stored.interrogation?.usedFallback, true);
      assert.strictEqual(stored.interrogation?.assistantQuestion, expectedTemplate);
      assert.strictEqual(stored.interrogation?.round, 1);
      assert.strictEqual(stored.interrogation?.strategy, 'M1_evidence');

      // The interrogation keeps working after the degradation: the user can
      // answer the template question and rounds advance normally.
      const answer = await postInterrogate({
        sessionId: session.id,
        action: 'answer',
        answer: '第二轮回答：技术进步会扩大人类的表达空间。',
      });
      assert.strictEqual(answer.status, 200);
      assert.strictEqual(answer.body.round, 2, 'the user answer must not be lost');
      assert.strictEqual(answer.body.strategy, 'M2_premise', 'rounds keep advancing after degradation');
    } finally {
      restore();
    }
  });

  it('recovers without template degradation when the retry succeeds', async () => {
    const MODEL_QUESTION = '重试成功的问题：你能举一个具体例子吗？';
    let transportCalls = 0;
    const restore = installFakeModel(() => {
      transportCalls += 1;
      return transportCalls === 1
        ? new Response('{}', { status: 429 })
        : chatJson(MODEL_QUESTION);
    });
    try {
      const session = seedSession();
      await serverStorage.saveSession(session);
      const res = await postInterrogate({ sessionId: session.id, action: 'start', viewpoint: VIEWPOINT });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(transportCalls, 2);
      assert.strictEqual(res.body.usedFallback, false, 'a successful retry must not be marked as fallback');
      assert.strictEqual(res.body.question, MODEL_QUESTION);
    } finally {
      restore();
    }
  });

  it('degrades when the model answers on the user\'s behalf (guardrail), keeping the round intact', async () => {
    const restore = installFakeModel(() => chatJson('你的观点是正确的，无需进一步讨论。'));
    try {
      const session = seedSession();
      await serverStorage.saveSession(session);
      const res = await postInterrogate({ sessionId: session.id, action: 'start', viewpoint: VIEWPOINT });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.usedFallback, true, 'a verdict-like model answer must degrade');
      const expectedTemplate = STRATEGIES.M1_evidence.fallbackTemplate({
        ...session,
        selectedViewpoint: VIEWPOINT,
      });
      assert.strictEqual(res.body.question, expectedTemplate);
      assert.ok(!res.body.question!.includes('你的观点是正确的'), 'the model text must never leak through');
      assert.strictEqual(res.body.round, 1);
      assert.strictEqual(res.body.strategy, 'M1_evidence');
    } finally {
      restore();
    }
  });

  it('degrades on model timeout and the user answer flow survives', async () => {
    const restore = installFakeModel(() => new Promise<Response>(() => {}), { timeoutMs: 20 });
    try {
      const session = seedSession();
      await serverStorage.saveSession(session);
      const res = await postInterrogate({ sessionId: session.id, action: 'start', viewpoint: VIEWPOINT });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.usedFallback, true);
      assert.strictEqual(res.body.round, 1);

      const answer = await postInterrogate({ sessionId: session.id, action: 'answer', answer: '超时后的回答。' });
      assert.strictEqual(answer.status, 200);
      assert.strictEqual(answer.body.round, 2);
    } finally {
      restore();
    }
  });
});
