import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { GET } from '../../src/app/api/zhihu/quota/route';

const originalFetch = globalThis.fetch;
const originalSecret = process.env.ZHIHU_ACCESS_SECRET;
afterEach(() => { globalThis.fetch = originalFetch; if (originalSecret === undefined) delete process.env.ZHIHU_ACCESS_SECRET; else process.env.ZHIHU_ACCESS_SECRET = originalSecret; });

test('quota endpoint requests only the question capability groups', async () => {
  process.env.ZHIHU_ACCESS_SECRET = 'test-secret';
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, '/api/v1/quota');
    assert.equal(url.searchParams.get('APIIDs'), 'creator,question_answers');
    return new Response(JSON.stringify({ Code: 0, Data: { Items: [{ APIID: 'creator', RemainingQuota: 99 }] } }), { status: 200 });
  };
  const response = await GET();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { quotas: [{ apiId: 'creator', remaining: 99 }] });
});