import { NextResponse } from 'next/server';
import { extractSessionFromRequest } from '@/lib/auth';
import { getZhihuOAuthProvider } from '@/lib/zhihu-oauth';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const state = url.searchParams.get('state') ?? '';
  const code = url.searchParams.get('authorization_code') ?? '';
  const session = await extractSessionFromRequest(request);
  if (!session || !state || !code) return NextResponse.json({ error: 'ZHIHU_OAUTH_INVALID_CALLBACK' }, { status: 400 });
  const provider = getZhihuOAuthProvider();
  if (!provider.consumeAuthorization(state, session.userId).ok) return NextResponse.json({ error: 'ZHIHU_OAUTH_INVALID_STATE' }, { status: 400 });
  const token = await provider.exchangeCode(code);
  if (!token) return NextResponse.json({ error: 'ZHIHU_OAUTH_TOKEN_EXCHANGE_FAILED' }, { status: 502 });
  const profile = await provider.fetchProfile(token.accessToken);
  if (!profile) return NextResponse.json({ error: 'ZHIHU_OAUTH_PROFILE_FAILED' }, { status: 502 });
  provider.bindAuthorizedUser(session.userId, token.accessToken, profile);
  return NextResponse.redirect(new URL('/', request.url));
}