import { NextRequest, NextResponse } from 'next/server';
import { rewriteQuestionAndSubtitle } from '@/lib/question-rewriter';
import { llmProvider } from '@/lib/server-providers';

export const runtime = 'nodejs';

/**
 * Question Rewriting & Subtitle Generation API endpoint.
 * Accepts a raw question or Zhihu hotlist headline and returns a refined,
 * inquiry-oriented core question along with an elegant 4-14 char subtitle.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { question } = body;

    if (typeof question !== 'string' || !question.trim()) {
      return NextResponse.json(
        { error: 'Invalid or missing question field' },
        { status: 400 }
      );
    }

    const result = await rewriteQuestionAndSubtitle(question.trim(), llmProvider);

    return NextResponse.json({
      ok: true,
      ...result,
      data: result,
    });
  } catch (err) {
    console.error('[api/question-rewrite] Error:', err);
    return NextResponse.json(
      { error: 'Failed to rewrite question' },
      { status: 500 }
    );
  }
}
