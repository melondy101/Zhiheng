'use client';

import { useState } from 'react';

interface HotlistItem {
  id: string;
  title: string;
  /** Null when the provider record carried no URL — never fabricated (#19). */
  url: string | null;
}

interface HotlistResult {
  items: HotlistItem[];
  source: 'live' | 'cache' | 'demo';
  updatedAt: number;
  stale?: boolean;
}

type Page = 'home' | 'session';

interface HomePageProps {
  onStart: (question: string, initialOpinion: string | null) => void;
  hotlist?: HotlistResult | null;
  hotlistLoading?: boolean;
  loading?: boolean;
  errorMessage?: string | null;
  recentSessions?: Array<{ id: string; question: string; updatedAt: number }>;
  onResumeSession?: (sessionId: string) => void;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// PRD v4.2 §2.3: the label must state the real source and, for cache, the
// real update time — demo data is always disclosed as 演示数据.
//
// Exported so the exact wording is pinned by a unit test inside `npm test`
// (the e2e suite is a separate script and cannot guard it on its own).
export function sourceLabel(source: 'live' | 'cache' | 'demo', ts: number, stale?: boolean): string {
  switch (source) {
    case 'live': return '实时热榜';
    case 'cache':
      return stale
        ? `缓存已过期 · 更新于 ${formatTime(ts)}`
        : `缓存 · 更新于 ${formatTime(ts)}`;
    case 'demo': return '演示数据';
  }
}

export default function HomePage({
  onStart,
  hotlist,
  hotlistLoading,
  loading = false,
  errorMessage,
  recentSessions,
  onResumeSession,
}: HomePageProps) {
  const [question, setQuestion] = useState('');
  const [initialOpinion, setInitialOpinion] = useState('');

  const handleHotlistClick = (title: string) => {
    setQuestion(title);
    const textarea = document.getElementById('question') as HTMLTextAreaElement | null;
    if (textarea) {
      textarea.focus();
      textarea.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim() || loading) return;
    onStart(question.trim(), initialOpinion.trim() || null);
  };

  return (
    <div className="min-h-screen bg-gray-50/50">
      <header className="border-b bg-white">
        <div className="max-w-4xl mx-auto px-4 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-blue-600">知研</h1>
            <p className="text-sm text-gray-600">AI 问人，让观点经得起追问</p>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-10 space-y-6">
        {/* Primary action: Question input */}
        <div className="bg-white rounded-xl shadow-xs border p-8">
          <h2 className="text-xl font-semibold mb-6">开始思考</h2>
          {errorMessage && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg">
              {errorMessage}
            </div>
          )}
          <form onSubmit={handleSubmit}>
            <div className="mb-4">
              <label htmlFor="question" className="block text-sm font-medium mb-2">
                输入你想思考的问题
              </label>
              <textarea
                id="question"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="例如：AI是否会取代人类创造力？"
                className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                rows={3}
                disabled={loading}
              />
            </div>

            <details className="mb-6">
              <summary className="text-sm text-blue-600 cursor-pointer hover:text-blue-700 select-none">
                补充我的初步看法（可选）
              </summary>
              <textarea
                value={initialOpinion}
                onChange={(e) => setInitialOpinion(e.target.value)}
                placeholder="你目前的看法是什么？"
                className="w-full p-3 border rounded-lg mt-2 focus:ring-2 focus:ring-blue-500 text-sm"
                rows={2}
                disabled={loading}
              />
            </details>

            <button
              type="submit"
              disabled={!question.trim() || loading}
              className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>检索分析中...</span>
                </>
              ) : (
                '开始思考'
              )}
            </button>
          </form>
        </div>

        {/* Recent sessions if available */}
        {recentSessions && recentSessions.length > 0 && (
          <div className="bg-white rounded-xl shadow-xs border p-6">
            <h2 className="text-base font-semibold text-gray-800 mb-3">最近会话</h2>
            <div className="space-y-2">
              {recentSessions.map((sess) => (
                <button
                  key={sess.id}
                  type="button"
                  onClick={() => onResumeSession?.(sess.id)}
                  className="w-full text-left p-3 rounded-lg hover:bg-gray-50 border border-gray-100 flex items-center justify-between text-sm transition-colors"
                >
                  <span className="font-medium text-gray-800 truncate pr-4">{sess.question}</span>
                  <span className="text-xs text-gray-400 shrink-0 font-mono" suppressHydrationWarning>
                    {formatTime(sess.updatedAt)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Hotlist section as inspiration */}
        {hotlistLoading && (
          <div className="bg-white rounded-xl shadow-xs border p-6">
            <p className="text-gray-500 text-center text-sm">加载热榜中...</p>
          </div>
        )}

        {!hotlistLoading && hotlist && hotlist.items.length > 0 && (
          <div className="bg-white rounded-xl shadow-xs border p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-gray-800">知乎热榜</h2>
                <span className="text-xs text-gray-400">（点击直接填入思考问题）</span>
              </div>
              <span className="text-xs text-gray-500" data-testid="hotlist-source-state" suppressHydrationWarning>
                {sourceLabel(hotlist.source, hotlist.updatedAt, hotlist.stale)}
              </span>
            </div>
            <ol className="space-y-1.5">
              {hotlist.items.slice(0, 10).map((item, idx) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => handleHotlistClick(item.title)}
                    className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50 text-sm text-gray-700 hover:text-blue-600 transition-colors flex items-start gap-2.5 group"
                  >
                    <span className="text-gray-400 group-hover:text-blue-500 font-mono text-xs mt-0.5 shrink-0 w-4 text-right">
                      {idx + 1}
                    </span>
                    <span className="truncate">{item.title}</span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
        )}
      </main>
    </div>
  );
}
