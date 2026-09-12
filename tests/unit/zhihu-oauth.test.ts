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