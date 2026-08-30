'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Session, Report, Viewpoint, Message, ResultCard } from '@/lib/providers';

type Page = 'home' | 'session';

export default function Home() {
  const [page, setPage] = useState<Page>('home');
  const [session, setSession] = useState<Session | null>(null);
  const [question, setQuestion] = useState('');
  const [initialOpinion, setInitialOpinion] = useState('');
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedViewpoint, setSelectedViewpoint] = useState<Viewpoint | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState<string | null>(null);
  const [turn, setTurn] = useState(0);
  const [checkpoint, setCheckpoint] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [resultCard, setResultCard] = useState<ResultCard | null>(null);
  const [answer, setAnswer] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Restore session from URL on reload
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('session');
    if (sessionId) {
      restoreSession(sessionId);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }
  }, []);

  const restoreSession = useCallback(async (sessionId: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/session?id=${sessionId}`);
      if (!res.ok) throw new Error('Session not found');
      const data: Session = await res.json();
      setSession(data);
      if (data.report) {
        setReport(data.report);
      }
      setMessages(data.messages);
      if (data.selectedViewpoint) {
        setSelectedViewpoint(data.selectedViewpoint);
      }
      if (data.resultCard) {
        setResultCard(data.resultCard);
        setCompleted(true);
      }
      setPage('session');
    } catch (e) {
      console.error('Failed to restore session', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleStart = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim()) return;

    setLoading(true);
    try {
      // Step 1: Generate report
      const reportRes = await fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      });
      const reportData = await reportRes.json();
      setSession({ id: reportData.sessionId, question, report: reportData.report, initialOpinion: initialOpinion || null, selectedViewpoint: null, messages: [], resultCard: null, completed: false, createdAt: Date.now(), updatedAt: Date.now() });
      setReport(reportData.report);
      setPage('session');
      window.history.pushState({}, '', `?session=${reportData.sessionId}`);
    } catch (e) {
      console.error('Failed to generate report', e);
    } finally {
      setLoading(false);
    }
  };

  const handleViewpointSelect = async (viewpoint: Viewpoint) => {
    if (!session) return;
    setSelectedViewpoint(viewpoint);

    // Save selection
    await fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: session.id, selectedViewpoint: viewpoint }),
    });

    // Generate first question
    await generateQuestion();
  };

  const handleCustomViewpoint = async () => {
    if (!session || !answer.trim()) return;
    const customViewpoint: Viewpoint = {
      id: 'custom',
      text: answer.trim(),
      source: 'user_authored',
    };
    setSelectedViewpoint(customViewpoint);
    setAnswer('');

    await fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: session.id, selectedViewpoint: customViewpoint }),
    });

    await generateQuestion();
  };

  const generateQuestion = async () => {
    if (!session) return;
    const res = await fetch('/api/interrogate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id }),
    });
    const data = await res.json();
    if (data.question) {
      setCurrentQuestion(data.question);
      setTurn(data.turn);
      setCheckpoint(data.checkpoint);
    }
  };

  const handleSendAnswer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || !answer.trim()) return;

    const userAnswer = answer.trim();
    setAnswer('');

    // Optimistic UI update
    const userMsg: Message = {
      id: `tmp_${Date.now()}`,
      role: 'user',
      text: userAnswer,
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, userMsg]);

    const res = await fetch('/api/interrogate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, answer: userAnswer }),
    });
    const data = await res.json();

    if (data.completed) {
      setCompleted(true);
      setResultCard(data.resultCard);
      setCurrentQuestion(null);
    } else if (data.question) {
      const assistantMsg: Message = {
        id: `tmp_${Date.now()}_a`,
        role: 'assistant',
        text: data.question,
        strategyId: data.strategyId,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, assistantMsg]);
      setCurrentQuestion(data.question);
      setTurn(data.turn);
      setCheckpoint(data.checkpoint);
    }
  };

  const handleExit = async () => {
    if (!session) return;
    const res = await fetch('/api/session/result-card', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id }),
    });
    const data = await res.json();
    setResultCard(data.resultCard);
    setCompleted(true);
    setCurrentQuestion(null);
  };

  const handleNewSession = () => {
    setSession(null);
    setReport(null);
    setMessages([]);
    setSelectedViewpoint(null);
    setCurrentQuestion(null);
    setTurn(0);
    setCheckpoint(false);
    setCompleted(false);
    setResultCard(null);
    setQuestion('');
    setInitialOpinion('');
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
    return (
      <div className="min-h-screen">
        <header className="border-b bg-white">
          <div className="max-w-4xl mx-auto px-4 py-4 flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold text-blue-600">知研</h1>
              <p className="text-sm text-gray-600">AI 问人，让观点经得起追问</p>
            </div>
          </div>
        </header>

        <main className="max-w-2xl mx-auto px-4 py-12">
          <div className="bg-white rounded-lg shadow-sm border p-8">
            <h2 className="text-xl font-semibold mb-6">开始思考</h2>

            <form onSubmit={handleStart}>
              <div className="mb-4">
                <label htmlFor="question" className="block text-sm font-medium mb-2">
                  输入你想思考的问题
                </label>
                <textarea
                  id="question"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="例如：AI是否会取代人类创造力？"
                  className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  rows={3}
                />
              </div>

              <details className="mb-6">
                <summary className="text-sm text-blue-600 cursor-pointer hover:text-blue-700">
                  补充我的初步看法（可选）
                </summary>
                <textarea
                  value={initialOpinion}
                  onChange={(e) => setInitialOpinion(e.target.value)}
                  placeholder="你目前的看法是什么？"
                  className="w-full p-3 border rounded-lg mt-2 focus:ring-2 focus:ring-blue-500"
                  rows={2}
                />
              </details>

              <button
                type="submit"
                disabled={!question.trim() || loading}
                className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                {loading ? '生成报告中...' : '开始思考'}
              </button>
            </form>
          </div>
        </main>
      </div>
    );
  }

  // Session page
  return (
    <div className="min-h-screen">
      <header className="border-b bg-white">
        <div className="px-4 py-3 flex justify-between items-center">
          <h1 className="text-xl font-bold text-blue-600">知研</h1>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600 truncate max-w-xs">
              {session?.question}
            </span>
            <button
              onClick={handleExit}
              disabled={completed}
              className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 disabled:bg-gray-300"
            >
              结束本次思辨
            </button>
          </div>
        </div>
      </header>

      <div className="flex h-[calc(100vh-57px)]">
        {/* Left: Report */}
        <div className="flex-1 overflow-y-auto p-6 border-r">
          {report && (
            <>
              <h2 className="text-2xl font-bold mb-6">{report.title}</h2>

              {report.knowledgePoints.length > 0 && (
                <div className="bg-white rounded-lg border p-6 mb-4">
                  <h3 className="font-semibold mb-3 text-blue-600">核心知识点</h3>
                  <ul className="list-disc list-inside space-y-1 text-sm">
                    {report.knowledgePoints.map((kp, i) => (
                      <li key={i}>{kp}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="bg-white rounded-lg border p-6 mb-4">
                <h3 className="font-semibold mb-3">话题概述与主要内容</h3>
                <p className="text-sm leading-relaxed">{report.content}</p>
              </div>

              {report.viewpoints.length > 0 && (
                <div className="bg-white rounded-lg border p-6 mb-4">
                  <h3 className="font-semibold mb-3">主要观点与争议</h3>
                  <ul className="list-disc list-inside space-y-1 text-sm">
                    {report.viewpoints.map((vp, i) => (
                      <li key={i}>{vp}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="bg-white rounded-lg border p-6 mb-4">
                <h3 className="font-semibold mb-3">知识图谱</h3>
                <GraphView graph={report.graph} />
              </div>

              <div className="bg-white rounded-lg border p-6">
                <h3 className="font-semibold mb-3">引用列表</h3>
                {report.references.map((ref) => (
                  <div key={ref.id} className="text-sm mb-2">
                    <span className="text-gray-500">[{ref.id}]</span>{' '}
                    <span className="text-gray-700">{ref.title}</span>
                    {ref.url && (
                      <a href={ref.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 ml-2 hover:underline">
                        [链接]
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Right: Interrogation */}
        <div className="w-[450px] flex flex-col bg-white">
          {!selectedViewpoint && (
            <div className="p-6 border-b">
              <h3 className="font-semibold mb-4">选择一个观点，或输入你自己的看法</h3>
              <div className="space-y-2 mb-4">
                {report?.viewpoints.slice(0, 3).map((vp, i) => (
                  <button
                    key={i}
                    onClick={() => handleViewpointSelect({
                      id: `v${i}`,
                      text: vp,
                      source: 'ai_authored',
                    })}
                    className="w-full text-left p-3 border rounded-lg hover:border-blue-500 hover:bg-blue-50 text-sm"
                  >
                    {vp}
                  </button>
                ))}
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  placeholder="或直接输入你的观点..."
                  className="flex-1 p-2 border rounded-lg text-sm"
                  onKeyDown={(e) => e.key === 'Enter' && handleCustomViewpoint()}
                />
                <button
                  onClick={handleCustomViewpoint}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
                >
                  使用
                </button>
              </div>
            </div>
          )}

          {selectedViewpoint && !completed && (
            <>
              <div className="flex-1 overflow-y-auto p-6">
                {messages.length > 0 && (
                  <div className="space-y-4 mb-4">
                    {messages.map((msg) => (
                      <div
                        key={msg.id}
                        className={`p-4 rounded-lg ${
                          msg.role === 'user'
                            ? 'bg-blue-600 text-white ml-8'
                            : 'bg-gray-100 mr-8'
                        }`}
                      >
                        <p className="text-sm mb-1">{msg.text}</p>
                        {msg.strategyId && (
                          <p className="text-xs opacity-70">
                            策略: {msg.strategyId}
                          </p>
                        )}
                      </div>
                    ))}
                    <div ref={messagesEndRef} />
                  </div>
                )}

                {currentQuestion && !checkpoint && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
                    <p className="text-sm font-medium mb-2">
                      第 {turn} 轮诘问:
                    </p>
                    <p className="text-sm">{currentQuestion}</p>
                  </div>
                )}

                {checkpoint && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
                    <p className="text-sm font-medium mb-3">
                      你已完成 {turn} 轮诘问。要继续吗？
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setCheckpoint(false);
                          generateQuestion();
                        }}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
                      >
                        继续
                      </button>
                      <button
                        onClick={handleExit}
                        className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700"
                      >
                        结束并生成成果卡
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {!checkpoint && !completed && (
                <form onSubmit={handleSendAnswer} className="p-4 border-t">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={answer}
                      onChange={(e) => setAnswer(e.target.value)}
                      placeholder="输入你的回答..."
                      className="flex-1 p-2 border rounded-lg text-sm"
                    />
                    <button
                      type="submit"
                      disabled={!answer.trim()}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:bg-gray-300"
                    >
                      发送
                    </button>
                  </div>
                </form>
              )}
            </>
          )}

          {completed && resultCard && (
            <div className="flex-1 overflow-y-auto p-6">
              <h3 className="text-xl font-bold text-blue-600 mb-4">思辨成果卡</h3>

              {resultCard.initialStance && (
                <div className="mb-4">
                  <h4 className="text-sm font-semibold text-gray-600 mb-1">
                    最初立场
                  </h4>
                  <p className="text-sm bg-gray-50 p-3 rounded">
                    {resultCard.initialStance.text}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    来源: {resultCard.initialStance.source}
                  </p>
                </div>
              )}

              {resultCard.selectedStartingStance && (
                <div className="mb-4">
                  <h4 className="text-sm font-semibold text-gray-600 mb-1">
                    选择的初始立场
                  </h4>
                  <p className="text-sm bg-blue-50 p-3 rounded">
                    {resultCard.selectedStartingStance.text}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    来源: {resultCard.selectedStartingStance.source}
                  </p>
                </div>
              )}

              <div className="mb-4">
                <h4 className="text-sm font-semibold text-gray-600 mb-1">
                  最终观点
                </h4>
                <p className="text-sm bg-green-50 p-3 rounded">
                  {resultCard.finalPosition || '未形成明确最终观点'}
                </p>
              </div>

              <button
                onClick={handleNewSession}
                className="w-full mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                开启新一轮思辨
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Graph visualization component
function GraphView({ graph }: { graph: { nodes: Array<{ id: string; label: string; type: string }>; edges: Array<{ from: string; to: string; label: string; sourceType: string }> } }) {
  const nodePositions = useMemo(() => {
    const positions: Record<string, { x: number; y: number }> = {};
    const centerX = 200;
    const centerY = 180;
    graph.nodes.forEach((node, i) => {
      const angle = (i / graph.nodes.length) * 2 * Math.PI;
      const radius = 120;
      positions[node.id] = {
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle),
      };
    });
    return positions;
  }, [graph.nodes]);

  return (
    <svg width="400" height="360" className="mx-auto">
      {/* Edges */}
      {graph.edges.map((edge, i) => {
        const from = nodePositions[edge.from];
        const to = nodePositions[edge.to];
        if (!from || !to) return null;
        return (
          <line
            key={i}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            stroke={edge.sourceType === 'supported' ? '#22c55e' : edge.sourceType === 'inferred' ? '#f59e0b' : '#6366f1'}
            strokeWidth="2"
          />
        );
      })}

      {/* Nodes */}
      {graph.nodes.map((node) => {
        const pos = nodePositions[node.id];
        if (!pos) return null;
        const colors: Record<string, string> = {
          concept: '#2563eb',
          evidence: '#22c55e',
          counter: '#dc2626',
          inferred: '#f59e0b',
          user: '#6366f1',
        };
        return (
          <g key={node.id} className="graph-node">
            <circle cx={pos.x} cy={pos.y} r="20" fill={colors[node.type] || '#64748b'} />
            <text x={pos.x} y={pos.y + 1} textAnchor="middle" dominantBaseline="middle" fill="white" fontSize="10" fontWeight="bold">
              {node.label.slice(0, 4)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

