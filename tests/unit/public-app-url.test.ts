import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPublicAppUrl } from '../../src/lib/public-app-url';

test('OAuth success redirect prefers the configured public CloudBase URL over an internal request origin', () => {
  const url = buildPublicAppUrl(
    '/?zhihu=connected',
    'http://0.0.0.0:3000/api/oauth/callback',
    'https://zhiheng.example.run.tcloudbase.com'
  );

  assert.equal(url.toString(), 'https://zhiheng.example.run.tcloudbase.com/?zhihu=connected');
});

test('OAuth success redirect uses the request origin during local development when no public URL is configured', () => {
  const url = buildPublicAppUrl('/?zhihu=connected', 'http://localhost:3000/api/oauth/callback');

  assert.equal(url.toString(), 'http://localhost:3000/?zhihu=connected');
});
