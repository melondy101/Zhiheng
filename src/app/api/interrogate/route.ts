import { NextResponse } from 'next/server';
import { DemoLLMProvider, storageProvider, isCheckpoint, buildResultCard } from '@/lib/demo-providers';
import type { Session, Message } from '@/lib/providers';

const llmProvider = new DemoLLMProvider();

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const { sessionId, answer } = await request.json();
  if (!sessionId) {
    return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
  }

  const session = await storageProvider.loadSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  // Record user answer
  if (answer) {
    const userMessage: Message = {
      id: `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
      role: 'user',
      text: answer,
      timestamp: Date.now(),
    };
    session.messages.push(userMessage);
  }

  const userTurns = session.messages.filter(m => m.role === 'user').length;

  // Check if session should complete (minimal: 5 turns for ticket #2)
  if (userTurns >= 5) {
    session.completed = true;
    session.resultCard = buildResultCard(session);
    await storageProvider.saveSession(session);

    return NextResponse.json({
      question: null,
      strategyId: null,
      strategyName: null,
      citations: [],
      checkpoint: true,
      turn: userTurns,
      completed: true,
      resultCard: session.resultCard,
    });
  }

  // Checkpoint at turn 5 (after 5 user answers)
  const checkpoint = isCheckpoint(userTurns);

  // Generate next question
  const response = await llmProvider.generateQuestion(session);

  const assistantMessage: Message = {
    id: `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
    role: 'assistant',
    text: response.question,
    strategyId: response.strategyId,
    timestamp: Date.now(),
  };
  session.messages.push(assistantMessage);
  session.updatedAt = Date.now();
  await storageProvider.saveSession(session);

  return NextResponse.json({
    question: response.question,
    strategyId: response.strategyId,
    strategyName: response.strategyName,
    citations: response.citations,
    checkpoint,
    turn: userTurns + 1,
    completed: false,
  });
}
