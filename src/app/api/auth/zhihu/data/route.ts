import { NextResponse } from 'next/server';
import { extractSessionFromRequest } from '@/lib/auth';
import { getZhihuOAuthProvider } from '@/lib/zhihu-oauth';

export const runtime = 'nodejs';
const resources = new Set(['contents', 'followees', 'favorites', 'recent_favorites', 'favorite_contents']);
type UserResource = 'contents' | 'followees' | 'favorites' | 'recent_favorites' | 'favorite_contents';

export async function POST(request: Request) {
  const session = await extractSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  const body = await request.json().catch(() => null) as { resource?: string; favlistUrlToken?: string } | null;
  if (!body?.resource || !resources.has(body.resource)) return NextResponse.json({ error: 'INVALID_RESOURCE' }, { status: 400 });
  if (body.resource === 'favorite_contents' && !/^\d+$/.test(body.favlistUrlToken ?? '')) {
    return NextResponse.json({ error: 'FAVLIST_URL_TOKEN_REQUIRED' }, { status: 400 });
  }
  const result = await getZhihuOAuthProvider().readUserData(session.userId, body.resource as UserResource, body.favlistUrlToken);
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: result.reason === 'not_authorized' ? 401 : 503 });
  return NextResponse.json({ resource: body.resource, data: result.data });
}
