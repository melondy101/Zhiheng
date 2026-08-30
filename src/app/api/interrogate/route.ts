// The single interrogation orchestration entry point (#15).
// All strategy decisions (round order, checkpoint gating, LLM fallback,
// uncertain streak) live in the orchestrator; this route only adapts HTTP
// to it and wires the server providers. The legacy one-round completion
// path that used to live here is removed.
import { NextResponse } from 'next/server';
import { llmProvider, serverStorage } from '@/lib/server-providers';
import { handleInterrogate } from '@/lib/interrogation-orchestrator';
import type { InterrogateAction, Session, Viewpoint } from '@/lib/providers';

export const runtime = 'nodejs';

const ACTIONS: InterrogateAction[] = ['start', 'answer', 'continue'];

function isInterrogateAction(value: unknown): value is InterrogateAction {
  return typeof value === 'string' && ACTIONS.includes(value as InterrogateAction);
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const body = payload as {
    sessionId?: unknown;
    action?: unknown;
    answer?: unknown;
    viewpoint?: unknown;
    session?: unknown;
  };

  if (typeof body.sessionId !== 'string' || body.sessionId.length === 0) {
    return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
  }
  if (!isInterrogateAction(body.action)) {
    return NextResponse.json(
      { error: 'Invalid action, expected start | answer | continue' },
      { status: 400 }
    );
  }

  const result = await handleInterrogate({
    sessionId: body.sessionId,
    action: body.action,
    answer: typeof body.answer === 'string' ? body.answer : undefined,
    viewpoint: (body.viewpoint ?? undefined) as Viewpoint | undefined,
    sessionSnapshot: (body.session ?? null) as Session | null,
    storage: serverStorage,
    generateQuestion: (strategy, session) =>
      llmProvider.generateStrategyQuestion(strategy, session),
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result.body);
}
