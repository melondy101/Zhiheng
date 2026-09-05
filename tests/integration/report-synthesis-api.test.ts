// Ticket T2 (PRD v4.2 §3): the synthesis contract end to end.
//
// The route is exercised for real (no key in the test environment, so it
// must not label material excerpts as AI viewpoints). The model path is
// exercised through buildReport with an injected fake provider.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { POST as reportPOST } from '../../src/app/api/report/route';
import { buildReport } from '../../src/lib/report-builder';
import type {
  LLMProvider,
  Report,
  ReportSynthesis,
  Source,
} from '../../src/lib/providers';
import type { SynthesisRequest } from '../../src/lib/report-synthesis';

const TEST_OWNER = 'test-owner-synthesis';

interface ReportResponseBody {
  sessionId: string;
  report: Report;
}

function source(id: string, type: Source['type'], title: string, excerpt: string): Source {
  return { id, type, author: null, title, url: null, excerpt };
}

const TWO_SOURCES: Source[] = [
  source('zh_1', 'zhihu', '社区讨论：AI 与工程岗位', '多数从业者认为短期内不会取代，因为需求理解难以自动化。'),
  source('web_1', 'web', '自动化与岗位结构', '历史数据显示自动化改变岗位结构，但总量未必下降。'),
];

/** Every viewpoint must be traceable and non-empty; returns the failures. */
function synthesisViolations(report: Report): string[] {
  const problems: string[] = [];
  const synthesis = report.synthesis;
  if (!synthesis) return ['report.synthesis is missing'];
  if (synthesis.viewpoints.length === 0) problems.push('no viewpoints');

  for (const viewpoint of synthesis.viewpoints) {
    if (viewpoint.conclusion.trim().length === 0) problems.push('empty conclusion');
    if (viewpoint.evidence.length === 0) problems.push(`no evidence: ${viewpoint.id}`);
    for (const item of viewpoint.evidence) {
      if (item.citationIds.length === 0) problems.push(`unbacked evidence: ${viewpoint.id}`);
      for (const id of item.citationIds) {
        if (!report.citations[id]) problems.push(`dangling citation ${id}`);
      }
    }
  }
  return problems;
}

const REMOVED_SECTIONS = ['反证或不同观点：', '局限：', '## 尚待验证', '## 最终判断', '## 问题关联'];

let savedSecret: string | undefined;
let savedLlmKey: string | undefined;

beforeEach(() => {
  savedSecret = process.env.ZHIHU_ACCESS_SECRET;
  savedLlmKey = process.env.LLM_API_KEY;
  delete process.env.ZHIHU_ACCESS_SECRET;
  delete process.env.LLM_API_KEY;
});

afterEach(() => {
  if (savedSecret === undefined) delete process.env.ZHIHU_ACCESS_SECRET;
  else process.env.ZHIHU_ACCESS_SECRET = savedSecret;
  if (savedLlmKey === undefined) delete process.env.LLM_API_KEY;
  else process.env.LLM_API_KEY = savedLlmKey;
});

describe('POST /api/report synthesis (PRD v4.2 §3)', () => {
  it('does not fabricate core viewpoints when no AI synthesis is available', async () => {
    const request = new Request('http://localhost:3000/api/report', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-zhiyan-owner': TEST_OWNER },
      body: JSON.stringify({ question: 'AI 会取代程序员吗？', initialOpinion: '' }),
    });
    const response = await reportPOST(request);
    assert.strictEqual(response.status, 200);
    const body = (await response.json()) as ReportResponseBody;

    assert.strictEqual(body.report.synthesis, undefined);
    assert.deepStrictEqual(body.report.viewpoints, [
      '当前未能生成 AI 综合观点；请在 AI 服务可用后重新生成报告。',
    ]);
  });

  it('the report body no longer renders the removed standalone sections', async () => {
    const request = new Request('http://localhost:3000/api/report', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-zhiyan-owner': TEST_OWNER },
      body: JSON.stringify({ question: '测试问题', initialOpinion: '' }),
    });
    const response = await reportPOST(request);
    const body = (await response.json()) as ReportResponseBody;

    for (const section of REMOVED_SECTIONS) {
      assert.ok(
        !body.report.content.includes(section),
        `removed section must be gone: ${section}`
      );
    }
    // The legacy plain-text viewpoints must no longer be excerpt truncations.
    for (const line of body.report.viewpoints) {
      assert.ok(!line.includes('（无摘要）') || line.startsWith('当前材料'), 'no excerpt as viewpoint');
    }
  });
});

/** A fake model-backed provider whose behavior the test controls. */
function fakeLLM(handler: (request: SynthesisRequest) => Promise<ReportSynthesis | null>): LLMProvider {
  return {
    async generateStrategyQuestion() {
      return '这是一个策略问题？';
    },
    async generateSynthesis(request) {
      return handler(request);
    },
  };
}

describe('buildReport synthesis wiring (PRD v4.2 §3)', () => {
  it('uses a valid model synthesis verbatim', async () => {
    const synthesis: ReportSynthesis = {
      viewpoints: [
        {
          id: 'vp_1',
          conclusion: '短期内 AI 难以独立承担需求理解，因此不会整体取代程序员。',
          evidence: [{ summary: '从业者认为需求理解难以自动化。', citationIds: [1] }],
        },
        {
          id: 'vp_2',
          conclusion: '自动化更可能重塑岗位结构而非减少总量。',
          evidence: [{ summary: '历史数据支持岗位结构变化。', citationIds: [2] }],
        },
      ],
    };
    const { report } = await buildReport({
      question: 'AI 会取代程序员吗？',
      zhihuSources: [TWO_SOURCES[0]!],
      webSources: [TWO_SOURCES[1]!],
      llmProvider: fakeLLM(async () => synthesis),
    });

    assert.deepStrictEqual(report.synthesis, synthesis, 'a valid model synthesis is used as-is');
    assert.deepStrictEqual(synthesisViolations(report), []);
    assert.deepStrictEqual(report.viewpoints, [
      '观点 1：短期内 AI 难以独立承担需求理解，因此不会整体取代程序员。',
      '观点 2：自动化更可能重塑岗位结构而非减少总量。',
    ]);
  });

  it('orders citations for the reader: Zhihu, web, then personal history', async () => {
    const { report } = await buildReport({
      question: '测试问题',
      zhihuSources: [TWO_SOURCES[0]!],
      webSources: [TWO_SOURCES[1]!],
      historySources: [source('history_1', 'personal_history', '我的旧报告', '历史报告中的相关分析。')],
      llmProvider: fakeLLM(async () => null),
    });

    assert.deepStrictEqual(
      report.references.map((item) => item.type),
      ['zhihu', 'web', 'personal_history']
    );
  });

  it('omits synthesis when the model throws instead of turning excerpts into viewpoints', async () => {
    const { report } = await buildReport({
      question: 'AI 会取代程序员吗？',
      zhihuSources: [TWO_SOURCES[0]!],
      webSources: [TWO_SOURCES[1]!],
      llmProvider: fakeLLM(async () => {
        throw new Error('LLM API HTTP 429');
      }),
    });

    assert.strictEqual(report.synthesis, undefined);
    assert.deepStrictEqual(report.viewpoints, [
      '当前未能生成 AI 综合观点；请在 AI 服务可用后重新生成报告。',
    ]);
  });

  it('omits synthesis when the model declines (returns null)', async () => {
    const { report } = await buildReport({
      question: '测试问题',
      zhihuSources: [TWO_SOURCES[0]!],
      webSources: [],
      llmProvider: fakeLLM(async () => null),
    });
    assert.strictEqual(report.synthesis, undefined);
  });

  it('one material does not yield a viewpoint without AI synthesis', async () => {
    const { report } = await buildReport({
      question: '测试问题',
      zhihuSources: [TWO_SOURCES[0]!],
      webSources: [],
      llmProvider: fakeLLM(async () => null),
    });
    assert.strictEqual(report.synthesis, undefined);
  });

  it('no material yields no synthesis rather than an invented one', async () => {
    const { report } = await buildReport({
      question: '测试问题',
      zhihuSources: [],
      webSources: [],
      llmProvider: fakeLLM(async () => null),
    });
    assert.strictEqual(report.synthesis, undefined, 'nothing to synthesize and nothing invented');
  });

  it('a model response whose viewpoints are all title lifts is rejected, not used', async () => {
    const { report } = await buildReport({
      question: 'AI 会取代程序员吗？',
      zhihuSources: [TWO_SOURCES[0]!],
      webSources: [TWO_SOURCES[1]!],
      llmProvider: fakeLLM(async () => ({
        summary: '综合结论。',
        viewpoints: [
          {
            id: 'vp_1',
            conclusion: '社区讨论：AI 与工程岗位',
            evidence: [{ summary: '依据。', citationIds: [1] }],
          },
        ],
      })),
    });
    assert.strictEqual(report.synthesis, undefined, 'invalid model output must not be used');
    const fallback = await buildReport({
      question: 'AI 会取代程序员吗？',
      zhihuSources: [TWO_SOURCES[0]!],
      webSources: [TWO_SOURCES[1]!],
      llmProvider: fakeLLM(async () => {
        throw new Error('synthesis failed validation');
      }),
    });
    assert.strictEqual(fallback.report.synthesis, undefined);
  });
});
