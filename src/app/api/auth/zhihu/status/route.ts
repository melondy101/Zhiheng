import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getZhihuOAuthProvider } from '@/lib/zhihu-oauth';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  return NextResponse.json(getZhihuOAuthProvider().getStatus(auth.userId));
}