import { NextResponse } from 'next/server';
import { FixtureLLMProvider, serverStorage } from '@/lib/server-providers';
import type { Session, Message, ResultCard } from '@/lib/providers';

const llmProvider = new FixtureLLMProvider();

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const { sessionId, answer } = await request.json();
  if (!sessionId) {
    return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
  }

  const session = await serverStorage.loadSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  // If answer provided, record user message
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
  const hasAssistant = session.messages.some(m => m.role === 'assistant');

  // After one user reply, complete the session
  if (userTurns >= 1 && hasAssistant) {
    session.completed = true;
    session.resultCard = buildResultCard(session);
    await serverStorage.saveSession(session);
    return NextResponse.json({
      question: null,
      completed: true,
      resultCard: session.resultCard,
    });
  }

  // Generate first question
  const question = await llmProvider.generateQuestion(session);
  const assistantMessage: Message = {
    id: `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
    role: 'assistant',
    text: question,
    timestamp: Date.now(),
  };
  session.messages.push(assistantMessage);
  session.updatedAt = Date.now();
  await serverStorage.saveSession(session);

  return NextResponse.json({
    question,
    completed: false,
  });
}

function buildResultCard(session: Session): ResultCard {
  const userMessages = session.messages.filter(m => m.role === 'user');
  return {
    sessionId: session.id,
    initialStance: session.initialOpinion
      ? { text: session.initialOpinion, source: 'user_authored' }
      : null,
    selectedStartingStance: session.selectedViewpoint
      ? { text: session.selectedViewpoint.text, source: session.selectedViewpoint.source }
      : null,
    finalPosition: userMessages.length > 0 ? userMessages[userMessages.length - 1].text : null,
    messageIds: userMessages.map(m => m.id),
  };
}
