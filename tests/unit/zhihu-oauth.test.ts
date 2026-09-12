import test from 'node:test';
import assert from 'node:assert/strict';
import { ZhihuOAuthProvider, readZhihuOAuthConfig } from '../../src/lib/zhihu-oauth';

test('OAuth config reports missing credentials without exposing values', () => {
  const config = readZhihuOAuthConfig({});

  assert.equal(config.ready, false);
  assert.deepEqual(config.missing, ['ZHIHU_OAUTH_APP_ID', 'ZHIHU_OAUTH_APP_KEY', 'ZHIHU_OAUTH_REDIRECT_URI']);
});

test('authorization state is bound to one owner and can only be consumed once', () => {
  const provider = new ZhihuOAuthProvider({
    env: {
      ZHIHU_OAUTH_APP_ID: '123',
      ZHIHU_OAUTH_APP_KEY: 'app-key',
      ZHIHU_OAUTH_REDIRECT_URI: 'https://zhiyan.example/auth/zhihu/callback',
    },
    now: () => 1_700_000_000_000,
    randomBytes: () => new Uint8Array(32).fill(7),
  });

  const started = provider.beginAuthorization('owner-a');
  assert.ok(started.ok);
  assert.equal(new URL(started.authorizationUrl).searchParams.get('state'), started.state);

  assert.equal(provider.consumeAuthorization(started.state, 'owner-b').ok, false);
  assert.equal(provider.consumeAuthorization(started.state, 'owner-a').ok, true);
  assert.equal(provider.consumeAuthorization(started.state, 'owner-a').ok, false);
});
test('favorite content read requires an authorized user-selected favorite folder', async () => {
  const originalSecret = process.env.ZHIHU_ACCESS_SECRET;
  const originalFetch = globalThis.fetch;
  process.env.ZHIHU_ACCESS_SECRET = 'test-secret';
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, '/api/v1/user/favlist_contents');
    assert.equal(url.searchParams.get('FavlistUrlToken'), '12345');
    assert.equal(url.searchParams.get('Limit'), '20');
    return new Response(JSON.stringify({ Code: 0, Data: { Items: [] } }));
  };
  try {
    const provider = new ZhihuOAuthProvider({ now: () => 1_700_000_000_000 });
    provider.bindAuthorizedUser('owner-a', 'oauth-token', { id: 'zhihu-user', name: 'User', avatarUrl: null, headline: null });
    const result = await provider.readUserData('owner-a', 'favorite_contents', '12345');
    assert.deepEqual(result, { ok: true, data: { Code: 0, Data: { Items: [] } } });
    assert.deepEqual(await provider.readUserData('owner-a', 'favorite_contents'), { ok: false, reason: 'invalid_favlist' });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalSecret === undefined) delete process.env.ZHIHU_ACCESS_SECRET;
    else process.env.ZHIHU_ACCESS_SECRET = originalSecret;
  }
});
