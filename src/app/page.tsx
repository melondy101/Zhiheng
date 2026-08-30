'use client';

import { useEffect, useRef, useState } from 'react';
import type { Session, Report, Viewpoint, Message, ResultCard } from '@/lib/providers';
import type { StrategyId } from '@/lib/strategy-engine';
import { actionAfterAnswer, resumePlan } from '@/lib/strategy-engine';
import { FixtureRetrievalProvider, FixtureLLMProvider } from '@/lib/fixture-providers';
import { BrowserStorageProvider, StaticReportRenderer, buildResultCard } from '@/lib/demo-providers';
import HomePage from './components/HomePage';
import ReportPanel from './components/ReportPanel';
import StanceSelector from './components/StanceSelector';
import QAPanel from './components/QAPanel';
import ResultCardView, { ResultCardViewFromSession } from './components/ResultCardView';

const retrievalProvider = new FixtureRetrievalProvider();
const llmProvider = new FixtureLLMProvider();
const storageProvider = new BrowserStorageProvider();
const renderingProvider = new StaticReportRenderer();

type Page = 'home' | 'session';

interface QuestionPlanHooks {
  setCurrentQuestion: (q: string | null) => void;
  setCurrentStrategy: (s: StrategyId | null) => void;
  setCurrentRound: (r: number) => void;
  setUsedFallback: (u: boolean) => void;
  setIsCheckpoint: (v: boolean) => void;
}

/**
 * Plan the next round for `sess` and push the question into page state.
 * Module-level so it can be called from the restore effect without adding
 * component-scope dependencies (react-hooks/exhaustive-deps).
 */
async function planAndSetQuestion(sess: Session, hooks: QuestionPlanHooks) {
  const { planNextRound, recordStrategy } = await import('@/lib/strategy-engine');
  const { withFallback } = await import('@/lib/llm-fallback');
  const result = await planNextRound(sess, (strategy, s) =>
    llmProvider.generateStrategyQuestion(strategy, s)
  );
  const fb = await withFallback(result.strategy, sess, () =>
    llmProvider.generateStrategyQuestion(result.strategy, sess)
  );
  recordStrategy(sess, result.strategy);
  hooks.setCurrentQuestion(fb.question);
  hooks.setCurrentStrategy(result.strategy);
  hooks.setCurrentRound(result.round);
  hooks.setUsedFallback(fb.usedFallback);
  // Planning a question clears any pending checkpoint decision (#14).
  hooks.setIsCheckpoint(false);
}

export default function Home() {
  const [page, setPage] = useState<Page>('home');
  const [session, setSession] = useState<Session | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedViewpoint, setSelectedViewpoint] = useState<Viewpoint | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState<string | null>(null);
  const [currentStrategy, setCurrentStrategy] = useState<import('@/lib/strategy-engine').StrategyId | null>(null);
  const [isCheckpoint, setIsCheckpoint] = useState(false);
  const [currentRound, setCurrentRound] = useState(0);
  const [usedFallback, setUsedFallback] = useState(false);
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

  // Restore session from URL on reload
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
            // Ticket #14: resume the interrogation at the correct round.
            // If the session was interrupted right after a checkpoint-round
            // answer (5, 8, 11…), resume at the checkpoint decision so the
            // gate cannot be bypassed by refreshing.
            const plan = resumePlan(data);
            if (plan.action === 'checkpoint') {
              setCurrentRound(plan.answeredRounds);
              setCurrentQuestion(null);
              setIsCheckpoint(true);
            } else {
              await planAndSetQuestion(data, {
                setCurrentQuestion,
                setCurrentStrategy,
                setCurrentRound,
                setUsedFallback,
                setIsCheckpoint,
              });
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
        body: JSON.stringify({ question }),
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
    const updated = { ...session, selectedViewpoint: viewpoint };
    setSelectedViewpoint(viewpoint);
    setSession(updated);
    await storageProvider.saveSession(updated);
    await generateQuestion(updated);
  };

  const handleCustomViewpoint = async (text: string) => {
    if (!session) return;
    const customViewpoint: Viewpoint = { id: 'custom', text, source: 'user_authored' };
    const updated = { ...session, selectedViewpoint: customViewpoint };
    setSelectedViewpoint(customViewpoint);
    setSession(updated);
    await storageProvider.saveSession(updated);
    await generateQuestion(updated);
  };

  const generateQuestion = async (sess: Session) => {
    await planAndSetQuestion(sess, {
      setCurrentQuestion,
      setCurrentStrategy,
      setCurrentRound,
      setUsedFallback,
      setIsCheckpoint,
    });
  };

  const handleSendAnswer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || !answer.trim()) return;
    if (isCheckpoint) return; // checkpoint decision pending — answer form is hidden

    const userAnswer = answer.trim();
    setAnswer('');

    // Detect uncertain answer (ticket #10)
    const { isUncertainAnswer, uncertainResponse } = await import('@/lib/llm-fallback');
    const uncertain = isUncertainAnswer(userAnswer);
    const newStreak = uncertain ? uncertainStreak + 1 : 0;
    setUncertainStreak(newStreak);

    if (newStreak >= 3) {
      setHintMessage('建议结束本次诘问并生成成果卡。');
      setHintOptions(null);
      await handleCompleteNow();
      return;
    }

    if (newStreak > 0) {
      const hint = uncertainResponse(newStreak, session);
      setHintMessage(hint.message);
      setHintOptions(hint.hint ?? null);
    } else {
      setHintMessage(null);
      setHintOptions(null);
    }

    const userMsg: Message = {
      id: `m_${Date.now()}_u`,
      role: 'user',
      text: userAnswer,
      timestamp: Date.now(),
    };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);

    // Ticket #14: keep the session and move to the next round instead of
    // completing after the first answer.
    const justAnsweredRound =
      currentRound > 0
        ? currentRound
        : updatedMessages.filter((m) => m.role === 'user').length;
    const updatedSession: Session = {
      ...session,
      messages: updatedMessages,
      updatedAt: Date.now(),
    };
    setSession(updatedSession);
    await storageProvider.saveSession(updatedSession);

    // After a checkpoint-round answer (5, 8, 11…) show the checkpoint
    // decision instead of planning the next question.
    if (actionAfterAnswer(justAnsweredRound) === 'checkpoint') {
      setCurrentQuestion(null);
      setIsCheckpoint(true);
      return;
    }

    await generateQuestion(updatedSession);
  };

  // Ticket #14: continue from the checkpoint decision into the next round.
  const handleCheckpointContinue = async () => {
    if (!session) return;
    setHintMessage(null);
    setHintOptions(null);
    await generateQuestion(session);
  };

  // User-triggered exit at any round
  const handleCompleteNow = async () => {
    if (!session) return;
    const card: ResultCard = await renderingProvider.renderResultCard(buildResultCard(session));
    const completedSession: Session = {
      ...session,
      completed: true,
      resultCard: card,
      updatedAt: Date.now(),
    };
    await storageProvider.saveSession(completedSession);
    setResultCard(card);
    setCompleted(true);
    setCurrentQuestion(null);
    setSession(completedSession);

    // Update profile (ticket #12)
    const { buildProfileFromSession, updateProfile, loadProfile, saveProfile } = await import('@/lib/lifecycle');
    const conclusions = buildProfileFromSession(completedSession);
    if (conclusions.length > 0) {
      const next = updateProfile(loadProfile(), conclusions);
      saveProfile(next);
    }
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
              answer={answer}
              onAnswerChange={setAnswer}
              onSubmit={handleSendAnswer}
              onContinue={handleCheckpointContinue}
              onExit={handleCompleteNow}
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
