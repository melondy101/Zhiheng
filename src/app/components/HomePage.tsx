'use client';

import { useState } from 'react';
import { hotlistBackground, makeHotlistCoreQuestion } from '@/lib/hotlist-question';
import SessionFeedbackCue from './SessionFeedbackCue';
import UserNav from './UserNav';
import ThemeToggle from './ThemeToggle';
import { Compass, Sparkles, MessageSquare, Clock, ArrowRight, Flame } from 'lucide-react';

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
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const handleHotlistClick = (title: string) => {
    const coreQuestion = makeHotlistCoreQuestion(title);
    setQuestion(coreQuestion);
    setInitialOpinion(hotlistBackground(title, coreQuestion) ?? '');
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

  const hasSessions = recentSessions && recentSessions.length > 0;

  return (
    <div className="min-h-screen bg-surface flex flex-col md:flex-row text-content-primary relative transition-colors duration-200">
      {/* Mobile Top Header */}
      <div className="md:hidden border-b border-line bg-surface-elevated px-4 py-3 flex items-center justify-between sticky top-0 z-30 shadow-xs">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            aria-label={isSidebarOpen ? '收起侧栏' : '展开侧栏'}
            className="p-1.5 rounded-lg border border-line text-content-secondary hover:bg-surface-subtle"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="font-bold text-lg text-brand font-serif">知研</span>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle compact />
          <UserNav compact />
        </div>
      </div>

      {/* Left Sidebar */}
      <aside
        id="home-sidebar"
        className={`bg-surface-elevated border-r border-line flex flex-col h-auto md:h-screen md:sticky md:top-0 transition-all duration-300 ease-in-out z-20 ${
          isSidebarOpen ? 'block' : 'hidden md:flex'
        } ${isSidebarCollapsed ? 'md:w-16 shrink-0' : 'w-full md:w-80 lg:w-96 shrink-0'}`}
      >
        {/* Brand Header */}
        <div className={`p-4 border-b border-line flex items-center transition-all ${
          isSidebarCollapsed ? 'justify-center flex-col gap-3 py-4' : 'justify-between min-w-[280px]'
        }`}>
          {!isSidebarCollapsed ? (
            <>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xl font-bold text-brand font-serif tracking-wide">
                    知研
                  </span>
                  <span className="px-2 py-0.5 text-[10px] font-medium bg-brand-light text-brand rounded border border-brand-subtle">
                    MVP
                  </span>
                </div>
                <p className="text-xs text-content-secondary mt-0.5">AI 问人，让观点经得起追问</p>
              </div>

              {/* Desktop Sidebar Collapse Button */}
              <button
                type="button"
                id="collapse-sidebar-button"
                onClick={() => setIsSidebarCollapsed(true)}
                title="收起侧边栏"
                aria-label="收起侧边栏"
                className="hidden md:flex p-1.5 text-content-tertiary hover:text-content-primary hover:bg-surface-subtle rounded-lg transition-colors border border-transparent hover:border-line items-center justify-center"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                </svg>
              </button>
            </>
          ) : (
            <>
              <div
                className="cursor-pointer flex flex-col items-center group"
                onClick={() => setIsSidebarCollapsed(false)}
                title="展开侧边栏"
              >
                <span className="text-base font-bold text-brand font-serif leading-none py-0.5 select-none">
                  知研
                </span>
              </div>

              <button
                type="button"
                id="expand-sidebar-icon-button"
                onClick={() => setIsSidebarCollapsed(false)}
                title="展开历史会话"
                aria-label="展开历史会话"
                className="p-2 text-content-tertiary hover:text-brand hover:bg-surface-subtle rounded-xl transition-all border border-transparent hover:border-line"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                </svg>
              </button>
            </>
          )}
        </div>

        {/* Scrollable Container with Recent Sessions */}
        {!isSidebarCollapsed ? (
          <div className="flex-1 overflow-y-auto p-4 space-y-3 min-w-[280px]">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-content-secondary" />
                <h2 className="text-xs font-semibold uppercase tracking-wider text-content-secondary">最近思辨手记</h2>
              </div>
              {hasSessions && (
                <span className="px-2 py-0.5 bg-surface-subtle text-content-secondary rounded-full text-[11px] font-mono border border-line">
                  {recentSessions.length}
                </span>
              )}
            </div>

            <div id="recent-sessions-container" className="space-y-1.5 pt-1">
              {hasSessions ? (
                <div className="space-y-1.5">
                  {recentSessions.map((sess) => (
                    <button
                      key={sess.id}
                      type="button"
                      onClick={() => onResumeSession?.(sess.id)}
                      className="w-full text-left p-2.5 rounded-xl hover:bg-surface-subtle hover:border-line-strong border border-line bg-surface flex flex-col gap-1 text-xs transition-colors group"
                    >
                      <span className="font-medium text-content-primary group-hover:text-brand line-clamp-2 leading-relaxed">
                        {sess.question}
                      </span>
                      <span className="text-[10px] text-content-tertiary font-mono" suppressHydrationWarning>
                        {formatTime(sess.updatedAt)}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="text-center py-10 px-2 text-content-tertiary">
                  <p className="text-xs">暂无历史思辨记录</p>
                  <p className="text-[11px] text-content-tertiary mt-1">输入议题后将自动归档</p>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center py-4 space-y-3">
            <button
              type="button"
              onClick={() => setIsSidebarCollapsed(false)}
              title="最近会话"
              className="p-2 text-content-secondary hover:text-brand hover:bg-surface-subtle rounded-xl relative group transition-colors"
            >
              <MessageSquare className="w-4 h-4" />
              {hasSessions && (
                <span className="absolute top-1 right-1 w-2 h-2 bg-accent rounded-full ring-2 ring-surface-elevated" />
              )}
            </button>
          </div>
        )}

        {/* Sidebar Footer */}
        <div className={`border-t border-line bg-surface-subtle/50 p-3 ${isSidebarCollapsed ? 'flex justify-center p-2' : 'flex items-center justify-between'}`}>
          {!isSidebarCollapsed && <ThemeToggle />}
          <UserNav compact={isSidebarCollapsed} />
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col items-center justify-start p-4 sm:p-8 lg:p-12 overflow-y-auto relative">
        {/* Desktop Top Right Controls */}
        <div className="hidden md:flex absolute top-5 right-6 z-10 items-center gap-3">
          <ThemeToggle />
          <UserNav />
        </div>

        {loading && (
          <div
            className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 px-4 backdrop-blur-xs"
            role="status"
            aria-live="polite"
            data-testid="report-loading-overlay"
          >
            <div className="w-full max-w-md rounded-2xl border border-line bg-surface-elevated p-6 shadow-xl">
              <SessionFeedbackCue state="retrieving" className="mb-5 w-full" />
              <div className="mb-2 flex items-center justify-between text-xs font-medium text-content-secondary">
                <span>正在准备你的思辨材料</span>
                <span className="text-accent font-semibold">请稍候</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-surface-subtle" aria-hidden="true">
                <div className="h-full w-2/5 rounded-full bg-brand loading-progress-bar" />
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-center text-[11px] text-content-tertiary">
                <span className="font-medium text-brand">检索知乎</span>
                <span>汇总全网</span>
                <span>生成研报</span>
              </div>
            </div>
          </div>
        )}

        <div className="w-full max-w-3xl space-y-6 my-auto">
          {/* Hero Prompt */}
          <div className="text-center space-y-2 pt-2">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-content-primary font-serif">
              你想探讨什么议题？
            </h2>
            <p className="text-sm text-content-secondary max-w-md mx-auto leading-relaxed">
              基于知乎与全网权威信息检索，提炼关键证据，开启多轮温和思辨诘问
            </p>
          </div>

          {/* Core Input Card */}
          <div className="bg-surface-elevated rounded-2xl shadow-sm border border-line p-6 sm:p-8 transition-all hover:shadow-md">
            {errorMessage && (
              <div className="mb-4 p-3 bg-semantic-error-light border border-semantic-error/30 text-semantic-error text-xs rounded-lg flex items-start gap-2">
                <svg className="w-4 h-4 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>{errorMessage}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="question" className="block text-xs font-semibold text-content-secondary uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Compass className="w-3.5 h-3.5 text-accent" />
                  <span>核心问题</span>
                </label>
                <textarea
                  id="question"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="输入你想思考的问题，或点击下方热榜话题...（例如：AI是否会取代人类创造力？）"
                  className="w-full p-3.5 border border-line bg-surface rounded-xl focus:ring-2 focus:ring-brand/20 focus:border-brand text-sm text-content-primary placeholder:text-content-tertiary transition-all outline-none resize-none leading-relaxed"
                  rows={3}
                  disabled={loading}
                />
              </div>

              <details className="group">
                <summary className="text-xs text-accent hover:text-accent-hover font-medium cursor-pointer select-none inline-flex items-center gap-1">
                  <span>+ 补充我的初步看法（可选）</span>
                </summary>
                <div className="mt-2.5">
                  <textarea
                    value={initialOpinion}
                    onChange={(e) => setInitialOpinion(e.target.value)}
                    placeholder="你目前的看法或倾向是什么？系统将针对你的观点展开定制化追问。"
                    className="w-full p-3 border border-line bg-surface rounded-xl focus:ring-2 focus:ring-brand/20 focus:border-brand text-xs text-content-primary placeholder:text-content-tertiary outline-none resize-none leading-relaxed"
                    rows={2}
                    disabled={loading}
                  />
                </div>
              </details>

              <button
                type="submit"
                disabled={!question.trim() || loading}
                className="w-full bg-brand hover:bg-brand-hover text-content-inverse py-3 px-4 rounded-xl font-medium text-sm shadow-sm hover:shadow transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 active:scale-[0.98]"
              >
                {loading ? (
                  <>
                    <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>检索全网材料并构建研报中...</span>
                  </>
                ) : (
                  <>
                    <span>开始思考</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>
          </div>

          {/* Zhihu Hotlist Card */}
          <div className="bg-surface-elevated rounded-2xl shadow-xs border border-line p-5 space-y-3">
            <div className="flex items-center justify-between pb-1 border-b border-line">
              <div className="flex items-center gap-2">
                <Flame className="w-4 h-4 text-accent animate-pulse" />
                <h2 className="text-sm font-semibold text-content-primary font-serif">知乎热榜灵感</h2>
                <span className="text-xs text-content-tertiary">（点击生成单一核心问题）</span>
              </div>
              {hotlist && (
                <span
                  className="text-xs text-content-secondary font-mono bg-surface-subtle px-2 py-0.5 rounded border border-line"
                  data-testid="hotlist-source-state"
                  suppressHydrationWarning
                >
                  {sourceLabel(hotlist.source, hotlist.updatedAt, hotlist.stale)}
                </span>
              )}
            </div>

            {hotlistLoading && (
              <div className="py-6 text-center text-xs text-content-tertiary">
                <span className="inline-block w-4 h-4 border-2 border-brand border-t-transparent rounded-full animate-spin mr-1.5 align-middle" />
                加载实时热榜中...
              </div>
            )}

            {!hotlistLoading && hotlist && hotlist.items.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {hotlist.items.slice(0, 10).map((item, idx) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleHotlistClick(item.title)}
                    className="text-left px-3 py-2 rounded-xl hover:bg-surface-subtle hover:border-line-strong border border-line bg-surface text-xs text-content-primary hover:text-brand transition-colors flex items-start gap-2 group"
                  >
                    <span
                      className={`font-mono text-xs mt-0.5 shrink-0 w-4 text-center font-bold ${
                        idx < 3 ? 'text-accent' : 'text-content-tertiary group-hover:text-brand'
                      }`}
                    >
                      {idx + 1}
                    </span>
                    <span className="line-clamp-2 leading-relaxed">{item.title}</span>
                  </button>
                ))}
              </div>
            )}

            {!hotlistLoading && (!hotlist || hotlist.items.length === 0) && (
              <p className="text-xs text-content-tertiary py-3 text-center">暂无热榜数据</p>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
