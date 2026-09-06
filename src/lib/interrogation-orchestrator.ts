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
import {
  type QuickTargetId,
  type SessionMode,
  type SessionPhase,
  type TransitionActionId,
  TRANSITION_ACTIONS,
  getModeConfig,
} from './mode-config';
import { extractCognitiveTrajectory } from './cognitive-trajectory';
import { type CharacterId, formatCharacterQuestion, buildCharacterOpeningMessage } from './character';
import {
  type StoryWorldId,
  generateStoryRun,
  makeStoryChoice,
  completeStory,
  endStoryEarly,
  bridgeStoryToInterrogation,
} from './story-run';

export interface HandleInterrogateInput {
  sessionId: string;
  action: InterrogateAction;
  answer?: string;
  viewpoint?: Viewpoint;
  /**
   * #Q-01 / #D-03: Session mode ('quick' | 'deep' | 'fun' | 'story').
   */
  mode?: SessionMode;
  /**
   * #Q-02: User selected quick target.
   */
  target?: QuickTargetId;
  /**
   * #Q-02: Selected transition action card.
   */
  transitionChoice?: TransitionActionId;
  /** #F-01: Character for fun mode. */
  character?: CharacterId;
  /** #G-01: World for story mode. */
  world?: StoryWorldId;
  /** #G-03: Story choice ID. */
  choiceId?: string;
  /** #G-03: Selected option ID. */
  optionId?: string;
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
  suggestComplete: boolean,
  gentle: { aiReply?: string | null; followUp?: string | null; directiveRound?: number; suggestSummary?: boolean } = {}
): InterrogateResponseBody {
  const state = interrogationStateOf(session);
  const trajectory = session.cognitiveTrajectory ?? extractCognitiveTrajectory(session);
  const phase = session.phase ?? state.phase ?? 'interrogation';
  const mode = session.mode ?? state.mode ?? 'quick';
  const target = session.target ?? state.target ?? null;

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
    session: {
      ...session,
      mode,
      phase,
      target,
      cognitiveTrajectory: trajectory,
    },
    // #5: gentle interrogation fields
    aiReply: gentle.aiReply ?? null,
    followUp: gentle.followUp ?? null,
    directiveRound: gentle.directiveRound ?? completedDirectiveRounds(session),
    suggestSummary: gentle.suggestSummary ?? false,
    // #Q-01 / #Q-02 / #D-03
    mode,
    phase,
    target,
    orientationRounds: session.orientationRounds ?? 0,
    transitionActions: phase === 'transitionChoice' ? TRANSITION_ACTIONS : undefined,
    cognitiveTrajectory: trajectory,
    character: session.character ?? null,
    storyRun: session.storyRun ?? null,
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
  uncertainStreak: number
): Promise<Session> {
  const isFirstRound = answeredRounds(session) === 0;
  const strategy = pickNextStrategy(session);
  let questionText: string;
  let usedFallback = false;

  // Round 1 in Fun mode uses character opening greeting + orientation question
  if (isFirstRound && session.mode === 'fun' && session.character && session.selectedViewpoint) {
    questionText = buildCharacterOpeningMessage(
      session.character,
      session.selectedViewpoint.text,
      session.target
    );
    recordStrategy(session, strategy);
  } else {
    const fb = await withFallback(strategy, session, () => generateQuestion(strategy, session));
    recordStrategy(session, strategy);
    questionText = fb.question;
    usedFallback = fb.usedFallback;

    if (session.mode === 'fun' && session.character) {
      questionText = formatCharacterQuestion(session.character, questionText);
    }
  }

  const next: InterrogationState = {
    round: answeredRounds(session) + 1,
    strategy,
    assistantQuestion: questionText,
    usedFallback,
    pendingCheckpoint: false,
    uncertainStreak,
  };
  return {
    ...session,
    messages: [...session.messages, makeAssistantMessage(questionText)],
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
    const mode = input.mode ?? session.mode ?? 'quick';
    const target = input.target ?? session.target ?? (mode === 'quick' ? 'clarify_position' : null);
    const character = mode === 'fun' ? (session.character ?? input.character ?? 'relaxed_friend') : (session.character ?? null);
    const selected: Viewpoint = { ...viewpoint, selectedAt: Date.now() };
    const phase: SessionPhase = mode === 'quick' ? 'orientation' : (session.phase ?? 'interrogation');
    const prepared: Session = {
      ...session,
      selectedViewpoint: selected,
      mode,
      target,
      character,
      phase,
      orientationRounds: 0,
    };
    if (mode === 'story' && !prepared.storyRun) {
      const world = input.world ?? 'future_city';
      prepared.storyRun = generateStoryRun(
        session.id,
        session.report ?? {
          question: session.question,
          title: session.question,
          knowledgePoints: [],
          content: '',
          viewpoints: [],
          references: [],
          citations: {},
        },
        prepared.selectedViewpoint,
        world
      );
    }
    prepared.cognitiveTrajectory = extractCognitiveTrajectory(prepared);
    if (mode === 'story') {
      await storage.saveSession(prepared);
      return { ok: true, body: toResponseBody(prepared, null, false) };
    }
    const planned = await planNextRound(prepared, generateQuestion, state.uncertainStreak);
    await storage.saveSession(planned);
    return { ok: true, body: toResponseBody(planned, null, false) };
  }

  if (action === 'story_choice') {
    if (!session.storyRun || !input.choiceId || !input.optionId) {
      return { ok: false, status: 400, error: 'Missing storyRun, choiceId, or optionId' };
    }
    const updatedStory = makeStoryChoice(session.storyRun, input.choiceId, input.optionId);
    const updated: Session = {
      ...session,
      storyRun: updatedStory,
      updatedAt: Date.now(),
    };
    await storage.saveSession(updated);
    return { ok: true, body: toResponseBody(updated, null, false) };
  }

  if (action === 'story_complete') {
    if (!session.storyRun) {
      return { ok: false, status: 400, error: 'No active storyRun' };
    }
    const updatedStory = completeStory(session.storyRun);
    const card = buildSimpleResultCard(session);
    const updated: Session = {
      ...session,
      completed: true,
      resultCard: card,
      storyRun: updatedStory,
      updatedAt: Date.now(),
    };
    await storage.saveSession(updated);
    return { ok: true, body: toResponseBody(updated, null, false) };
  }

  if (action === 'story_end_early') {
    if (!session.storyRun) {
      return { ok: false, status: 400, error: 'No active storyRun' };
    }
    const updatedStory = endStoryEarly(session.storyRun);
    const updated: Session = {
      ...session,
      storyRun: updatedStory,
      updatedAt: Date.now(),
    };
    await storage.saveSession(updated);
    return { ok: true, body: toResponseBody(updated, null, false) };
  }

  if (action === 'story_bridge') {
    const bridged = bridgeStoryToInterrogation(session);
    bridged.cognitiveTrajectory = extractCognitiveTrajectory(bridged);
    const planned = await planNextRound(bridged, generateQuestion, 0);
    await storage.saveSession(planned);
    return { ok: true, body: toResponseBody(planned, null, false) };
  }

  if (action === 'set_target') {
    const target = input.target ?? null;
    const updated: Session = {
      ...session,
      target,
      updatedAt: Date.now(),
    };
    await storage.saveSession(updated);
    return { ok: true, body: toResponseBody(updated, null, false) };
  }

  if (action === 'transition') {
    const choice = input.transitionChoice;
    let target = session.target;
    let phase: SessionPhase = 'interrogation';
    let mode: SessionMode = session.mode ?? 'quick';

    if (choice === 'continue_orientation') {
      phase = 'orientation';
      const orientationRounds = (session.orientationRounds ?? 0) + 1;
      const updated: Session = {
        ...session,
        phase,
        orientationRounds,
        transitionChoice: choice,
        updatedAt: Date.now(),
      };
      await storage.saveSession(updated);
      return { ok: true, body: toResponseBody(updated, null, false) };
    } else if (choice === 'start_challenge') {
      mode = 'deep';
      phase = 'interrogation';
    } else if (choice === 'inspect_evidence') {
      target = 'clarify_position';
    } else if (choice === 'inspect_counterargument') {
      target = 'weigh_decision';
    }

    const updated: Session = {
      ...session,
      phase,
      mode,
      target,
      transitionChoice: choice ?? null,
      updatedAt: Date.now(),
    };

    // If no round was planned yet, plan round 1 now
    if (state.round === 0 || !state.assistantQuestion) {
      const planned = await planNextRound(updated, generateQuestion, state.uncertainStreak);
      await storage.saveSession(planned);
      return { ok: true, body: toResponseBody(planned, null, false) };
    }

    await storage.saveSession(updated);
    return { ok: true, body: toResponseBody(updated, null, false) };
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
  withAnswer.cognitiveTrajectory = extractCognitiveTrajectory(withAnswer);

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
      // #17: the narrowed question is a rewrite of the current question,
      // generated through the context seam and the withFallback degradation
      // chain (usedFallback marks an honest template degradation).
      const strategy = state.strategy ?? 'M1_evidence';
      const fb = await withFallback(strategy, withAnswer, async () =>
        buildNarrowedQuestion(withAnswer, state.assistantQuestion)
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
    const hintResponse = uncertainResponse(streak, withAnswer, assistantQuestion);
    return {
      ok: true,
      body: toResponseBody(updated, { message: hintResponse.message, hint: hintResponse.hint }, false, {
        directiveRound: nextDirectiveRound,
        suggestSummary: shouldSuggestSummary(nextDirectiveRound),
      }),
    };
  }

  const hint: InterrogateHint | null = null;

  // #Q-01 / #Q-02: In quick mode, completing the orientation questions (or target=understand_report)
  // transitions to the transitionChoice phase so the user can review and select next steps.
  if (withAnswer.mode === 'quick') {
    const orientationRounds = (currentSession.orientationRounds ?? 0) + 1;
    if (withAnswer.target === 'understand_report' || orientationRounds >= 3) {
      const transitioned: Session = {
        ...withAnswer,
        phase: 'transitionChoice',
        orientationRounds,
        messages: [
          ...withAnswer.messages,
          makeAssistantMessage('已为您梳理完本篇研报的关键脉络与核心争议。接下来，您想如何继续？'),
        ],
        interrogation: {
          round: state.round + 1,
          strategy: null,
          assistantQuestion: null,
          usedFallback: false,
          pendingCheckpoint: false,
          uncertainStreak: 0,
        },
        updatedAt: Date.now(),
      };
      await storage.saveSession(transitioned);
      return {
        ok: true,
        body: toResponseBody(transitioned, null, false, {
          directiveRound: nextDirectiveRound,
        }),
      };
    }
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
  let nextAssistantQuestion =
    gentle.intent === 'question' ? gentle.followUp : fb.question;
  if (withAnswer.mode === 'fun' && withAnswer.character && nextAssistantQuestion) {
    nextAssistantQuestion = formatCharacterQuestion(withAnswer.character, nextAssistantQuestion);
  }
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
