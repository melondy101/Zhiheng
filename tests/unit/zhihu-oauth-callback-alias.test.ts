import test from 'node:test';
import assert from 'node:assert/strict';

test('legacy CloudBase OAuth callback path resolves to the Zhihu callback handler', async () => {
  const route = await import('../../src/app/api/oauth/callback/route');
  assert.equal(typeof route.GET, 'function');
});
