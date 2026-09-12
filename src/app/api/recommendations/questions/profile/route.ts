import { NextResponse } from 'next/server';
import { extractSessionFromRequest } from '@/lib/auth';
import { getZhihuOAuthProvider } from '@/lib/zhihu-oauth';
import { recommendQuestions } from '@/lib/zhihu-question-api';

export const runtime = 'nodejs';

type UserDataResult = { ok: true; data: unknown } | { ok: false; reason: string };

function topicFromUserData(results: UserDataResult[]): string | null {
  const signals = results.flatMap((result) => {
    if (!result.ok || !result.data || typeof result.data !== 'object') return [];
    const root = result.data as { Data?: { Items?: unknown[] } };
    return Array.isArray(root.Data?.Items) ? root.Data.Items : [];
  }).flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    return ['Title', 'Summary', 'Headline', 'Description'].flatMap((key) => {
      const value = record[key];
      return typeof value === 'string' && value.trim() ? [value.trim()] : [];
    });
  });
  const topic = [...new Set(signals)].join(' ').slice(0, 120).trim();
  return topic || null;
}

export async function POST(request: Request) {
  const session = await extractSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
  const provider = getZhihuOAuthProvider();
  if (!provider.getAuthorizedAccessToken(session.userId)) {
    return NextResponse.json({ error: 'ZHIHU_OAUTH_AUTHORIZATION_REQUIRED' }, { status: 401 });
  }

  const data = await Promise.all([
    provider.readUserData(session.userId, 'contents'),
    provider.readUserData(session.userId, 'followees'),
    provider.readUserData(session.userId, 'favorites'),
  ]);
  if (data.some((result) => !result.ok)) {
    return NextResponse.json({ error: 'ZHIHU_PROFILE_DATA_UNAVAILABLE' }, { status: 503 });
  }
  const topic = topicFromUserData(data);
  if (!topic) return NextResponse.json({ questions: [], reason: 'ZHIHU_PROFILE_INSUFFICIENT' });

  const questions = await recommendQuestions(topic);
  if (!questions) return NextResponse.json({ error: 'ZHIHU_PROFILE_RECOMMENDATION_UNAVAILABLE' }, { status: 503 });
  return NextResponse.json({ questions });
}
