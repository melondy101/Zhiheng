// Route-level degradation tests (#21 acceptance 3): with DATABASE_URL
// configured but the database UNREACHABLE (connection-refused port 9 — no
// external service, no credentials, no network egress beyond localhost),
// every storage-touching route must answer with an explicit degradation
// signal instead of pretending the write was persisted remotely.
//
// This file pins process.env.DATABASE_URL before the storage singleton is
// first used; node:test runs each test file in its own process, so this
// never leaks into the other test files (all of which stay in memory mode).
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { POST as interrogatePOST } from '../../src/app/api/interrogate/route';
import { POST as reportPOST } from '../../src/app/api/report/route';
import { GET as sessionGET } from '../../src/app/api/session/route';
import { GET as profileGET, PUT as profilePUT, DELETE as profileDELETE } from '../../src/app/api/profile/route';

process.env.DATABASE_URL = 'postgresql://user:pass@127.0.0.1:9/db';

const OWNER = 'owner-degradation';
const OWNER_HEADERS = { 'content-type': 'application/json', 'x-zhiyan-owner': OWNER };

async function call(
  handler: (request: Request) => Promise<Response>,
  url: string,
  init: RequestInit
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await handler(new Request(url, init));
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe('Storage degradation signals when the configured database is unreachable', () => {
  it('POST /api/interrogate answers 503 with storage:unavailable', async () => {
    const result = await call(interrogatePOST, 'http://localhost:3000/api/interrogate', {
      method: 'POST',
      headers: OWNER_HEADERS,
      body: JSON.stringify({ sessionId: 's_missing', action: 'start', viewpoint: { id: 'v', text: '观点', source: 'user_authored' } }),
    });
    assert.strictEqual(result.status, 503);
    assert.strictEqual(result.body.storage, 'unavailable');
    assert.ok(result.body.error);
  });

  it('POST /api/report still returns the computed report but saved:false — never faking a remote save', async () => {
    const result = await call(reportPOST, 'http://localhost:3000/api/report', {
      method: 'POST',
      headers: OWNER_HEADERS,
      body: JSON.stringify({ question: '降级测试问题', initialOpinion: '' }),
    });
    assert.strictEqual(result.status, 200, 'the report itself is fully computed and returned');
    assert.strictEqual(result.body.saved, false, 'the honest flag must say NOT persisted');
    assert.strictEqual(result.body.storage, 'unavailable');
    assert.ok(result.body.sessionId);
  });

  it('GET /api/session answers 503 with storage:unavailable', async () => {
    const result = await call(
      sessionGET,
      'http://localhost:3000/api/session?id=s_x',
      { method: 'GET', headers: OWNER_HEADERS }
    );
    assert.strictEqual(result.status, 503);
    assert.strictEqual(result.body.storage, 'unavailable');
  });

  it('profile routes answer 503 for every method', async () => {
    for (const [handler, method] of [
      [profileGET, 'GET'],
      [profilePUT, 'PUT'],
      [profileDELETE, 'DELETE'],
    ] as const) {
      const result = await call(handler, 'http://localhost:3000/api/profile', {
        method,
        headers: OWNER_HEADERS,
        body: method === 'PUT' ? JSON.stringify({ profile: { conclusions: [], updatedAt: 1, deletedAt: null } }) : undefined,
      });
      assert.strictEqual(result.status, 503, `${method} must degrade explicitly`);
      assert.strictEqual(result.body.storage, 'unavailable');
    }
  });

  it('still rejects requests without a valid owner header (isolation before degradation)', async () => {
    const result = await call(interrogatePOST, 'http://localhost:3000/api/interrogate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 's_missing', action: 'start' }),
    });
    assert.strictEqual(result.status, 400);
  });
});
