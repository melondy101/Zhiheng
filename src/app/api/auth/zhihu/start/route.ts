import { NextResponse } from 'next/server';
import { createGuestSession, extractSessionFromRequest, buildSessionCookieString } from '@/lib/auth';
import { getZhihuOAuthProvider } from '@/lib/zhihu-oauth';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const existing = await extractSessionFromRequest(request);
  const guest = existing ? null : await createGuestSession();
  const ownerId = existing?.userId ?? guest!.user.id;
  const started = getZhihuOAuthProvider().beginAuthorization(ownerId);
  if (!started.ok) return NextResponse.json({ error: 'ZHIHU_OAUTH_NOT_CONFIGURED', missing: started.missing }, { status: 503 });
  const response = NextResponse.redirect(started.authorizationUrl);
  if (guest) response.headers.set('Set-Cookie', buildSessionCookieString(guest.token));
  return response;
}