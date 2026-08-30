import { NextResponse } from 'next/server';
import { serverStorage } from '@/lib/server-providers';
import type { Session, Message, ReportProgress } from '@/lib/providers';
import { ZhihuSearchProvider, WebSearchProvider } from '@/lib/search-providers';
import { buildReport } from '@/lib/report-builder';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const { question } = await request.json();
  if (!question) {
    return NextResponse.json({ error: 'Missing question' }, { status: 400 });
  }

  // Run searches in parallel
  const zhihuProvider = new ZhihuSearchProvider();
  const webProvider = new WebSearchProvider();

  const [zhihuSources, webSources] = await Promise.all([
    zhihuProvider.search(question),
    webProvider.search(question),
  ]);

  // Build the report with progress tracking
  const { report, progress } = await buildReport({
    question,
    zhihuSources,
    webSources,
  });

  const session: Session = {
    id: `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    question,
    initialOpinion: null,
    report,
    selectedViewpoint: null,
    messages: [],
    resultCard: null,
    completed: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  await serverStorage.saveSession(session);
  return NextResponse.json({ sessionId: session.id, report, progress: progress as ReportProgress[] });
}
