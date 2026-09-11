import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  getBeijingHourSlot,
  getBeijingHourStart,
  getNextBeijingHourStart,
  getMsUntilNextBeijingHour,
  isHotlistSnapshotFresh,
  checkAndUpdateServerRefreshLimit,
  clearServerRefreshLimiter,
  getClientRefreshStatus,
  recordClientManualRefresh,
  BEIJING_TIMEZONE_OFFSET_MS,
  ONE_HOUR_MS,
} from '../../src/lib/hotlist-refresh-limiter';

describe('hotlist Beijing hourly refresh limiter', () => {
  beforeEach(() => {
    clearServerRefreshLimiter();
  });

  it('calculates Beijing hour slot accurately', () => {
    // 2026-02-02 02:30:00 UTC = 2026-02-02 10:30:00 Beijing Time
    const ts1030 = Date.UTC(2026, 1, 2, 2, 30, 0);
    const ts1045 = Date.UTC(2026, 1, 2, 2, 45, 0);
    const ts1100 = Date.UTC(2026, 1, 2, 3, 0, 0);

    const slot1030 = getBeijingHourSlot(ts1030);
    const slot1045 = getBeijingHourSlot(ts1045);
    const slot1100 = getBeijingHourSlot(ts1100);

    assert.strictEqual(slot1030, slot1045, 'Timestamps in the same Beijing hour share the same slot');
    assert.notStrictEqual(slot1030, slot1100, 'Top of next hour belongs to next slot');
    assert.strictEqual(slot1100, slot1030 + 1, 'Next hour is exactly current slot + 1');
  });

  it('determines freshness based on Beijing hour boundary (e.g. 8:30 uses 8:00 cache)', () => {
    // 08:00:00 Beijing time
    const ts0800 = Date.UTC(2026, 1, 2, 0, 0, 0);
    // 08:30:00 Beijing time
    const ts0830 = Date.UTC(2026, 1, 2, 0, 30, 0);
    // 08:59:59 Beijing time
    const ts0859 = Date.UTC(2026, 1, 2, 0, 59, 59);
    // 09:00:00 Beijing time (top of next hour)
    const ts0900 = Date.UTC(2026, 1, 2, 1, 0, 0);

    // Snapshot saved at 08:00 is fresh for 08:30 and 08:59
    assert.strictEqual(isHotlistSnapshotFresh(ts0800, ts0830), true);
    assert.strictEqual(isHotlistSnapshotFresh(ts0800, ts0859), true);

    // But when 09:00 arrives, snapshot saved at 08:00 or 08:30 is stale
    assert.strictEqual(isHotlistSnapshotFresh(ts0800, ts0900), false);
    assert.strictEqual(isHotlistSnapshotFresh(ts0830, ts0900), false);
  });

  it('calculates time remaining until next top of the hour', () => {
    const ts0830 = Date.UTC(2026, 1, 2, 0, 30, 0);
    const msUntil = getMsUntilNextBeijingHour(ts0830);
    assert.strictEqual(msUntil, 30 * 60 * 1000, 'Exactly 30 minutes until next hour');

    const nextHourStart = getNextBeijingHourStart(ts0830);
    assert.strictEqual(nextHourStart, ts0830 + 30 * 60 * 1000);
  });

  it('rate limits manual refresh to 10 per hour per client and resets next hour', () => {
    const ts0810 = Date.UTC(2026, 1, 2, 0, 10, 0);
    const ownerId = 'user_abc';

    // 1st to 10th manual refresh allowed
    for (let i = 1; i <= 10; i++) {
      const res = checkAndUpdateServerRefreshLimit(ownerId, ts0810, 10, true);
      assert.strictEqual(res.allowed, true, `Refresh #${i} should be allowed`);
      assert.strictEqual(res.currentCount, i);
      assert.strictEqual(res.remaining, 10 - i);
    }

    // 11th manual refresh denied
    const blocked = checkAndUpdateServerRefreshLimit(ownerId, ts0810, 10, true);
    assert.strictEqual(blocked.allowed, false, 'Refresh #11 should be blocked');
    assert.strictEqual(blocked.currentCount, 10);
    assert.strictEqual(blocked.remaining, 0);

    // Read without increment still shows blocked
    const peek = checkAndUpdateServerRefreshLimit(ownerId, ts0810, 10, false);
    assert.strictEqual(peek.allowed, false);

    // Next hour (09:00:00) -> quota resets
    const ts0900 = Date.UTC(2026, 1, 2, 1, 0, 0);
    const nextHour = checkAndUpdateServerRefreshLimit(ownerId, ts0900, 10, true);
    assert.strictEqual(nextHour.allowed, true, 'Next hour quota should reset');
    assert.strictEqual(nextHour.currentCount, 1);
    assert.strictEqual(nextHour.remaining, 9);
  });
});
