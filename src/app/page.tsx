'use client';

import { useEffect, useRef, useState } from 'react';
import type {
  CitedSource,
  Session,
  Report,
  Viewpoint,
  Message,
  ResultCard,
  SourceState,
  InterrogateAction,
  InterrogateResponseBody,
} from '@/lib/providers';
import type { StrategyId } from '@/lib/strategy-engine';
import { selectRoundSources } from '@/lib/interrogation-context';
import { FixtureRetrievalProvider } from '@/lib/fixture-providers';
import { BrowserStorageProvider } from '@/lib/demo-providers';
import { ownerHeaders } from '@/lib/owner-id';
import { pickRecoverySession, storageNoticeFor } from '@/lib/session-recovery';
import HomePage from './components/HomePage';
import ReportPanel from './components/ReportPanel';
import StanceSelector from './components/StanceSelector';
import QAPanel from './components/QAPanel';
import ResultCardView, { ResultCardViewFromSession } from './components/ResultCardView';

const retrievalProvider = new FixtureRetrievalProvider();
const storageProvider = new BrowserStorageProvider();

type Page = 'home' | 'session';

/**
 * Retrieval state of the current session's report (#18 honest disclosure).
 * #19 adds per-channel cache timestamps/stale flags so the UI can show when
 * cached data was actually retrieved instead of implying it is current.
 */
interface ReportSourceState {
  zhihu: SourceState;
  web: SourceState;
  zhihuUpdatedAt?: number;
  webUpdatedAt?: number;
  zhihuStale?: boolean;
  webStale?: boolean;
}

/** Side-key persisting the report's retrieval state across reloads (#18). */
const reportStateKey = (sessionId: string): string => `zhiyan_report_state:${sessionId}`;

function loadReportSourceState(sessionId: string): ReportSourceState | null {
  try {
    const raw = localStorage.getItem(reportStateKey(sessionId));
    return raw ? (JSON.parse(raw) as ReportSourceState) : null;
  } catch {
    return null;
  }
}

function saveReportSourceState(sessionId: string, state: ReportSourceState): void {
  try {
    localStorage.setItem(reportStateKey(sessionId), JSON.stringify(state));
  } catch { /* quota exceeded — silent */ }
}

/**
 * Setters the module-level interrogation helpers push state through. Built
 * from stable React setters so they can be used inside mount effects without
 * adding component-scope dependencies (react-hooks/exhaustive-deps).
 */
interface InterrogateViewHooks {
  setSession: (s: Session | null) => void;
  setMessages: (m: Message[]) => void;
  setSelectedViewpoint: (v: Viewpoint | null) => void;
  setUncertainStreak: (n: number) => void;
  setHintMessage: (m: string | null) => void;
  setHintOptions: (o: string[] | null) => void;
  setCurrentQuestion: (q: string | null) => void;
  setCurrentStrategy: (s: StrategyId | null) => void;
  setCurrentRound: (r: number) => void;
  setUsedFallback: (u: boolean) => void;
  setCurrentSources: (s: CitedSource[] | null) => void;
  setIsCheckpoint: (v: boolean) => void;
  /** #17: the explicit 继续/结束 decision gate after the third uncertain answer. */
  setPendingDecision: (v: boolean) => void;
  /** #17: visible error when the completion API fails (with a retry entry). */
  setCompleteError: (e: string | null) => void;
  setCompleted: (v: boolean) => void;
  setResultCard: (c: ResultCard | null) => void;
  /** #21: honest server-storage status line (null = persisted remotely). */
  setStorageNotice: (n: string | null) => void;
}

/**
 * Result of calling the interrogation API. `storageUnavailable` is true only
 * on the explicit server degradation signal (503 + storage:'unavailable'):
 * nothing was persisted remotely and the client must rely on its local
 * mirror — it must never assume the write was saved remotely.
 */
type InterrogateCallResult =
  | { ok: true; data: InterrogateResponseBody }
  | { ok: false; storageUnavailable: boolean };

/**
 * Fetch one of this browser owner's stored sessions from the server (#21).
 * Returns null on any failure (missing/404/degraded database) — recovery
 * then falls back to the local mirror (see pickRecoverySession).
 */
async function fetchServerSession(sessionId: string): Promise<Session | null> {
  try {
    const res = await fetch(`/api/session?id=${encodeURIComponent(sessionId)}`, {
      headers: ownerHeaders(),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { session?: Session | null };
    return body.session ?? null;
  } catch {
    return null;
  }
}

/** The owner-scoped server profile, or null when unavailable (#21). */
async function fetchServerProfile(): Promise<import('@/lib/lifecycle').UserProfile | null> {
  try {
    const res = await fetch('/api/profile', { headers: ownerHeaders() });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      profile?: import('@/lib/lifecycle').UserProfile | null;
    };
    return body.profile ?? null;
  } catch {
    return null;
  }
}

/** Push the profile to the owner-scoped server storage (best effort, #21). */
async function pushProfileToServer(profile: import('@/lib/lifecycle').UserProfile): Promise<void> {
  try {
    await fetch('/api/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...ownerHeaders() },
      body: JSON.stringify({ profile }),
    });
  } catch {
    // Server unavailable — the profile stays local-only (honest degradation).
  }
}

/**
 * Call the single interrogation orchestration API (#15). All strategy
 * decisions (round order, checkpoint gating, fallback, uncertain streak)
 * happen server-side; the client sends its persisted session snapshot so the
 * API can rehydrate its store after a restart, plus the anonymous owner
 * header (#21) so storage is scoped to this browser's identity.
 */
async function postInterrogate(
  sess: Session,
  payload: { action: InterrogateAction; answer?: string; viewpoint?: Viewpoint }
): Promise<InterrogateCallResult> {
  try {
    const res = await fetch('/api/interrogate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...ownerHeaders() },
      body: JSON.stringify({ sessionId: sess.id, session: sess, ...payload }),
    });
    if (res.status === 503) {
      // Explicit server-storage degradation signal (#21).
      return { ok: false, storageUnavailable: true };
    }
    if (!res.ok) {
      console.error('Interrogate API error:', res.status);
      return { ok: false, storageUnavailable: false };
    }
    return { ok: true, data: (await res.json()) as InterrogateResponseBody };
  } catch (err) {
    console.error('Interrogate API failed:', err);
    return { ok: false, storageUnavailable: false };
  }
}

/**
 * Complete a session through the explicit complete action of the orchestration
 * API (#17). The server builds the result card from the saved conversation,
 * marks the session completed and persists the card; the client only mirrors
 * the returned session. On failure nothing is persisted and a visible error
 * with a retry entry is shown — the saved session is never corrupted.
 * Returns true when the card is ready.
 */
async function completeSession(sess: Session, hooks: InterrogateViewHooks): Promise<boolean> {
  const res = await postInterrogate(sess, { action: 'complete' });
  if (!res.ok) {
    if (res.storageUnavailable) {
      hooks.setStorageNotice(storageNoticeFor('unavailable'));
    }
    hooks.setCompleteError('生成成果卡失败，请重试。');
    return false;
  }
  if (!res.data.session.resultCard) {
    hooks.setCompleteError('生成成果卡失败，请重试。');
    return false;
  }
  const data = res.data;
  hooks.setCompleteError(null);
  hooks.setSession(data.session);
  hooks.setMessages(data.session.messages);
  hooks.setCompleted(true);
  hooks.setResultCard(data.session.resultCard);
  hooks.setCurrentQuestion(null);
  hooks.setIsCheckpoint(false);
  hooks.setPendingDecision(false);
  hooks.setHintMessage(null);
  hooks.setHintOptions(null);
  hooks.setStorageNotice(storageNoticeFor(data.storage));
  await storageProvider.saveSession(data.session);

  // Update profile (ticket #12) — stays client-side (#17). #21: when no
  // local profile exists it is recovered from this owner's server storage
  // first (tombstone semantics preserved), and the merged profile is pushed
  // back best-effort so it survives browser storage loss.
  const { buildProfileFromSession, updateProfile, loadProfile, saveProfile } = await import('@/lib/lifecycle');
  const conclusions = buildProfileFromSession(data.session);
  if (conclusions.length > 0) {
    let current = loadProfile();
    if (!current) current = await fetchServerProfile();
    const next = updateProfile(current, conclusions);
    saveProfile(next);
    void pushProfileToServer(next);
  }
  return true;
}

/**
 * Apply an orchestration API response to the page state and mirror the
 * returned session into local storage (#15: the persisted mirror is the
 * refresh/reload recovery source; no orchestration runs in the browser).
 */
async function applyInterrogateResponse(
  data: InterrogateResponseBody,
  hooks: InterrogateViewHooks
): Promise<void> {
  hooks.setSession(data.session);
  hooks.setMessages(data.session.messages);
  if (data.session.selectedViewpoint) hooks.setSelectedViewpoint(data.session.selectedViewpoint);
  hooks.setUncertainStreak(data.uncertainStreak);
  hooks.setCompleteError(null);
  // #21: honest server-storage disclosure from the API response.
  hooks.setStorageNotice(storageNoticeFor(data.storage));
  await storageProvider.saveSession(data.session);

  if (data.decisionPending) {
    // #17: after the third uncertain answer the user must explicitly choose
    // 继续 or 结束 — the session is never completed automatically and the
    // third input is never discarded.
    hooks.setPendingDecision(true);
    hooks.setIsCheckpoint(false);
    hooks.setHintMessage(data.hint?.message ?? null);
    hooks.setHintOptions(data.hint?.hint ?? null);
    hooks.setCurrentQuestion(data.question);
    hooks.setCurrentStrategy(data.strategy);
    hooks.setCurrentRound(data.round);
    hooks.setUsedFallback(data.usedFallback);
    hooks.setCurrentSources(data.sources ?? []);
    return;
  }

  if (data.hint) {
    hooks.setHintMessage(data.hint.message);
    hooks.setHintOptions(data.hint.hint ?? null);
  } else {
    hooks.setHintMessage(null);
    hooks.setHintOptions(null);
  }
  hooks.setPendingDecision(false);
  hooks.setCurrentQuestion(data.question);
  hooks.setCurrentStrategy(data.strategy);
  hooks.setCurrentRound(data.round);
  hooks.setUsedFallback(data.usedFallback);
  hooks.setCurrentSources(data.sources ?? []);
  hooks.setIsCheckpoint(data.checkpoint);
}

export default function Home() {
  const [page, setPage] = useState<Page>('home');
  const [session, setSession] = useState<Session | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedViewpoint, setSelectedViewpoint] = useState<Viewpoint | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState<string | null>(null);
  const [currentStrategy, setCurrentStrategy] = useState<StrategyId | null>(null);
  const [isCheckpoint, setIsCheckpoint] = useState(false);
  const [pendingDecision, setPendingDecision] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [currentRound, setCurrentRound] = useState(0);
  const [usedFallback, setUsedFallback] = useState(false);
  const [currentSources, setCurrentSources] = useState<CitedSource[] | null>(null);
  const [uncertainStreak, setUncertainStreak] = useState(0);
  const [hintMessage, setHintMessage] = useState<string | null>(null);
  const [hintOptions, setHintOptions] = useState<string[] | null>(null);
  const [completed, setCompleted] = useState(false);
  const [resultCard, setResultCard] = useState<ResultCard | null>(null);
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(false);
  // #21: honest server-storage status line for the session view.
  const [storageNotice, setStorageNotice] = useState<string | null>(null);
  const [hotlist, setHotlist] = useState<{ items: { id: string; title: string; url: string | null }[]; source: 'live' | 'cache' | 'demo'; updatedAt: number; stale?: boolean } | null>(null);
  const [hotlistLoading, setHotlistLoading] = useState(true);
  // #18: honest live/cache/demo disclosure for the report panel.
  const [reportSourceState, setReportSourceState] = useState<ReportSourceState | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const handleCompleteNow = async (sess?: Session) => {
    const target = sess ?? session;
    if (!target) return;
    await completeSession(target, {
      setSession,
      setMessages,
      setSelectedViewpoint,
      setUncertainStreak,
      setHintMessage,
      setHintOptions,
      setCurrentQuestion,
      setCurrentStrategy,
      setCurrentRound,
      setUsedFallback,
      setCurrentSources,
      setIsCheckpoint,
      setPendingDecision,
      setCompleteError,
      setCompleted,
      setResultCard,
      setStorageNotice,
    });
  };

  const runInterrogate = async (
    sess: Session,
    payload: { action: InterrogateAction; answer?: string; viewpoint?: Viewpoint }
  ) => {
    const res = await postInterrogate(sess, payload);
    if (res.ok) {
      await applyInterrogateResponse(res.data, {
        setSession,
        setMessages,
        setSelectedViewpoint,
        setUncertainStreak,
        setHintMessage,
        setHintOptions,
        setCurrentQuestion,
        setCurrentStrategy,
        setCurrentRound,
        setUsedFallback,
        setCurrentSources,
        setIsCheckpoint,
        setPendingDecision,
        setCompleteError,
        setCompleted,
        setResultCard,
        setStorageNotice,
      });
    } else if (res.storageUnavailable) {
      // #21: explicit degradation — keep the local mirror, disclose honestly.
      setStorageNotice(storageNoticeFor('unavailable'));
    }
  };

  // Restore session from URL on reload (#15: the persisted interrogation
  // state decides between "checkpoint pending" and "round N question pending").
  // #21 recovery priority: server reachable → the server copy is the durable
  // candidate; otherwise the local mirror. When both exist the newer
  // updatedAt wins and a completed session is never downgraded
  // (pickRecoverySession). A degraded server simply falls back to local.
  useEffect(() => {
    const restore = async () => {
      const params = new URLSearchParams(window.location.search);
      const sessionId = params.get('session');
      if (sessionId) {
        const local = await storageProvider.loadSession(sessionId);
        const remote = await fetchServerSession(sessionId);
        const data = pickRecoverySession(local, remote);
        if (data) {
          if (!local) {
            // Restored from the server with no local copy — re-mirror it so
            // the browser has a snapshot for later offline rehydration.
            await storageProvider.saveSession(data);
          }
          setSession(data);
          if (data.report) setReport(data.report);
          // #18: restore the report's retrieval state for the honest badge.
          setReportSourceState(loadReportSourceState(sessionId));
          setMessages(data.messages);
          if (data.selectedViewpoint) setSelectedViewpoint(data.selectedViewpoint);
          if (data.resultCard) {
            setResultCard(data.resultCard);
            setCompleted(true);
          } else if (data.selectedViewpoint) {
            const st = data.interrogation;
            if (st?.pendingCheckpoint) {
              // Refreshed while a checkpoint decision was pending: restore the
              // gate exactly (#14 P2 fixed by persisting the decision state).
              setCurrentRound(st.round);
              setCurrentStrategy(st.strategy);
              setCurrentQuestion(null);
              setUsedFallback(st.usedFallback);
              // #16: restore the question's evidence sources from the session.
              setCurrentSources(selectRoundSources(data));
              setUncertainStreak(st.uncertainStreak);
              setIsCheckpoint(true);
            } else if (st?.pendingDecision) {
              // Refreshed while the 继续/结束 decision gate was pending (#17).
              setCurrentRound(st.round);
              setCurrentStrategy(st.strategy);
              setCurrentQuestion(st.assistantQuestion);
              setUsedFallback(st.usedFallback);
              setCurrentSources(selectRoundSources(data));
              setUncertainStreak(st.uncertainStreak);
              setIsCheckpoint(false);
              setPendingDecision(true);
            } else if (st?.assistantQuestion) {
              // Refreshed while round N's question was pending.
              setCurrentRound(st.round);
              setCurrentStrategy(st.strategy);
              setCurrentQuestion(st.assistantQuestion);
              setUsedFallback(st.usedFallback);
              // #16: restore the question's evidence sources from the session.
              setCurrentSources(selectRoundSources(data));
              setUncertainStreak(st.uncertainStreak);
              setIsCheckpoint(false);
            } else {
              // Session predates the persisted interrogation state: ask the
              // API to resume — it decides checkpoint vs. next round.
              const hooks: InterrogateViewHooks = {
                setSession,
                setMessages,
                setSelectedViewpoint,
                setUncertainStreak,
                setHintMessage,
                setHintOptions,
                setCurrentQuestion,
                setCurrentStrategy,
                setCurrentRound,
                setUsedFallback,
                setCurrentSources,
                setIsCheckpoint,
                setPendingDecision,
                setCompleteError,
                setCompleted,
                setResultCard,
                setStorageNotice,
              };
              const resp = await postInterrogate(data, {
                action: 'start',
                viewpoint: data.selectedViewpoint,
              });
              if (resp.ok) await applyInterrogateResponse(resp.data, hooks);
            }
          }
          setPage('session');
        }
      }
    };
    void restore();
  }, []);

  // Fetch hotlist on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/hotlist');
        if (!cancelled && res.ok) {
          const data = await res.json();
          setHotlist(data);
        }
      } catch {
        // silently ignore — hotlist is optional
      } finally {
        if (!cancelled) setHotlistLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleStart = async (question: string, initialOpinion: string | null) => {
    setLoading(true);
    try {
      // Call the server API which runs parallel search providers + report builder
      const res = await fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...ownerHeaders() },
        body: JSON.stringify({ question, initialOpinion }),
      });

      if (!res.ok) {
        throw new Error(`API error: ${res.status}`);
      }

      const { sessionId, report, knowledgeGraph, sourceState, saved, storage } = (await res.json()) as {
        sessionId: string;
        report: Report;
        progress: { stage: string; message: string; timestamp: number }[];
        knowledgeGraph?: import('@/lib/knowledge-graph').KnowledgeGraph | null;
        sourceState?: ReportSourceState;
        saved?: boolean;
        storage?: 'memory' | 'postgres' | 'unavailable';
      };

      // #21: honest storage disclosure. saved === false (or an explicit
      // 'unavailable' mode) means the session was NOT persisted remotely —
      // the client keeps its localStorage mirror and says so.
      setStorageNotice(
        saved === false ? storageNoticeFor('unavailable') : storageNoticeFor(storage)
      );

      // #18: keep the report's retrieval state for the panel's honest badge,
      // including across reloads (side-key next to the mirrored session).
      if (sourceState) {
        setReportSourceState(sourceState);
        saveReportSourceState(sessionId, sourceState);
      } else {
        setReportSourceState(null);
      }

      const newSession: Session = {
        id: sessionId,
        question,
        initialOpinion,
        report,
        knowledgeGraph: knowledgeGraph ?? null,
        selectedViewpoint: null,
        messages: [],
        resultCard: null,
        completed: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await storageProvider.saveSession(newSession);
      setSession(newSession);
      setReport(report);
      setPage('session');
      window.history.pushState({}, '', `?session=${sessionId}`);
    } catch (err) {
      console.error('Failed to generate report:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleViewpointSelect = async (viewpoint: Viewpoint) => {
    if (!session) return;
    setSelectedViewpoint(viewpoint);
    await runInterrogate(session, { action: 'start', viewpoint });
  };

  const handleCustomViewpoint = async (text: string) => {
    if (!session) return;
    const customViewpoint: Viewpoint = { id: 'custom', text, source: 'user_authored' };
    setSelectedViewpoint(customViewpoint);
    await runInterrogate(session, { action: 'start', viewpoint: customViewpoint });
  };

  const handleSendAnswer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || !answer.trim()) return;
    if (isCheckpoint) return; // checkpoint decision pending — answer form is hidden
    if (pendingDecision) return; // #17: complete/continue decision pending

    const userAnswer = answer.trim();
    setAnswer('');

    // Ticket #15: the API records the answer, updates the uncertain streak,
    // gates the checkpoint, and plans/persists the next round.
    await runInterrogate(session, { action: 'answer', answer: userAnswer });
  };

  // Ticket #14/#17: continue from the checkpoint decision (or the #17
  // decision gate) into the next round; the server decides streak handling.
  const handleCheckpointContinue = async () => {
    if (!session) return;
    setHintMessage(null);
    setHintOptions(null);
    await runInterrogate(session, { action: 'continue' });
  };

  const handleNewSession = () => {
    setSession(null);
    setReport(null);
    setMessages([]);
    setSelectedViewpoint(null);
    setCurrentQuestion(null);
    setCurrentStrategy(null);
    setCurrentRound(0);
    setIsCheckpoint(false);
    setPendingDecision(false);
    setCompleteError(null);
    setUncertainStreak(0);
    setHintMessage(null);
    setHintOptions(null);
    setCompleted(false);
    setResultCard(null);
    setCurrentSources(null);
    setReportSourceState(null);
    setStorageNotice(null);
    setAnswer('');
    setPage('home');
    window.history.pushState({}, '', '/');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-2xl mb-4">知研</div>
          <p className="text-gray-600">加载中...</p>
        </div>
      </div>
    );
  }

  if (page === 'home') {
    return <HomePage onStart={handleStart} hotlist={hotlist} hotlistLoading={hotlistLoading} />;
  }

  // #19: honest cache disclosure — show when the cached channel data was
  // actually retrieved. The oldest cached channel wins, so the badge never
  // claims fresher data than what is displayed.
  const cacheTimes: number[] = [];
  if (reportSourceState?.zhihu === 'cache' && typeof reportSourceState.zhihuUpdatedAt === 'number') {
    cacheTimes.push(reportSourceState.zhihuUpdatedAt);
  }
  if (reportSourceState?.web === 'cache' && typeof reportSourceState.webUpdatedAt === 'number') {
    cacheTimes.push(reportSourceState.webUpdatedAt);
  }
  const cacheUpdatedAt = cacheTimes.length > 0 ? Math.min(...cacheTimes) : null;
  const cacheStale = reportSourceState?.zhihuStale === true || reportSourceState?.webStale === true;

  return (
    <div className="min-h-screen">
      <header className="border-b bg-white">
        <div className="px-4 py-3 flex justify-between items-center">
          <h1 className="text-xl font-bold text-blue-600">知研</h1>
          <div className="flex flex-col items-end min-w-0">
            <span className="text-sm text-gray-600 truncate max-w-xs">
              {session?.question}
            </span>
            {storageNotice && (
              <p data-testid="storage-notice" className="text-xs text-amber-600 truncate max-w-md">
                {storageNotice}
              </p>
            )}
          </div>
        </div>
      </header>

      <div className="flex h-[calc(100vh-57px)]">
        <ReportPanel
          report={report!}
          zhihuSourceState={reportSourceState?.zhihu}
          webSourceState={reportSourceState?.web}
          cacheUpdatedAt={cacheUpdatedAt}
          cacheStale={cacheStale}
          knowledgeGraph={session?.knowledgeGraph ?? null}
        />

        <div className="flex flex-col flex-1 min-w-0">
          {!selectedViewpoint && !completed && (
            <StanceSelector
              viewpoints={report?.viewpoints ?? []}
              structuredViewpoints={report?.structuredViewpoints}
              onSelect={handleViewpointSelect}
              onCustom={handleCustomViewpoint}
            />
          )}

          {selectedViewpoint && !completed && (
            <QAPanel
              messages={messages}
              currentQuestion={currentQuestion}
              currentStrategy={currentStrategy}
              currentRound={currentRound}
              isCheckpoint={isCheckpoint}
              pendingDecision={pendingDecision}
              usedFallback={usedFallback}
              hintMessage={hintMessage}
              hintOptions={hintOptions}
              sources={currentSources}
              completeError={completeError}
              answer={answer}
              onAnswerChange={setAnswer}
              onSubmit={handleSendAnswer}
              onContinue={handleCheckpointContinue}
              onDecisionContinue={handleCheckpointContinue}
              onRetryComplete={() => { void handleCompleteNow(); }}
              onExit={() => { void handleCompleteNow(); }}
              messagesEndRef={messagesEndRef}
            />
          )}

          {completed && session && (
            <ResultCardViewFromSession session={session} onNewSession={handleNewSession} />
          )}
        </div>
      </div>
    </div>
  );
}
