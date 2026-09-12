import { NextResponse } from 'next/server';
import { recommendQuestions } from '@/lib/zhihu-question-api';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { topic?: unknown } | null;
  const topic = typeof body?.topic === 'string' ? body.topic.trim() : '';
  if (!topic) return NextResponse.json({ error: 'topic is required' }, { status: 400 });
  const questions = await recommendQuestions(topic);
  if (!questions) return NextResponse.json({ error: 'ZHIHU_QUESTION_RECOMMENDATION_UNAVAILABLE' }, { status: 503 });
  return NextResponse.json({ questions });
}