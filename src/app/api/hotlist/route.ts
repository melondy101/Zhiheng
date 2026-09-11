import { NextResponse } from 'next/server';
import { loadHotlistForRoute, getHotlistRouteDependencies } from '@/lib/hotlist-route-wiring';
import { readOwnerId } from '@/lib/owner-id';
import { checkAndUpdateServerRefreshLimit } from '@/lib/hotlist-refresh-limiter';

export const runtime = 'nodejs';

/**
 * Real hotlist retrieval: the provider caches data hourly by Beijing time
 * (refreshes at the top of every hour). If not on the hour (e.g. 8:30), the 8:00
 * cache is returned.
 *
 * Manual refresh is supported via ?refresh=true or ?force=true, with rate limiting
 * per client/owner. When the quota is exceeded, HTTP 429 is returned.
 */
export async function GET(req: Request) {
  let isManualRefresh = false;
  let ownerId = 'anon';

  if (req) {
    try {
      const url = new URL(req.url, 'http://localhost:3000');
      isManualRefresh = url.searchParams.get('refresh') === 'true' || url.searchParams.get('force') === 'true';
      ownerId = readOwnerId(req) || 'anon';
    } catch {
      // ignore URL parsing errors for bare invocations
    }
  }

  if (isManualRefresh) {
    const limitStatus = checkAndUpdateServerRefreshLimit(ownerId, Date.now());
    if (!limitStatus.allowed) {
      console.warn(
        `[hotlist:manual_refresh] Rate limit reached: ownerId=${ownerId}, count=${limitStatus.currentCount}/${limitStatus.maxLimit}, resetTime=${new Date(limitStatus.resetAt).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai' })}`
      );
      return NextResponse.json(
        {
          error: 'RATE_LIMIT_EXCEEDED',
          reason: 'rate_limit',
          reasonLabel: '达到刷新频率限制',
          message: '当前小时手动刷新次数已达上限（10/10 次）。知乎热榜每隔一个小时整点（北京时间）会自动刷新，请等待下一个整点。',
          ...limitStatus,
        },
        { status: 429 }
      );
    }
    const result = await loadHotlistForRoute(process.env, getHotlistRouteDependencies(), { force: true });
    if (result.refreshError) {
      console.warn(
        `[hotlist:manual_refresh] Upstream live update failed: reason=${result.refreshError.reason}, message=${result.refreshError.message}, detail=${result.refreshError.detail ?? 'none'}`
      );
    } else {
      console.log(`[hotlist:manual_refresh] Live refresh succeeded (source=${result.source}, count=${result.items.length})`);
    }
    return NextResponse.json(result);
  }

  const result = await loadHotlistForRoute(process.env, getHotlistRouteDependencies());
  console.log(`[hotlist:load] Served hotlist: source=${result.source}, stale=${result.stale ?? false}, count=${result.items.length}`);
  return NextResponse.json(result);
}
