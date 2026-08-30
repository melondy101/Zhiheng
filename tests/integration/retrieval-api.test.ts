// Ticket #19 integration tests: /api/report and /api/hotlist are wired to the
// server-side real retrieval module. Route handlers are exercised directly
// with real Request objects (same pattern as interrogate-api.test.ts).
//
// These tests pin the no-key environment (no ZHIHU_ACCESS_SECRET): the routes
// must behave exactly like the pre-#19 demo experience — demo sources, honest
// 'demo' source state, and no external call. Live-path behavior with a secret
// is covered by the injectable-transport contract tests in
// tests/unit/zhihu-retrieval.test.ts (no key is available in this repo's CI).
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { POST as reportPOST } from '../../src/app/api/report/route';
import { GET as hotlistGET } from '../../src/app/api/hotlist/route';
import type { Report, SourceState } from '../../src/lib/providers';

interface ReportResponseBody {
  sessionId: string;
  report: Report;
  sourceState?: { zhihu: SourceState; web: SourceState };
  knowledgeGraph: { nodes: unknown[]; edges: unknown[] } | null;
}

let savedSecret: string | undefined;

beforeEach(() => {
  savedSecret = process.env.ZHIHU_ACCESS_SECRET;
  delete process.env.ZHIHU_ACCESS_SECRET;
});

afterEach(() => {
  if (savedSecret === undefined) {
    delete process.env.ZHIHU_ACCESS_SECRET;
  } else {
    process.env.ZHIHU_ACCESS_SECRET = savedSecret;
  }
});

describe('POST /api/report without a configured secret (#19 no-key equivalence)', () => {
  it('returns a demo-sourced report with honest source state and a graph', async () => {
    const request = new Request('http://localhost:3000/api/report', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: '集成测试问题：AI 会取代程序员吗？', initialOpinion: '' }),
    });
    const response = await reportPOST(request);
    assert.strictEqual(response.status, 200);
    const body = (await response.json()) as ReportResponseBody;

    assert.ok(body.sessionId.length > 0);
    assert.ok(body.report);

    // Honest source state: no key → demo, never live.
    assert.ok(body.sourceState);
    assert.strictEqual(body.sourceState.zhihu, 'demo');
    assert.strictEqual(body.sourceState.web, 'demo');

    // Citations and references only contain provider-shaped records.
    assert.ok(body.report.references.length > 0);
    for (const ref of body.report.references) {
      assert.ok(ref.type === 'zhihu' || ref.type === 'web');
      assert.ok(typeof ref.id === 'string' && ref.id.length > 0);
    }
    const citationCount = Object.keys(body.report.citations).length;
    assert.strictEqual(citationCount, body.report.references.length);

    // Knowledge graph still builds from the report sources.
    assert.ok(body.knowledgeGraph);
    assert.ok(body.knowledgeGraph!.nodes.length > 0);
  });

  it('rejects a request without a question', async () => {
    const request = new Request('http://localhost:3000/api/report', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    const response = await reportPOST(request);
    assert.strictEqual(response.status, 400);
  });
});

describe('GET /api/hotlist without a configured secret (#19 no-key equivalence)', () => {
  it('returns the deterministic 10-item demo hotlist with demo source state', async () => {
    const response = await hotlistGET();
    assert.strictEqual(response.status, 200);
    const body = (await response.json()) as {
      items: Array<{ id: string; title: string; url: string | null }>;
      source: SourceState;
      updatedAt: number;
      stale?: boolean;
    };
    assert.strictEqual(body.source, 'demo');
    assert.strictEqual(body.items.length, 10);
    for (const item of body.items) {
      assert.ok(item.id && item.title && item.url);
    }
    assert.ok(typeof body.updatedAt === 'number');
    assert.ok(body.stale === undefined);
  });
});
