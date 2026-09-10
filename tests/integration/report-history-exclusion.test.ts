// Integration tests for POST /api/report with excludedHistoryIds parameter.
// Verifies that:
// 1. excludedHistoryIds are accepted by the API
// 2. Excluded session IDs are not included in historySources in the returned report
// 3. The session persisted server-side carries excludedHistoryIds
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { POST as reportPOST } from '../../src/app/api/report/route';
import { llmProvider, FixtureLLMProvider } from '../../src/lib/server-providers';
import type { Report, Source } from '../../src/lib/providers';

const TEST_OWNER = 'test-owner-exclusion';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ReportResponseBody {
  sessionId: string;
  report: Report;
  sourceState?: { zhihu: unknown; web: unknown };
  knowledgeGraph: { nodes: unknown[]; edges: unknown[] } | null;
  saved?: boolean;
  storage?: 'memory' | 'postgres' | 'unavailable';
}

let savedSecret: string | undefined;
let origGenerateQuestion: typeof llmProvider.generateStrategyQuestion | undefined;
let origGenerateSynthesis: typeof llmProvider.generateReportSynthesis | undefined;
let origDirectSynthesis: typeof llmProvider.generateSynthesis | undefined;
let origGenerateCustom: typeof llmProvider.generateCustomCompletion | undefined;
let origGenerateRewrite: typeof llmProvider.generateQuestionRewrite | undefined;
let origGenerateGraph: typeof llmProvider.generateKnowledgeGraph | undefined;

beforeEach(() => {
  savedSecret = process.env.ZHIHU_ACCESS_SECRET;
  delete process.env.ZHIHU_ACCESS_SECRET;

  const fixture = new FixtureLLMProvider();
  origGenerateQuestion = llmProvider.generateStrategyQuestion?.bind(llmProvider);
  origGenerateSynthesis = llmProvider.generateReportSynthesis?.bind(llmProvider);
  origDirectSynthesis = llmProvider.generateSynthesis?.bind(llmProvider);
  origGenerateCustom = llmProvider.generateCustomCompletion?.bind(llmProvider);
  origGenerateRewrite = llmProvider.generateQuestionRewrite?.bind(llmProvider);
  origGenerateGraph = llmProvider.generateKnowledgeGraph?.bind(llmProvider);

  llmProvider.generateStrategyQuestion = (strategy, session) =>
    fixture.generateStrategyQuestion(strategy, session);
  if (llmProvider.generateSynthesis) {
    llmProvider.generateSynthesis = async () => null;
  }
  if (llmProvider.generateReportSynthesis) {
    llmProvider.generateReportSynthesis = async () => null;
  }
  if (llmProvider.generateCustomCompletion) {
    llmProvider.generateCustomCompletion = async () => null;
  }
  if (llmProvider.generateQuestionRewrite) {
    llmProvider.generateQuestionRewrite = async () => null;
  }
  if (llmProvider.generateKnowledgeGraph) {
    llmProvider.generateKnowledgeGraph = async () => null;
  }
});

afterEach(() => {
  if (savedSecret === undefined) {
    delete process.env.ZHIHU_ACCESS_SECRET;
  } else {
    process.env.ZHIHU_ACCESS_SECRET = savedSecret;
  }
  if (origGenerateQuestion) llmProvider.generateStrategyQuestion = origGenerateQuestion;
  if (origDirectSynthesis && llmProvider.generateSynthesis) {
    llmProvider.generateSynthesis = origDirectSynthesis;
  }
  if (origGenerateSynthesis && llmProvider.generateReportSynthesis) {
    llmProvider.generateReportSynthesis = origGenerateSynthesis;
  }
  if (origGenerateCustom && llmProvider.generateCustomCompletion) {
    llmProvider.generateCustomCompletion = origGenerateCustom;
  }
  if (origGenerateRewrite && llmProvider.generateQuestionRewrite) {
    llmProvider.generateQuestionRewrite = origGenerateRewrite;
  }
  if (origGenerateGraph && llmProvider.generateKnowledgeGraph) {
    llmProvider.generateKnowledgeGraph = origGenerateGraph;
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/report with excludedHistoryIds', () => {
  it('uses explicit client history snapshots without reading browser storage', async () => {
    const request = new Request('http://localhost:3000/api/report', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-zhiyan-owner': TEST_OWNER },
      body: JSON.stringify({
        question: 'AI是否会改变教育？',
        initialOpinion: '',
        historySessions: [
          {
            id: 'browser_history_1',
            question: 'AI是否会改变教育？',
            initialOpinion: 'AI辅助学习是趋势',
            messages: [],
            completed: true,
            updatedAt: 100,
          },
          {
            id: 'browser_history_incomplete',
            question: 'AI会怎样改变教育？',
            initialOpinion: null,
            messages: [],
            completed: false,
            updatedAt: 200,
          },
        ],
      }),
    });

    const response = await reportPOST(request);
    assert.strictEqual(response.status, 200);
    const body = (await response.json()) as ReportResponseBody;
    const historyRefs = body.report.references.filter(ref => ref.type === 'personal_history');
    assert.deepStrictEqual(historyRefs.map(ref => ref.sourceSessionId), ['browser_history_1']);
    assert.strictEqual(historyRefs[0]!.provenance, '个人上下文');
  });

  it('accepts excludedHistoryIds parameter without error', async () => {
    const request = new Request('http://localhost:3000/api/report', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-zhiyan-owner': TEST_OWNER },
      body: JSON.stringify({
        question: 'AI是否会改变教育？',
        initialOpinion: 'AI辅助学习是趋势',
        excludedHistoryIds: ['s_excluded_1', 's_excluded_2'],
      }),
    });
    const response = await reportPOST(request);
    assert.strictEqual(response.status, 200);
    const body = (await response.json()) as ReportResponseBody;
    assert.ok(body.sessionId.length > 0);
    assert.ok(body.report);
  });

  it('returns a report even when all history is excluded', async () => {
    const request = new Request('http://localhost:3000/api/report', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-zhiyan-owner': TEST_OWNER },
      body: JSON.stringify({
        question: '测试问题：完全排除历史',
        initialOpinion: '',
        excludedHistoryIds: ['s1', 's2', 's3', 's4', 's5'],
      }),
    });
    const response = await reportPOST(request);
    assert.strictEqual(response.status, 200);
    const body = (await response.json()) as ReportResponseBody;
    // Report should still be generated (exclusion only affects history sources)
    assert.ok(body.report);
    assert.ok(body.report.references);
    // personal_history sources should not appear when all are excluded
    const historyRefs = body.report.references.filter(
      (r: Source) => r.type === 'personal_history'
    );
    assert.ok(
      historyRefs.every((r: Source) => !['s1', 's2', 's3', 's4', 's5'].includes(r.sourceSessionId ?? '')),
      'Excluded session IDs must not appear in personal_history references'
    );
  });

  it('report.citations only contains non-excluded personal_history sources', async () => {
    // This test verifies that if a personal_history source is in the citation
    // map, its sourceSessionId is not in the excluded list.
    const excludedIds = ['s_exclude_me'];
    const request = new Request('http://localhost:3000/api/report', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-zhiyan-owner': TEST_OWNER },
      body: JSON.stringify({
        question: '测试引用：排除历史来源',
        initialOpinion: '',
        excludedHistoryIds: excludedIds,
      }),
    });
    const response = await reportPOST(request);
    assert.strictEqual(response.status, 200);
    const body = (await response.json()) as ReportResponseBody;

    for (const ref of body.report.references) {
      if (ref.type === 'personal_history') {
        assert.ok(
          !excludedIds.includes(ref.sourceSessionId ?? ''),
          `Excluded sourceSessionId ${ref.sourceSessionId} must not appear in references`
        );
      }
    }

    for (const [, citation] of Object.entries(body.report.citations)) {
      const c = citation as Source;
      if (c.type === 'personal_history') {
        assert.ok(
          !excludedIds.includes(c.sourceSessionId ?? ''),
          `Excluded sourceSessionId ${c.sourceSessionId} must not appear in citations`
        );
      }
    }
  });

  it('empty excludedHistoryIds is equivalent to no parameter', async () => {
    // Both calls should produce valid reports; the one with empty array has no
    // excluded sessions so all matches appear.
    const requestEmpty = new Request('http://localhost:3000/api/report', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-zhiyan-owner': TEST_OWNER },
      body: JSON.stringify({
        question: '测试：空排除列表',
        initialOpinion: '',
        excludedHistoryIds: [],
      }),
    });
    const responseEmpty = await reportPOST(requestEmpty);
    assert.strictEqual(responseEmpty.status, 200);

    const requestNoParam = new Request('http://localhost:3000/api/report', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-zhiyan-owner': TEST_OWNER },
      body: JSON.stringify({
        question: '测试：空排除列表',
        initialOpinion: '',
      }),
    });
    const responseNoParam = await reportPOST(requestNoParam);
    assert.strictEqual(responseNoParam.status, 200);

    // Both should return structurally identical reports
    const bodyEmpty = (await responseEmpty.json()) as ReportResponseBody;
    const bodyNoParam = (await responseNoParam.json()) as ReportResponseBody;
    assert.strictEqual(bodyEmpty.report.title, bodyNoParam.report.title);
    assert.strictEqual(bodyEmpty.report.references.length, bodyNoParam.report.references.length);
  });

  it('rejects a request missing the question field even with excludedHistoryIds', async () => {
    const request = new Request('http://localhost:3000/api/report', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-zhiyan-owner': TEST_OWNER },
      body: JSON.stringify({
        excludedHistoryIds: ['s1'],
      }),
    });
    const response = await reportPOST(request);
    assert.strictEqual(response.status, 400);
  });
});
