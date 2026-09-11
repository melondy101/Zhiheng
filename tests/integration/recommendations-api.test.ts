import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { POST } from '../../src/app/api/recommendations/route';

const originalFetch = globalThis.fetch;
const originalSecret = process.env.ZHIHU_ACCESS_SECRET;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalSecret === undefined) delete process.env.ZHIHU_ACCESS_SECRET;
  else process.env.ZHIHU_ACCESS_SECRET = originalSecret;
});

describe('POST /api/recommendations', () => {
  it('serializes topic and author expansions to avoid a Zhihu search burst', async () => {
    process.env.ZHIHU_ACCESS_SECRET = 'test-secret';
    let inFlight = 0;
    let maxInFlight = 0;
    const urls: string[] = [];

    globalThis.fetch = async (input) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      urls.push(String(input));
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return new Response(JSON.stringify({
        Code: 0,
        Data: { Items: [{ Title: '推荐材料', ContentText: '摘要', AuthorName: '作者甲', Url: 'https://www.zhihu.com/question/1' }] },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };

    const response = await POST(new Request('http://localhost:3000/api/recommendations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        question: '中国客厅为什么变化',
        sources: [
          { id: 's1', type: 'zhihu', author: '作者甲', title: '甲', url: 'https://www.zhihu.com/question/a', excerpt: 'a' },
          { id: 's2', type: 'zhihu', author: '作者乙', title: '乙', url: 'https://www.zhihu.com/question/b', excerpt: 'b' },
          { id: 's3', type: 'zhihu', author: '作者丙', title: '丙', url: 'https://www.zhihu.com/question/c', excerpt: 'c' },
        ],
      }),
    }));

    assert.strictEqual(response.status, 200);
    assert.strictEqual(urls.length, 4);
    assert.strictEqual(maxInFlight, 1, 'recommendation searches must not overlap');
  });
});
