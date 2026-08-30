// Interrogation orchestrator for ticket #15.
//
// This module is the single interrogation seam: every strategy decision
// (round order, checkpoint gating, fallback, uncertain streak) is computed
// HERE and persisted on the session's `interrogation` state. The frontend
// only renders what the API returns; the old client-side planNextRound path
// and the legacy one-round /api/interrogate completion path are both gone.
//
// The API owns the state, but the durable recovery source is the client's
// persisted mirror of the API-returned session: if the server-side in-memory
// store loses a session (dev-server restart), the client re-posts its saved
// snapshot and orchestration resumes from that state — no orchestration
// logic ever runs in the browser.

import type {
  InterrogateAction,
  InterrogateHint,
  InterrogateResponseBody,
  InterrogationState,
  Message,
  Session,
  StorageProvider,
  Viewpoint,
} from './providers';
import { actionAfterAnswer, pickNextStrategy, recordStrategy } from './strategy-engine';
import type { StrategyId } from './strategy-engine';
import { isUncertainAnswer, uncertainResponse, withFallback } from './llm-fallback';

export interface HandleInterrogateInput {
  sessionId: string;
  action: InterrogateAction;
  answer?: string;
  viewpoint?: Viewpoint;
  /**
   * The client's persisted copy of the last API-returned session. Adopted
   * only when server storage has no such session (e.g. after a restart);
   * it is itself a snapshot of previously API-computed state, never
   * client-computed orchestration output.
   */
  sessionSnapshot?: Session | null;
  storage: StorageProvider;
  /** Question-text generator (wired to the server LLM provider by the route). */
  generateQuestion: (strategy: StrategyId, session: Session) => Promise<string>;
}

export type InterrogateResult =
  | { ok: true; body: InterrogateResponseBody }
  | { ok: false; status: number; error: string };

/** Number of user answers already recorded in the session. */
export function answeredRounds(session: Session): number {
  return session.messages.filter((m) => m.role === 'user').length;
}

/**
 * The interrogation state of a session. Returns the persisted state when
 * present; otherwise derives a conservative legacy state from the message
 * history so pre-#15 sessions resume at the right round.
 */
export function interrogationStateOf(session: Session): InterrogationState {
  if (session.interrogation) return session.interrogation;
  const answered = answeredRounds(session);
  return {
    round: answered,
    strategy: null,
    assistantQuestion: null,
    usedFallback: false,
    pendingCheckpoint: answered > 0 && actionAfterAnswer(answered) === 'checkpoint',
    uncertainStreak: 0,
  };
}

/** Streak math for consecutive uncertain answers (#10 semantics preserved). */
export function evaluateStreak(currentStreak: number, answer: string): number {
  return isUncertainAnswer(answer) ? currentStreak + 1 : 0;
}

function makeMessage(text: string): Message {
  return {
    id: `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    role: 'user',
    text,
    timestamp: Date.now(),
  };
}

function toResponseBody(
  session: Session,
  hint: InterrogateHint | null,
  suggestComplete: boolean
): InterrogateResponseBody {
  const state = interrogationStateOf(session);
  return {
    round: state.round,
    strategy: state.strategy,
    question: state.assistantQuestion,
    checkpoint: state.pendingCheckpoint,
    usedFallback: state.usedFallback,
    uncertainStreak: state.uncertainStreak,
    hint,
    suggestComplete,
    completed: session.completed,
    session,
  };
}

/**
 * Plan the next round: pick the strategy, fill the question text via the LLM
 * provider with fallback, persist the strategy history, and store the new
 * interrogation state on the session.
 */
async function planNextRound(
  session: Session,
  generateQuestion: HandleInterrogateInput['generateQuestion'],
  uncertainStreak: number
): Promise<Session> {
  const strategy = pickNextStrategy(session);
  const fb = await withFallback(strategy, session, () => generateQuestion(strategy, session));
  recordStrategy(session, strategy);
  const next: InterrogationState = {
    round: answeredRounds(session) + 1,
    strategy,
    assistantQuestion: fb.question,
    usedFallback: fb.usedFallback,
    pendingCheckpoint: false,
    uncertainStreak,
  };
  return { ...session, interrogation: next, updatedAt: Date.now() };
}

function sanitizeSnapshot(raw: unknown, sessionId: string): Session | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const candidate = raw as Session;
  if (candidate.id !== sessionId || !Array.isArray(candidate.messages)) return null;
  return candidate;
}

/**
 * The one interrogation entry point: load (or rehydrate) the session, apply
 * the requested action, persist everything, and return the full state.
 */
export async function handleInterrogate(input: HandleInterrogateInput): Promise<InterrogateResult> {
  const { sessionId, action, storage, generateQuestion } = input;

  let session = await storage.loadSession(sessionId);
  if (!session) {
    const snapshot = sanitizeSnapshot(input.sessionSnapshot, sessionId);
    if (!snapshot) {
      return { ok: false, status: 404, error: 'Session not found' };
    }
    session = snapshot;
    await storage.saveSession(session);
  }
  if (session.completed) {
    return { ok: false, status: 409, error: 'Session already completed' };
  }
  const state = interrogationStateOf(session);

  if (action === 'start') {
    const viewpoint = input.viewpoint;
    if (
      !viewpoint ||
      typeof viewpoint.text !== 'string' ||
      viewpoint.text.trim().length === 0
    ) {
      return { ok: false, status: 400, error: 'Missing viewpoint' };
    }
    // Idempotent: once an interrogation is running, starting again must not
    // replan or reset the round (e.g. double submit / restore retries).
    if (state.round > 0 && (state.assistantQuestion || state.pendingCheckpoint)) {
      return { ok: true, body: toResponseBody(session, null, false) };
    }
    const selected: Viewpoint = { ...viewpoint, selectedAt: Date.now() };
    const prepared: Session = { ...session, selectedViewpoint: selected };
    const planned = await planNextRound(prepared, generateQuestion, state.uncertainStreak);
    await storage.saveSession(planned);
    return { ok: true, body: toResponseBody(planned, null, false) };
  }

  if (action === 'continue') {
    if (!state.pendingCheckpoint) {
      return { ok: false, status: 409, error: 'No checkpoint decision pending' };
    }
    const planned = await planNextRound(session, generateQuestion, state.uncertainStreak);
    await storage.saveSession(planned);
    return { ok: true, body: toResponseBody(planned, null, false) };
  }

  // action === 'answer'
  if (state.pendingCheckpoint) {
    return { ok: false, status: 409, error: 'Checkpoint decision pending' };
  }
  if (!state.assistantQuestion) {
    return { ok: false, status: 400, error: 'No pending question' };
  }
  const answer = typeof input.answer === 'string' ? input.answer.trim() : '';
  if (!answer) {
    return { ok: false, status: 400, error: 'Missing answer' };
  }

  const streak = evaluateStreak(state.uncertainStreak, answer);

  // #10 observable behavior preserved: the third consecutive uncertain answer
  // is not recorded; the client is told to suggest ending and build the card.
  if (streak >= 3) {
    const updated: Session = {
      ...session,
      interrogation: { ...state, uncertainStreak: streak },
      updatedAt: Date.now(),
    };
    await storage.saveSession(updated);
    return {
      ok: true,
      body: toResponseBody(updated, { message: '建议结束本次诘问并生成成果卡。' }, true),
    };
  }

  const withAnswer: Session = { ...session, messages: [...session.messages, makeMessage(answer)] };
  const hintResponse = streak > 0 ? uncertainResponse(streak, withAnswer) : null;
  const hint: InterrogateHint | null = hintResponse
    ? { message: hintResponse.message, hint: hintResponse.hint }
    : null;

  // After a checkpoint-round answer (5, 8, 11…) the next step is the
  // checkpoint decision, not a new question (#14 state machine).
  if (actionAfterAnswer(state.round) === 'checkpoint') {
    const updated: Session = {
      ...withAnswer,
      interrogation: {
        round: state.round,
        strategy: state.strategy,
        assistantQuestion: null,
        usedFallback: state.usedFallback,
        pendingCheckpoint: true,
        uncertainStreak: streak,
      },
      updatedAt: Date.now(),
    };
    await storage.saveSession(updated);
    return { ok: true, body: toResponseBody(updated, hint, false) };
  }

  const planned = await planNextRound(withAnswer, generateQuestion, streak);
  await storage.saveSession(planned);
  return { ok: true, body: toResponseBody(planned, hint, false) };
}
