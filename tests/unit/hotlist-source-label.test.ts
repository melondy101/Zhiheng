// PRD v4.2 §2.3 pins the exact hotlist source wording shown on the home page.
// The e2e suite lives in a separate npm script, so without this file a
// regression in the label text would never be caught by `npm test`.
//
// The expected strings are asserted as complete literals (never `includes`):
// the timestamp is built from local calendar fields and `sourceLabel` formats
// it back with local getters, so the round trip is exact on any timezone.
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { sourceLabel } from '../../src/app/components/HomePage';

// 2026-09-02 14:30 in the machine's local timezone.
const TIMESTAMP = new Date(2026, 8, 2, 14, 30, 0, 0).getTime();
const FORMATTED = '2026-09-02 14:30';

describe('hotlist source label — PRD v4.2 §2.3 wording', () => {
  it('pre-formatting sanity: the fixture round trips to the expected literal', () => {
    // Guards the fixture itself: if this fails, the four cases below were
    // never actually testing the intended timestamp.
    const d = new Date(TIMESTAMP);
    const pad = (n: number) => n.toString().padStart(2, '0');
    assert.strictEqual(
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
      FORMATTED
    );
  });

  it('live data is labelled 实时热榜', () => {
    assert.strictEqual(sourceLabel('live', TIMESTAMP), '实时热榜');
  });

  it('a fresh cache shows 缓存 · 更新于 <time>', () => {
    assert.strictEqual(sourceLabel('cache', TIMESTAMP), `缓存 · 更新于 ${FORMATTED}`);
  });

  it('an expired cache shows 缓存已过期 · 更新于 <time>', () => {
    assert.strictEqual(sourceLabel('cache', TIMESTAMP, true), `缓存已过期 · 更新于 ${FORMATTED}`);
  });

  it('demo data is disclosed as 演示数据', () => {
    assert.strictEqual(sourceLabel('demo', TIMESTAMP), '演示数据');
  });

  it('the stale flag never changes the live or demo wording', () => {
    assert.strictEqual(sourceLabel('live', TIMESTAMP, true), '实时热榜');
    assert.strictEqual(sourceLabel('demo', TIMESTAMP, true), '演示数据');
  });
});
