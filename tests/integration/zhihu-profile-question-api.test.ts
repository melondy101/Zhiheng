import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { POST } from '../../src/app/api/recommendations/questions/profile/route';
import { getZhihuOAuthProvider, resetZhihuOAuthProvider } from '../../src/lib/zhihu-oauth';

const originalFetch = globalThis.fetch;
const originalSecret = process.env.ZHIHU_ACCESS_SECRET;

afterEach(() => {
  globalThis.fetch = originalFetch;
  resetZhihuOAuthProvider();
  if (originalSecret === undefined) delete process.env.ZHIHU_ACCESS_SECRET;
  else process.env.ZHIHU_ACCESS_SECRET = originalSecret;
});

test('user-triggered profile recommendation derives a topic from authorized user data', async () => {
  process.env.ZHIHU_ACCESS_SECRET = 'test-secret';
  getZhihuOAuthProvider().bindAuthorizedUser('owner_test123', 'oauth-user-token', {
    id: 'zhihu-user', name: 'User', avatarUrl: null, headline: null,
  });
  const calls: Array<{ path: string; query: URLSearchParams; oauthToken: string | null }> = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({ path: url.pathname, query: url.searchParams, oauthToken: new Headers(init?.headers).get('X-OAuth-Token') });
    if (url.pathname === '/api/v1/user/contents') return new Response(JSON.stringify({ Data: { Items: [{ Title: 'AI 教育实践', Summary: '课堂中的人工智能' }] } }));
    if (url.pathname === '/api/v1/user/followees') return new Response(JSON.stringify({ Data: { Items: [{ Headline: '教育技术研究者' }] } }));
    if (url.pathname === '/api/v1/user/favlists') return new Response(JSON.stringify({ Data: { Items: [{ Title: '学习科学', Description: '学习与技术' }] } }));
    if (url.pathname === '/api/v1/user/question_recommendations') return new Response(JSON.stringify({ Data: { Items: [{ Title: '适合我回答的问题', Url: 'https://www.zhihu.com/question/123' }] } }));
    throw new Error(`Unexpected request: ${url.pathname}`);
  };

  const response = await POST(new Request('http://localhost/api/recommendations/questions/profile', {
    method: 'POST', headers: { 'x-zhiyan-owner': 'owner_test123' },
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { questions: [{ title: '适合我回答的问题', url: 'https://www.zhihu.com/question/123' }] });
  assert.deepEqual(calls.slice(0, 3).map((call) => call.path), [
    '/api/v1/user/contents', '/api/v1/user/followees', '/api/v1/user/favlists',
  ]);
  assert.ok(calls.slice(0, 3).every((call) => call.oauthToken === 'oauth-user-token'));
  const recommendation = calls[3];
  assert.equal(recommendation.path, '/api/v1/user/question_recommendations');
  assert.equal(recommendation.oauthToken, null);
  assert.match(recommendation.query.get('Query') ?? '', /AI 教育实践|学习科学|教育技术研究者/);
});
