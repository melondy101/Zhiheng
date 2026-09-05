// The single interrogation orchestration entry point (#15).
// All strategy decisions (round order, checkpoint gating, LLM fallback,
// uncertain streak) live in the orchestrator; this route only adapts HTTP
// to it and wires the server providers. The legacy one-round completion
// path that used to live here is removed.
//
// #21: every request must carry the anonymous ownership header
// (`x-zhiyan-owner`); storage is scoped to that owner, so different
// anonymous devices cannot read each other's sessions. When the configured
// database is unavailable the route answers 503 with storage:'unavailable'
// — the client keeps its localStorage mirror and never assumes the write
// was persisted remotely.
import { NextResponse } from 'next/server';
import { llmProvider } from '@/lib/server-providers';
import { getServerStorage, StorageUnavailableError } from '@/lib/server-storage';
import { readOwnerId } from '@/lib/owner-id';
import { handleInterrogate } from '@/lib/interrogation-orchestrator';
import type { InterrogateAction, Session, Viewpoint } from '@/lib/providers';
import type { QuickTargetId, SessionMode, TransitionActionId } from '@/lib/mode-config';

export const runtime = 'nodejs';

const ACTIONS: InterrogateAction[] = [
  'start',
  'answer',
  'continue',
  'complete',
  'transition',
  'set_target',
];

function isInterrogateAction(value: unknown): value is InterrogateAction {
  return typeof value === 'string' && ACTIONS.includes(value as InterrogateAction);
}

export async function POST(request: Request) {
  const ownerId = readOwnerId(request);
  if (!ownerId) {
    return NextResponse.json(
      { error: 'Missing or invalid x-zhiyan-owner header' },
      { status: 400 }
    );
  }

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
    optimisticId?: unknown;
    mode?: unknown;
    target?: unknown;
    transitionChoice?: unknown;
  };

  if (typeof body.sessionId !== 'string' || body.sessionId.length === 0) {
    return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
  }
  if (!isInterrogateAction(body.action)) {
    return NextResponse.json(
      { error: 'Invalid action, expected start | answer | continue | complete | transition | set_target' },
      { status: 400 }
    );
  }

  const serverStorage = await getServerStorage();
  const scope = serverStorage.forOwner(ownerId);

  let result;
  try {
    result = await handleInterrogate({
      sessionId: body.sessionId,
      action: body.action,
      answer: typeof body.answer === 'string' ? body.answer : undefined,
      viewpoint: (body.viewpoint ?? undefined) as Viewpoint | undefined,
      sessionSnapshot: (body.session ?? null) as Session | null,
      optimisticId: typeof body.optimisticId === 'string' ? body.optimisticId : null,
      mode: typeof body.mode === 'string' ? (body.mode as SessionMode) : undefined,
      target: typeof body.target === 'string' ? (body.target as QuickTargetId) : undefined,
      transitionChoice:
        typeof body.transitionChoice === 'string'
          ? (body.transitionChoice as TransitionActionId)
          : undefined,
      storage: scope.sessions,
      generateQuestion: (strategy, session) =>
        llmProvider.generateStrategyQuestion(strategy, session),
    });
  } catch (err) {
    if (err instanceof StorageUnavailableError) {
      return NextResponse.json(
        { error: 'Server storage unavailable', storage: 'unavailable' },
        { status: 503 }
      );
    }
    throw err;
  }

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ...result.body, storage: serverStorage.mode });
}
