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
import { isRoundAnswer } from './providers';
import { actionAfterAnswer, pickNextStrategy, recordStrategy } from './strategy-engine';
import type { StrategyId } from './strategy-engine';
import { isUncertainAnswer, uncertainResponse, withFallback } from './llm-fallback';
import { buildNarrowedQuestion, selectRoundSources } from './interrogation-context';
import { buildSimpleResultCard } from './result-card-builder';

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

/** Number of round-advancing answers already recorded in the session (#17). */
export function answeredRounds(session: Session): number {
  return session.messages.filter(isRoundAnswer).length;
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

function makeMessage(text: string, uncertain = false): Message {
  return {
    id: `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    role: 'user',
    text,
    timestamp: Date.now(),
    ...(uncertain ? { uncertain: true } : {}),
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
    // #16: report evidence relevant to the current question, deterministically
    // selected from the session's own report citations (empty when none).
    sources: selectRoundSources(session),
    suggestComplete,
    // #17: the explicit 继续/结束 decision gate after the third uncertain
    // answer — never an automatic completion.
    decisionPending: state.pendingDecision === true,
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
  // #17: the explicit completion action. Must run BEFORE the completed-409
  // guard so re-posting complete on a finished session is an idempotent
  // success (the client retry path) rather than a dead end. The card is
  // built from the saved conversation by the pure result-card builder BEFORE
  // the session is marked completed and persisted — a failed build/save
  // never corrupts the session.
  if (action === 'complete') {
    if (session.completed && session.resultCard) {
      return { ok: true, body: toResponseBody(session, null, false) };
    }
    try {
      const card = buildSimpleResultCard(session);
      const completedSession: Session = {
        ...session,
        completed: true,
        resultCard: card,
        updatedAt: Date.now(),
      };
      await storage.saveSession(completedSession);
      return { ok: true, body: toResponseBody(completedSession, null, false) };
    } catch (err) {
      return {
        ok: false,
        status: 500,
        error: `Failed to complete session: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
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
    if (
      state.round > 0 &&
      (state.assistantQuestion || state.pendingCheckpoint || state.pendingDecision)
    ) {
      return { ok: true, body: toResponseBody(session, null, false) };
    }
    const selected: Viewpoint = { ...viewpoint, selectedAt: Date.now() };
    const prepared: Session = { ...session, selectedViewpoint: selected };
    const planned = await planNextRound(prepared, generateQuestion, state.uncertainStreak);
    await storage.saveSession(planned);
    return { ok: true, body: toResponseBody(planned, null, false) };
  }

  if (action === 'continue') {
    if (state.pendingCheckpoint) {
      const planned = await planNextRound(session, generateQuestion, state.uncertainStreak);
      await storage.saveSession(planned);
      return { ok: true, body: toResponseBody(planned, null, false) };
    }
    if (state.pendingDecision) {
      // #17: explicit continue after the third uncertain answer — the streak
      // resets and a fresh question is planned for the SAME round (no round
      // was completed by uncertain inputs).
      const planned = await planNextRound(session, generateQuestion, 0);
      await storage.saveSession(planned);
      return { ok: true, body: toResponseBody(planned, null, false) };
    }
    return { ok: false, status: 409, error: 'No checkpoint decision pending' };
  }

  // action === 'answer'
  if (state.pendingCheckpoint) {
    return { ok: false, status: 409, error: 'Checkpoint decision pending' };
  }
  if (state.pendingDecision) {
    return { ok: false, status: 409, error: 'Complete-or-continue decision pending' };
  }
  if (!state.assistantQuestion) {
    return { ok: false, status: 400, error: 'No pending question' };
  }
  const answer = typeof input.answer === 'string' ? input.answer.trim() : '';
  if (!answer) {
    return { ok: false, status: 400, error: 'Missing answer' };
  }

  const streak = evaluateStreak(state.uncertainStreak, answer);

  // Every input is recorded — including uncertain ones (#17: an uncertain
  // input is persisted as an uncertain user message and never discarded).
  const withAnswer: Session = {
    ...session,
    messages: [...session.messages, makeMessage(answer, streak > 0)],
  };

  // #17: uncertain answers NEVER advance the round. The first two stay in
  // the current round (1: narrowed question, 2: two directions); the third
  // opens an explicit 继续/结束 decision gate — no auto-completion, no lost
  // input.
  if (streak > 0) {
    if (streak >= 3) {
      const gated: Session = {
        ...withAnswer,
        interrogation: {
          round: state.round,
          strategy: state.strategy,
          assistantQuestion: state.assistantQuestion,
          usedFallback: state.usedFallback,
          pendingCheckpoint: false,
          uncertainStreak: streak,
          pendingDecision: true,
        },
        updatedAt: Date.now(),
      };
      await storage.saveSession(gated);
      const hint = uncertainResponse(streak, withAnswer, state.assistantQuestion);
      return {
        ok: true,
        body: toResponseBody(gated, { message: hint.message, hint: hint.hint }, true),
      };
    }

    let assistantQuestion = state.assistantQuestion;
    let usedFallback = state.usedFallback;
    if (streak === 1) {
      // #17: the narrowed question is a rewrite of the current question,
      // generated through the context seam and the withFallback degradation
      // chain (usedFallback marks an honest template degradation).
      const strategy = state.strategy ?? 'M1_evidence';
      const fb = await withFallback(strategy, withAnswer, async () =>
        buildNarrowedQuestion(withAnswer, state.assistantQuestion)
      );
      assistantQuestion = fb.question;
      usedFallback = fb.usedFallback;
    }
    const updated: Session = {
      ...withAnswer,
      interrogation: {
        round: state.round,
        strategy: state.strategy,
        assistantQuestion,
        usedFallback,
        pendingCheckpoint: false,
        uncertainStreak: streak,
      },
      updatedAt: Date.now(),
    };
    await storage.saveSession(updated);
    const hintResponse = uncertainResponse(streak, withAnswer, assistantQuestion);
    return {
      ok: true,
      body: toResponseBody(updated, { message: hintResponse.message, hint: hintResponse.hint }, false),
    };
  }

  const hint: InterrogateHint | null = null;

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
