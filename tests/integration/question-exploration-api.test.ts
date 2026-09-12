import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { POST as recommend } from '../../src/app/api/recommendations/questions/route';
import { GET as answers } from '../../src/app/api/questions/answers/route';

const originalFetch = globalThis.fetch;
const originalSecret = process.env.ZHIHU_ACCESS_SECRET;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalSecret === undefined) delete process.env.ZHIHU_ACCESS_SECRET;
  else process.env.ZHIHU_ACCESS_SECRET = originalSecret;
});

test('question recommendation is topic-scoped and capped at five items', async () => {
  process.env.ZHIHU_ACCESS_SECRET = 'test-secret';
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, '/api/v1/user/question_recommendations');
    assert.equal(url.searchParams.get('Query'), 'AI 教育');
    assert.equal(url.searchParams.get('Count'), '5');
    return new Response(JSON.stringify({ Code: 0, Data: { Items: [{ Title: '问题 A', Url: 'https://www.zhihu.com/question/1' }] } }), { status: 200 });
  };

  const response = await recommend(new Request('http://localhost/api/recommendations/questions', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ topic: 'AI 教育' }),
  }));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).questions, [{ title: '问题 A', url: 'https://www.zhihu.com/question/1' }]);
});

test('answer summaries require a Zhihu question URL and remain capped at ten', async () => {
  process.env.ZHIHU_ACCESS_SECRET = 'test-secret';
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, '/api/v1/content/question_answers');
    assert.equal(url.searchParams.get('Limit'), '10');
    return new Response(JSON.stringify({ Code: 0, Data: { Items: [{ Summary: '官方摘要', Url: 'https://www.zhihu.com/answer/1' }], Paging: { IsEnd: true } } }), { status: 200 });
  };

  const response = await answers(new Request('http://localhost/api/questions/answers?url=https%3A%2F%2Fwww.zhihu.com%2Fquestion%2F1'));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).answers, [{ summary: '官方摘要', url: 'https://www.zhihu.com/answer/1' }]);
});