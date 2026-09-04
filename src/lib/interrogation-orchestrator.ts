// Interrogation orchestrator for ticket #15 and #5 (gentle adaptive).
//
// This module is the single interrogation seam: every strategy decision
// (round order, checkpoint gating, fallback, uncertain streak, gentle
// response) is computed HERE and persisted on the session's `interrogation`
// state. The frontend only renders what the API returns.
//
// #5 gentle: the orchestrator now classifies user intent and generates
// appropriate AI responses — direct answers for questions, acknowledgments
// + strategy questions for responses. Directive rounds track substantive
// responses and drive the three-round summary gate.

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
import { isRoundAnswer, type UserIntent } from './providers';
import { actionAfterAnswer, pickNextStrategy, recordStrategy } from './strategy-engine';
import type { StrategyId } from './strategy-engine';
import { isUncertainAnswer, uncertainResponse, withFallback } from './llm-fallback';
import { buildNarrowedQuestion, selectRoundSources } from './interrogation-context';
import { buildSimpleResultCard } from './result-card-builder';
import {
  classifyIntent,
  completedDirectiveRounds,
  generateGentleResponse,
  gentleStateOf,
  isNonSubstantive,
  shouldSuggestSummary,
  type GentleState,
  type UserIntent,
} from './gentle-interrogation';

export interface HandleInterrogateInput {
  sessionId: string;
  action: InterrogateAction;
  answer?: string;
  viewpoint?: Viewpoint;
  /**
   * #26/T3: the optimistic user message id sent by the client before the
   * API call. When present and matching a `pending` message, the server
   * confirms it as `sent` in the response session so the client can remove
   * the optimistic insert. Absent or mismatched → the optimistic message
   * stays `pending` and the client marks it as `failed`.
   */
  optimisticId?: string | null;
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
    directiveRound: answered,
  };
}

/** Streak math for consecutive uncertain answers (#10 semantics preserved). */
export function evaluateStreak(currentStreak: number, answer: string): number {
  return isUncertainAnswer(answer) ? currentStreak + 1 : 0;
}

function makeMessage(text: string, uncertain = false, intent?: UserIntent): Message {
  return {
    id: `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    role: 'user',
    text,
    timestamp: Date.now(),
    ...(uncertain ? { uncertain: true } : {}),
    ...(intent !== undefined ? { intent } : {}),
  };
}

function makeAssistantMessage(text: string): Message {
  return {
    id: `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    role: 'assistant',
    text,
    timestamp: Date.now(),
  };
}

function toResponseBody(
  session: Session,
  hint: InterrogateHint | null,
  suggestComplete: boolean,
  gentle: { aiReply?: string | null; followUp?: string | null; directiveRound?: number; suggestSummary?: boolean } = {}
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
    sources: selectRoundSources(session),
    suggestComplete,
    decisionPending: state.pendingDecision === true,
    completed: session.completed,
    session,
    // #5: gentle interrogation fields
    aiReply: gentle.aiReply ?? null,
    followUp: gentle.followUp ?? null,
    directiveRound: gentle.directiveRound ?? completedDirectiveRounds(session),
    suggestSummary: gentle.suggestSummary ?? false,
  };
}

/**
 * Plan the next round: pick the strategy, fill the question text via the LLM
 * provider with fallback, persist the strategy history, and store the new
 * interrogation state on the session.
 */
function makeAssistantMessage(text: string): Message {
  return {
    id: `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    role: 'assistant',
    text,
    timestamp: Date.now(),
  };
}

async function planNextRound(
  session: Session,
  generateQuestion: HandleInterrogateInput['generateQuestion'],
  uncertainStreak: number,
  directiveRound?: number
): Promise<Session> {
  const strategy = pickNextStrategy(session, directiveRound);
  const fb = await withFallback(strategy, session, () => generateQuestion(strategy, session));
  recordStrategy(session, strategy);
  const next: InterrogationState = {
    round: answeredRounds(session) + 1,
    strategy,
    assistantQuestion: fb.question,
    usedFallback: fb.usedFallback,
    pendingCheckpoint: false,
    uncertainStreak,
    directiveRound: directiveRound ?? completedDirectiveRounds(session),
  };
  return {
    ...session,
    messages: [...session.messages, makeAssistantMessage(fb.question)],
    interrogation: next,
    updatedAt: Date.now(),
  };
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
  // success.
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
    // replan or reset the round.
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
      // resets and a fresh question is planned for the SAME round.
      const planned = await planNextRound(session, generateQuestion, 0);
      await storage.saveSession(planned);
      return { ok: true, body: toResponseBody(planned, null, false) };
    }
    // #26/R3: PRD v4.2 §5.3 — the only continuation gate is the three-round
    // summary gate (suggestSummary). When it is open, "继续聊" must always
    // succeed and return the current session unchanged so the client can
    // render the next AI turn. It is never 409.
    return { ok: true, body: toResponseBody(session, null, false) };
  }

  // #26/T3: optimistic reconciliation — if the client sent an optimistic
  // message id, locate the matching `pending` message and confirm it. The
  // optimistic insert uses a `pending` status and a server-generated real id
  // replaces the optimistic id. If no match is found, the server produces
  // a normal message (the client will mark its optimistic insert as failed).
  function reconcileOptimistic(session: Session, optimisticId?: string | null): Session {
    if (!optimisticId) return session;
    const optimisticIndex = session.messages.findIndex(
      (m) => m.id === optimisticId && m.status === 'pending'
    );
    if (optimisticIndex === -1) return session;
    const realMessage: Message = {
      id: `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      role: 'user',
      text: session.messages[optimisticIndex]!.text,
      timestamp: Date.now(),
      status: 'sent',
      uncertain: session.messages[optimisticIndex]!.uncertain,
    };
    return {
      ...session,
      messages: [
        ...session.messages.slice(0, optimisticIndex),
        realMessage,
        ...session.messages.slice(optimisticIndex + 1),
      ],
    };
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

  // #26/T3: first reconcile any pending optimistic message with the real
  // server-generated id, then proceed with the normal answer flow.
  let currentSession = reconcileOptimistic(session, input.optimisticId);

  // Every input is recorded — including uncertain ones (#17: an uncertain
  // input is persisted as an uncertain user message and never discarded).
  const withAnswer: Session = {
    ...currentSession,
    messages: [...currentSession.messages, makeMessage(answer, streak > 0)],
  };

  // #5: classify user intent and generate gentle response
  const userIntent: UserIntent = classifyIntent(answer);
  const currentDirectiveRound = completedDirectiveRounds(currentSession);
  const currentStrategy = state.strategy ?? 'M1_evidence';
  const gentle = generateGentleResponse(answer, currentSession, currentStrategy, true);
  const nextDirectiveRound = gentle.directiveRound;

  // #17: uncertain answers NEVER advance the round. The first two stay in
  // the current round (1: narrowed question, 2: two directions); the third
  // opens an explicit 继续/结束 decision gate — no auto-completion, no lost
  // input.
  if (streak > 0) {
    const hintForGate = uncertainResponse(streak, withAnswer, state.assistantQuestion);
    if (streak >= 3) {
      const gated: Session = {
        ...withAnswer,
        messages: [...withAnswer.messages, makeAssistantMessage(hintForGate.message)],
        interrogation: {
          round: state.round,
          strategy: state.strategy,
          assistantQuestion: state.assistantQuestion,
          usedFallback: state.usedFallback,
          pendingCheckpoint: false,
          uncertainStreak: streak,
          pendingDecision: true,
          directiveRound: nextDirectiveRound,
          lastIntent: userIntent,
        },
        updatedAt: Date.now(),
      };
      await storage.saveSession(gated);
      return {
        ok: true,
        body: toResponseBody(gated, { message: hintForGate.message, hint: hintForGate.hint }, true, {
          directiveRound: nextDirectiveRound,
          suggestSummary: shouldSuggestSummary(nextDirectiveRound),
        }),
      };
    }

    let assistantQuestion = state.assistantQuestion;
    let usedFallback = state.usedFallback;
    const assistantMessages: Message[] = [];
    if (streak === 1) {
      const strategy = state.strategy ?? 'M1_evidence';
      const fb = await withFallback(strategy, withUserMessage, async () =>
        buildNarrowedQuestion(withUserMessage, state.assistantQuestion)
      );
      assistantQuestion = fb.question;
      usedFallback = fb.usedFallback;
      assistantMessages.push(makeAssistantMessage(fb.question));
    }
    const updated: Session = {
      ...withAnswer,
      messages: [...withAnswer.messages, ...assistantMessages],
      interrogation: {
        round: state.round,
        strategy: state.strategy,
        assistantQuestion,
        usedFallback,
        pendingCheckpoint: false,
        uncertainStreak: streak,
        directiveRound: nextDirectiveRound,
        lastIntent: userIntent,
      },
      updatedAt: Date.now(),
    };
    await storage.saveSession(updated);
    const hintResponse = uncertainResponse(streak, withUserMessage, assistantQuestion);
    return {
      ok: true,
      body: toResponseBody(updated, { message: hintResponse.message, hint: hintResponse.hint }, false, {
        directiveRound: nextDirectiveRound,
        suggestSummary: shouldSuggestSummary(nextDirectiveRound),
      }),
    };
  }

  // #5 gentle: non-uncertain path — apply gentle response logic
  const isQuestion = userIntent === 'question';
  const isSubstantiveResponse = userIntent === 'response' && !isNonSubstantive(answer);

  // Build AI reply and follow-up messages for persistence
  const aiMessages: Message[] = [];
  let nextFollowUp: string | null = gentleResponse.followUp;
  let nextAiReply: string | null = gentleResponse.aiReply;
  let nextDirectiveRound = state.directiveRound ?? 0;
  let nextSuggestSummary = false;
  let nextAssistantQuestion: string | null = state.assistantQuestion;

  if (isQuestion) {
    // User asked a question: AI replies directly + gives a follow-up question.
    // Advances interrogation round but NOT directive round. The gentle
    // follow-up replaces the current question.
    nextDirectiveRound = state.directiveRound ?? 0;
    if (gentleResponse.aiReply) {
      aiMessages.push(makeAssistantMessage(gentleResponse.aiReply));
    }
    if (gentleResponse.followUp) {
      nextAssistantQuestion = gentleResponse.followUp;
      nextFollowUp = gentleResponse.followUp;
    }
  } else if (isSubstantiveResponse) {
    // Substantive response: AI acknowledges + asks strategy question.
    // Advances both interrogation and directive rounds.
    nextDirectiveRound = nextDirectiveRound + 1;
    nextSuggestSummary = shouldSuggestSummary(nextDirectiveRound);

    if (gentleResponse.aiReply) {
      aiMessages.push(makeAssistantMessage(gentleResponse.aiReply));
    }
    // Don't set nextAssistantQuestion here — planNextRound will generate it
  } else {
    // Non-substantive response: gentle nudge, advance round but not directive
    nextDirectiveRound = state.directiveRound ?? 0;
    // Keep the existing question; gentle nudge goes to followUp/hint
  }

  // #26/R3: PRD v4.2 §5.3 removed the v4.1 fixed 5/8/11 round checkpoints.
  // The only legitimate gate is the three-round summary gate, surfaced as
  // `suggestSummary` after every 3rd directive round. Substantive answers
  // directly advance the round and may keep going; the user is free to
  // tap 生成总结 at any moment via action='complete'.

  // #5: for questions, the AI replies directly and provides a follow-up;
  // for substantive responses, the AI acknowledges and asks a strategy question.
  const nextStrategy = pickNextStrategy(withAnswer, nextDirectiveRound);
  const fb = await withFallback(nextStrategy, withAnswer, () =>
    generateQuestion(nextStrategy, withAnswer)
  );
  recordStrategy(withAnswer, nextStrategy);

  // #26/R3: PRD v4.2 §4.1 — the AI's direct answer and the gentle follow-up
  // MUST be persisted as a single assistant message. Saving them as two
  // separate messages causes the UI to render the AI reply twice and breaks
  // the round counter semantics.
  const gentleMessages: Message[] = [];
  const directAnswer = gentle.aiReply;
  const nextAssistantQuestion =
    gentle.intent === 'question' ? gentle.followUp : fb.question;
  const combined = [directAnswer, nextAssistantQuestion].filter(Boolean).join('\n\n');
  if (combined) {
    gentleMessages.push(makeAssistantMessage(combined));
  }

  const planned = {
    ...withAnswer,
    messages: [...withAnswer.messages, ...gentleMessages],
    interrogation: {
      round: state.round + 1,
      strategy: nextStrategy,
      assistantQuestion: nextAssistantQuestion,
      usedFallback: fb.usedFallback,
      pendingCheckpoint: false,
      uncertainStreak: streak,
      directiveRound: nextDirectiveRound,
      lastIntent: userIntent,
    },
    updatedAt: Date.now(),
  };
  await storage.saveSession(planned);
  return { ok: true, body: toResponseBody(planned, hint, false, {
    directiveRound: nextDirectiveRound,
    suggestSummary: gentle.suggestSummary,
    aiReply: gentle.aiReply,
    followUp: gentle.followUp,
  }) };
}
