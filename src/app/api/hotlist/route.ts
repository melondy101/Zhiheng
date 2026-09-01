import { NextResponse } from 'next/server';
import { createHotlistProvider } from '@/lib/zhihu-retrieval';

export const runtime = 'nodejs';

/**
 * Real hotlist retrieval (#19): degrades live → fresh cache → stale cache →
 * demo internally and never throws. Without a configured ZHIHU_ACCESS_SECRET
 * the provider never touches the network and returns the same deterministic
 * 10-item demo list as before #19, labeled source:'demo'.
 */
export async function GET() {
  const provider = createHotlistProvider();
  const result = await provider.fetchHotlist();
  return NextResponse.json(result);
}
