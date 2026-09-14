import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  isZhihuAuthFailed,
  recordZhihuAuthFailure,
  clearZhihuAuthFailure,
  prefetchHotlistTopics,
} from '../../src/lib/zhihu-prefetch';

describe('zhihu-prefetch auth tracking', () => {
  const originalSecret = process.env.ZHIHU_ACCESS_SECRET;

  beforeEach(() => {
    clearZhihuAuthFailure();
  });

  it('reports false when no failure has been recorded', () => {
    process.env.ZHIHU_ACCESS_SECRET = 'valid-or-untested-secret';
    assert.strictEqual(isZhihuAuthFailed(), false);
  });

  it('reports true after recording failure for the active secret', () => {
    process.env.ZHIHU_ACCESS_SECRET = 'bad-secret-123';
    recordZhihuAuthFailure('bad-secret-123');
    assert.strictEqual(isZhihuAuthFailed(), true);
  });

  it('clears failed state when secret changes', () => {
    process.env.ZHIHU_ACCESS_SECRET = 'bad-secret-123';
    recordZhihuAuthFailure('bad-secret-123');
    assert.strictEqual(isZhihuAuthFailed(), true);

    process.env.ZHIHU_ACCESS_SECRET = 'new-different-secret';
    assert.strictEqual(isZhihuAuthFailed(), false);
  });

  it('clears state on explicit clear', () => {
    process.env.ZHIHU_ACCESS_SECRET = 'bad-secret-123';
    recordZhihuAuthFailure('bad-secret-123');
    assert.strictEqual(isZhihuAuthFailed(), true);

    clearZhihuAuthFailure();
    assert.strictEqual(isZhihuAuthFailed(), false);
  });

  it('noop on prefetchHotlistTopics when auth is known to be failed', () => {
    process.env.ZHIHU_ACCESS_SECRET = 'bad-secret-123';
    recordZhihuAuthFailure('bad-secret-123');

    // Should return immediately without starting any workers or throwing
    prefetchHotlistTopics([{ id: 'test-1', title: '测试热榜话题', url: null }]);
    assert.strictEqual(isZhihuAuthFailed(), true);

    // Restore
    if (originalSecret !== undefined) {
      process.env.ZHIHU_ACCESS_SECRET = originalSecret;
    } else {
      delete process.env.ZHIHU_ACCESS_SECRET;
    }
  });
});
