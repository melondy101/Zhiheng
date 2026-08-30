import { NextResponse } from 'next/server';
import { DemoRetrievalProvider, storageProvider } from '@/lib/demo-providers';
import type { Session } from '@/lib/providers';

const retrievalProvider = new DemoRetrievalProvider();

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const { question } = await request.json();
  if (!question) {
    return NextResponse.json({ error: 'Missing question' }, { status: 400 });
  }

  const report = await retrievalProvider.generateReport(question);
  const session: Session = {
    id: `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    question,
    report,
    initialOpinion: null,
    selectedViewpoint: null,
    messages: [],
    resultCard: null,
    completed: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  await storageProvider.saveSession(session);
  return NextResponse.json({ sessionId: session.id, report });
}
