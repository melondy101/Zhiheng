'use client';

import { useEffect, useRef, useState } from 'react';
import type {
  CitedSource,
  Session,
  Report,
  Viewpoint,
  Message,
  ResultCard,
  InterrogateAction,
  InterrogateResponseBody,
} from '@/lib/providers';
import type { StrategyId } from '@/lib/strategy-engine';
import { selectRoundSources } from '@/lib/interrogation-context';
import { FixtureRetrievalProvider } from '@/lib/fixture-providers';
import { BrowserStorageProvider, StaticReportRenderer, buildResultCard } from '@/lib/demo-providers';
import HomePage from './components/HomePage';
import ReportPanel from './components/ReportPanel';
import StanceSelector from './components/StanceSelector';
import QAPanel from './components/QAPanel';
import ResultCardView, { ResultCardViewFromSession } from './components/ResultCardView';

const retrievalProvider = new FixtureRetrievalProvider();
const storageProvider = new BrowserStorageProvider();
const renderingProvider = new StaticReportRenderer();

type Page = 'home' | 'session';

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
  setCompleted: (v: boolean) => void;
  setResultCard: (c: ResultCard | null) => void;
}

/**
 * Call the single interrogation orchestration API (#15). All strategy
 * decisions (round order, checkpoint gating, fallback, uncertain streak)
 * happen server-side; the client sends its persisted session snapshot so the
 * API can rehydrate its in-memory store after a restart.
 */
async function postInterrogate(
  sess: Session,
  payload: { action: InterrogateAction; answer?: string; viewpoint?: Viewpoint }
): Promise<InterrogateResponseBody | null> {
  try {
    const res = await fetch('/api/interrogate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: sess.id, session: sess, ...payload }),
    });
    if (!res.ok) {
      console.error('Interrogate API error:', res.status);
      return null;
    }
    return (await res.json()) as InterrogateResponseBody;
  } catch (err) {
    console.error('Interrogate API failed:', err);
    return null;
  }
}

/**
 * Complete a session: build the result card from the recorded user messages,
 * persist the completed session, and update the profile (#12).
 */
async function completeSession(sess: Session, hooks: InterrogateViewHooks): Promise<void> {
  const card: ResultCard = await renderingProvider.renderResultCard(buildResultCard(sess));
  const completedSession: Session = {
    ...sess,
    completed: true,
    resultCard: card,
    updatedAt: Date.now(),
  };
  await storageProvider.saveSession(completedSession);
  hooks.setResultCard(card);
  hooks.setCompleted(true);
  hooks.setCurrentQuestion(null);
  hooks.setSession(completedSession);

  // Update profile (ticket #12)
  const { buildProfileFromSession, updateProfile, loadProfile, saveProfile } = await import('@/lib/lifecycle');
  const conclusions = buildProfileFromSession(completedSession);
  if (conclusions.length > 0) {
    const next = updateProfile(loadProfile(), conclusions);
    saveProfile(next);
  }
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
  await storageProvider.saveSession(data.session);

  if (data.suggestComplete) {
    // Three consecutive uncertain answers (#10 behavior preserved): hint,
    // then build the result card from the recorded user messages.
    hooks.setHintMessage(data.hint?.message ?? '建议结束本次诘问并生成成果卡。');
    hooks.setHintOptions(null);
    await completeSession(data.session, hooks);
    return;
  }

  if (data.hint) {
    hooks.setHintMessage(data.hint.message);
    hooks.setHintOptions(data.hint.hint ?? null);
  } else {
    hooks.setHintMessage(null);
    hooks.setHintOptions(null);
  }
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
  const [hotlist, setHotlist] = useState<{ items: { id: string; title: string; url: string }[]; source: 'live' | 'cache' | 'demo'; updatedAt: number } | null>(null);
  const [hotlistLoading, setHotlistLoading] = useState(true);
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
      setCompleted,
      setResultCard,
    });
  };

  const runInterrogate = async (
    sess: Session,
    payload: { action: InterrogateAction; answer?: string; viewpoint?: Viewpoint }
  ) => {
    const data = await postInterrogate(sess, payload);
    if (data) {
      await applyInterrogateResponse(data, {
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
        setCompleted,
        setResultCard,
      });
    }
  };

  // Restore session from URL on reload (#15: the persisted interrogation
  // state decides between "checkpoint pending" and "round N question pending").
  useEffect(() => {
    const restore = async () => {
      const params = new URLSearchParams(window.location.search);
      const sessionId = params.get('session');
      if (sessionId) {
        const data = await storageProvider.loadSession(sessionId);
        if (data) {
          setSession(data);
          if (data.report) setReport(data.report);
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
                setCompleted,
                setResultCard,
              };
              const resp = await postInterrogate(data, {
                action: 'start',
                viewpoint: data.selectedViewpoint,
              });
              if (resp) await applyInterrogateResponse(resp, hooks);
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, initialOpinion }),
      });

      if (!res.ok) {
        throw new Error(`API error: ${res.status}`);
      }

      const { sessionId, report, knowledgeGraph } = (await res.json()) as {
        sessionId: string;
        report: Report;
        progress: { stage: string; message: string; timestamp: number }[];
        knowledgeGraph?: import('@/lib/knowledge-graph').KnowledgeGraph | null;
      };

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

    const userAnswer = answer.trim();
    setAnswer('');

    // Ticket #15: the API records the answer, updates the uncertain streak,
    // gates the checkpoint, and plans/persists the next round.
    await runInterrogate(session, { action: 'answer', answer: userAnswer });
  };

  // Ticket #14/#15: continue from the checkpoint decision into the next round.
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
    setUncertainStreak(0);
    setHintMessage(null);
    setHintOptions(null);
    setCompleted(false);
    setResultCard(null);
    setCurrentSources(null);
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

  return (
    <div className="min-h-screen">
      <header className="border-b bg-white">
        <div className="px-4 py-3 flex justify-between items-center">
          <h1 className="text-xl font-bold text-blue-600">知研</h1>
          <span className="text-sm text-gray-600 truncate max-w-xs">
            {session?.question}
          </span>
        </div>
      </header>

      <div className="flex h-[calc(100vh-57px)]">
        <ReportPanel report={report!} knowledgeGraph={session?.knowledgeGraph ?? null} />

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
              usedFallback={usedFallback}
              hintMessage={hintMessage}
              hintOptions={hintOptions}
              sources={currentSources}
              answer={answer}
              onAnswerChange={setAnswer}
              onSubmit={handleSendAnswer}
              onContinue={handleCheckpointContinue}
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
