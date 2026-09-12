import { NextResponse } from 'next/server';
import { getQuestionAnswerSummaries, isZhihuQuestionUrl } from '@/lib/zhihu-question-api';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const questionUrl = url.searchParams.get('url')?.trim() ?? '';
  if (!isZhihuQuestionUrl(questionUrl)) return NextResponse.json({ error: 'valid Zhihu question url is required' }, { status: 400 });
  const answers = await getQuestionAnswerSummaries(questionUrl);
  if (!answers) return NextResponse.json({ error: 'ZHIHU_QUESTION_ANSWERS_UNAVAILABLE' }, { status: 503 });
  return NextResponse.json({ answers });
}