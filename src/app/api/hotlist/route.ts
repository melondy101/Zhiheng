import { NextResponse } from 'next/server';
import { loadHotlistForRoute } from '@/lib/hotlist-route-wiring';

export const runtime = 'nodejs';

/**
 * Real hotlist retrieval (#19 + PRD v4.2 §2): the provider is cache-first
 * when a database snapshot store is available (6h TTL) and degrades
 * live → stale snapshot → demo otherwise. It never throws; without a
 * configured ZHIHU_ACCESS_SECRET it returns the deterministic 10-item demo
 * list labeled source:'demo'.
 */
export async function GET() {
  const result = await loadHotlistForRoute();
  return NextResponse.json(result);
}
