'use client';

import { useEffect, useState } from 'react';

import type { Report as ReportType, Source, SourceState } from '@/lib/providers';
import type { KnowledgeGraph } from '@/lib/knowledge-graph';
import KnowledgeGraphView from './KnowledgeGraphView';

interface ReportPanelProps {
  report: ReportType;
  question?: string;
  zhihuSourceState?: SourceState;
  webSourceState?: SourceState;
  degraded?: boolean;
  degradationMessage?: string;
  /** Current session ID for history source management */
  sessionId?: string;
  /** IDs of history sources excluded by the user */
  excludedHistoryIds?: string[];
  /** Called when user toggles a history source checkbox */
  onHistorySourceToggle?: (sourceSessionId: string, excluded: boolean) => void;
  /** #23: called when user clicks "重新生成报告". undefined = button hidden. */
  onRegenerate?: () => void;
  knowledgeGraph?: KnowledgeGraph | null;
  /** #19: when the badge shows cache — the retrieval time of the oldest cached channel. */
  cacheUpdatedAt?: number | null;
  /** #19: true when a cached channel is past its TTL. */
  cacheStale?: boolean;
}

const SOURCE_STATE_LABELS: Record<SourceState, string> = {
  live: '实时检索',
  cache: '缓存',
  demo: '演示数据',
  unavailable: '实时检索暂不可用',
};

const SOURCE_STATE_COLORS: Record<SourceState, { bg: string; text: string; dot: string }> = {
  live: { bg: 'bg-green-100', text: 'text-green-700', dot: 'bg-green-500' },
  cache: { bg: 'bg-yellow-100', text: 'text-yellow-700', dot: 'bg-yellow-500' },
  demo: { bg: 'bg-gray-100', text: 'text-gray-600', dot: 'bg-gray-400' },
  unavailable: { bg: 'bg-rose-100', text: 'text-rose-700', dot: 'bg-rose-500' },
};

/** Group sources by type for display. */
function groupByType(sources: Source[]): Record<string, Source[]> {
  const groups: Record<string, Source[]> = {
    zhihu: [],
    web: [],
    personal_history: [],
    knowledge_base: [],
    ai_synthesis: [],
  };
  for (const s of sources) {
    if (groups[s.type]) {
      groups[s.type].push(s);
    }
  }
  return groups;
}

function isUsableExternalUrl(source: Source, sourceState?: SourceState): boolean {
  if (!source.url?.trim()) return false;
  // Demo fixtures contain deliberately recognizable placeholder URLs. Never
  // present them as original Zhihu/web material or make them clickable.
  if (sourceState === 'demo') return false;
  return true;
}

const TYPE_LABELS: Record<string, string> = {
  zhihu: '知乎来源',
  web: '全网来源',
  personal_history: '我的历史报告',
  knowledge_base: '内置知识库（哲学/辩论/逻辑）',
  ai_synthesis: 'AI 综合分析',
};

/** #19: honest cache-time display on the cache badge. */
function formatCacheTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** #19: cache badge text — stale caches show the expiry flag plus the time
 * the data was actually retrieved; the time is never faked for live/demo. */
function cacheBadgeText(cacheUpdatedAt?: number | null, cacheStale?: boolean): string {
  if (!cacheUpdatedAt) return cacheStale ? '缓存（已过期）' : '缓存';
  return `缓存${cacheStale ? '（已过期）' : ''} · 更新于 ${formatCacheTime(cacheUpdatedAt)}`;
}

export default function ReportPanel({
  report,
  question,
  zhihuSourceState,
  webSourceState,
  degraded,
  degradationMessage,
  excludedHistoryIds = [],
  onHistorySourceToggle,
  onRegenerate,
  knowledgeGraph,
  cacheUpdatedAt = null,
  cacheStale = false,
}: ReportPanelProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [recommendations, setRecommendations] = useState<{ author: Source[]; topics: Source[] }>({ author: [], topics: [] });
  const grouped = groupByType(report.references);
  const excludedSet = new Set(excludedHistoryIds);

  useEffect(() => {
    if (!question || report.references.length === 0) return;
    const controller = new AbortController();
    void fetch('/api/recommendations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, sources: report.references }),
      signal: controller.signal,
    }).then((response) => response.ok ? response.json() : null)
      .then((data) => {
        if (data?.source === 'live') setRecommendations({ author: data.author ?? [], topics: data.topics ?? [] });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [question, report.references]);

  // Determine overall worst-case source state for badge display
  const overallState: SourceState | null =
    webSourceState === 'demo' || zhihuSourceState === 'demo'
      ? 'demo'
      : webSourceState === 'unavailable' || zhihuSourceState === 'unavailable'
      ? 'unavailable'
      : webSourceState === 'cache' || zhihuSourceState === 'cache'
      ? 'cache'
      : webSourceState === 'live' || zhihuSourceState === 'live'
      ? 'live'
      : null;

  return (
    <div className="flex min-w-0 flex-1 border-r bg-slate-50">
      <main className="min-w-0 flex-1 overflow-y-auto p-6">
      {/* Source state badge (#18: honest live/cache/demo disclosure; #19 adds
          the cache retrieval time for cache states) */}
      {overallState && (
        <div className="mb-4">
          <span
            data-testid="report-source-state"
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${SOURCE_STATE_COLORS[overallState].bg} ${SOURCE_STATE_COLORS[overallState].text}`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${SOURCE_STATE_COLORS[overallState].dot}`}
            />
            {overallState === 'cache'
              ? cacheBadgeText(cacheUpdatedAt, cacheStale)
              : SOURCE_STATE_LABELS[overallState]}
          </span>
        </div>
      )}

      {/* Degradation warning */}
      {degraded && degradationMessage && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 text-xs">
          {degradationMessage}
        </div>
      )}

      {/* #23: regenerate button — visible only after user has excluded at least one history source */}
      {onRegenerate && excludedHistoryIds.length > 0 && (
        <div className="mb-4">
          <button
            onClick={onRegenerate}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            重新生成报告（已排除 {excludedHistoryIds.length} 条历史材料）
          </button>
        </div>
      )}

      <h2 className="text-2xl font-bold mb-6">{report.title}</h2>

      {/* PRD v4.2 §3.3: title → 核心观点 (each with its own evidence) →
          知识图谱 → 分类引用。When synthesis is unavailable, show an explicit
          notice rather than a fabricated set of viewpoints. */}
      {report.synthesis && report.synthesis.viewpoints.length > 0 ? (
        <div className="bg-white rounded-lg border p-6 mb-4" data-testid="report-synthesis">
          <h3 className="font-semibold mb-4 text-blue-600" data-testid="report-viewpoints-heading">
            核心观点
          </h3>
          <ol className="space-y-4 mb-4" data-testid="report-viewpoints">
            {report.synthesis.viewpoints.map((viewpoint, index) => (
              <li key={viewpoint.id} data-testid="report-viewpoint">
                <p className="font-medium text-sm mb-2" data-testid="report-viewpoint-conclusion">
                  观点 {index + 1}：{viewpoint.conclusion}
                </p>
                {viewpoint.evidence.length > 0 && (
                  <div className="ml-2" data-testid="report-viewpoint-evidence">
                    <h4 className="font-medium text-sm mb-1 text-gray-800">📖 主要内容</h4>
                    <ul className="list-disc list-inside space-y-1 text-sm text-gray-700">
                      {viewpoint.evidence.map((item, itemIndex) => (
                        <li key={itemIndex}>
                          {renderInlineCitations(
                            `${item.summary} ${item.citationIds.map((id) => `[${id}]`).join('')}`,
                            report.references,
                            new Set(
                              report.references
                                .map((source, index) => {
                                  const state = source.type === 'zhihu' ? zhihuSourceState : webSourceState;
                                  return isUsableExternalUrl(source, state) ? index + 1 : null;
                                })
                                .filter((id): id is number => id !== null),
                            ),
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <div
          className="bg-white rounded-lg border p-6 mb-4 text-sm text-gray-500"
          data-testid="report-synthesis-legacy"
        >
          当前未能生成 AI 综合观点；材料仍保留在下方引用来源中。请在 AI 服务可用后重新生成报告。
        </div>
      )}

      </main>

      <aside
        className={`order-first min-w-0 overflow-y-auto border-r border-slate-200 bg-white p-4 ${sidebarCollapsed ? 'w-14' : 'w-80'}`}
        aria-label="研究资料侧边栏"
      >
      <div className={`mb-1 flex items-center ${sidebarCollapsed ? 'justify-center' : 'justify-between'}`}>
        {!sidebarCollapsed && <span className="px-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">研究资料</span>}
        <button
          type="button"
          id="collapse-sidebar-button"
          title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
          aria-label={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
          aria-expanded={!sidebarCollapsed}
          onClick={() => setSidebarCollapsed((value) => !value)}
          className="hidden items-center justify-center rounded-lg border border-transparent p-1.5 text-slate-400 transition-colors hover:border-slate-200 hover:bg-slate-100 hover:text-slate-700 md:flex"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={sidebarCollapsed ? 'M13 5l7 7-7 7M6 5l7 7-7 7' : 'M11 19l-7-7 7-7m8 14l-7-7 7-7'} />
          </svg>
        </button>
      </div>
      {!sidebarCollapsed && <div className="space-y-3">
      <details className="rounded-xl border border-slate-200 bg-slate-50 group" data-testid="knowledge-graph-sidebar">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold text-purple-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500">
          <span>知识图谱</span>
          <span aria-hidden="true" className="text-slate-400 transition-transform group-open:rotate-180">⌄</span>
        </summary>
        <div className="border-t border-slate-100 p-3">
          <KnowledgeGraphView
            graph={knowledgeGraph ?? null}
            onCitationClick={(citationId) => {
              const el = document.getElementById(`source-citation-${citationId}`);
              if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                el.classList.add('ring-2', 'ring-purple-500');
                setTimeout(() => el.classList.remove('ring-2', 'ring-purple-500'), 2000);
              }
            }}
          />
        </div>
      </details>

      {/* References section */}
      {report.references.length > 0 && (
        <details className="rounded-xl border border-slate-200 bg-slate-50 group" data-testid="references-sidebar">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold text-blue-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
            <span>引用来源（{report.references.length}）</span>
            <span aria-hidden="true" className="text-slate-400 transition-transform group-open:rotate-180">⌄</span>
          </summary>
          <div className="border-t border-slate-100 p-4">

          {Object.entries(grouped).map(([type, sources]) => {
            if (sources.length === 0) return null;

            // #23: personal_history gets its own labelled section with count
            if (type === 'personal_history') {
              return (
                <div key={type} className="mb-5 last:mb-0">
                  <h4 className="text-sm font-medium text-gray-500 mb-2 uppercase tracking-wide">
                    本报告引用 {sources.length} 条个人历史
                  </h4>
                  <div className="space-y-3">
                    {sources.map((src) => {
                      const globalIndex = report.references.indexOf(src) + 1;
                      const isExcluded = src.sourceSessionId
                        ? excludedSet.has(src.sourceSessionId)
                        : false;

                      return (
                        <div
                          key={src.id}
                          id={`source-citation-${globalIndex}`}
                          className={`border rounded-md p-3 text-sm bg-gray-50 transition-all ${isExcluded ? 'opacity-50' : ''}`}
                        >
                          <div className="flex items-start gap-2">
                            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-xs font-bold shrink-0 mt-0.5">
                              {globalIndex}
                            </span>
                            <div className="flex-1 min-w-0">
                              <span className="text-gray-900 font-medium">
                                {src.title ?? '个人历史报告'}
                              </span>
                              <div className="text-gray-400 text-xs mt-1">
                                {isExcluded
                                  ? '来源链接：未选择'
                                  : `来源链接：个人历史报告（${src.provenance ?? '个人上下文'}）`}
                              </div>
                              {onHistorySourceToggle && src.sourceSessionId && (
                                <div className="mt-2 flex items-center gap-2">
                                  <input
                                    type="checkbox"
                                    id={`history-toggle-${src.sourceSessionId}`}
                                    checked={!isExcluded}
                                    onChange={(e) =>
                                      onHistorySourceToggle(src.sourceSessionId!, e.target.checked)
                                    }
                                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                  />
                                  <label
                                    htmlFor={`history-toggle-${src.sourceSessionId}`}
                                    className="text-xs text-gray-600 cursor-pointer"
                                  >
                                    {isExcluded ? '未选择' : '已选择'}（点击
                                    {isExcluded ? '重新选择' : '取消选择'}）
                                  </label>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            }

            // Non-personal_history source types
            return (
              <div key={type} className="mb-5 last:mb-0">
                <h4 className="text-sm font-medium text-gray-500 mb-2 uppercase tracking-wide">
                  {TYPE_LABELS[type] ?? type}
                </h4>
                <div className="space-y-3">
                  {sources.map((src) => {
                    const globalIndex = report.references.indexOf(src) + 1;
                    const sourceState = src.type === 'zhihu' ? zhihuSourceState : webSourceState;
                    const url = isUsableExternalUrl(src, sourceState) ? src.url!.trim() : null;

                    return (
                      <div
                        key={src.id}
                        id={`source-citation-${globalIndex}`}
                        className="border rounded-md p-3 text-sm bg-gray-50 transition-all"
                      >
                        <div className="flex items-start gap-2">
                          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-xs font-bold shrink-0 mt-0.5">
                            {globalIndex}
                          </span>
                          <div className="flex-1 min-w-0">
                            <span className="text-gray-700">
                              {src.author ?? '未知作者'}
                            </span>
                            {src.title && (
                              <>
                                <span className="text-gray-400 mx-1">—</span>
                                <span className="text-gray-900 font-medium">
                                  {src.title}
                                </span>
                              </>
                            )}
                            {url ? (
                              <div className="mt-1">
                                <a
                                  href={url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-blue-600 hover:underline text-xs break-all"
                                >
                                  {url}
                                </a>
                              </div>
                            ) : (
                              <div className="text-gray-400 text-xs mt-1">
                                {sourceState === 'demo' ? '演示数据：无原始链接' : '来源链接：未知'}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          </div>
        </details>
      )}

      {(recommendations.author.length > 0 || recommendations.topics.length > 0) && (
        <details className="rounded-xl border border-slate-200 bg-slate-50 group" data-testid="recommendations-sidebar">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold text-emerald-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500">
            <span>相关阅读</span>
            <span aria-hidden="true" className="text-slate-400 transition-transform group-open:rotate-180">⌄</span>
          </summary>
          <div className="border-t border-slate-100 p-4 space-y-4">
            {recommendations.author.length > 0 && <RecommendationGroup title="被引用作者的其他帖子" sources={recommendations.author} />}
            {recommendations.topics.length > 0 && <RecommendationGroup title="相关话题" sources={recommendations.topics} />}
          </div>
        </details>
      )}

      {/* #23: explicit empty state when there are no references at all */}
      {report.references.length === 0 && (
        <details className="rounded-xl border border-slate-200 bg-slate-50">
          <summary className="min-h-11 cursor-pointer list-none px-4 py-3 text-sm font-semibold text-blue-600">引用来源（0）</summary>
          <p className="border-t border-slate-100 p-4 text-sm italic text-gray-400">暂无任何引用材料</p>
        </details>
      )}
      </div>}
      </aside>
    </div>
  );
}

function RecommendationGroup({ title, sources }: { title: string; sources: Source[] }) {
  return <section><h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h4><div className="space-y-2">
    {sources.map((source) => <a key={source.id} href={source.url!} target="_blank" rel="noopener noreferrer" className="block rounded-lg border border-slate-200 bg-white p-3 hover:border-emerald-300 hover:bg-emerald-50/40">
      <span className="block text-xs font-medium text-slate-800">{source.title ?? source.excerpt ?? '知乎内容'}</span>
      <span className="mt-1 block break-all text-[10px] text-emerald-600">{source.url}</span>
    </a>)}
  </div></section>;
}

/** Render inline text, converting [N] citation markers to styled superscript badges. */
function renderInlineCitations(
  text: string,
  references: Source[],
  clickableCitationIds: Set<number>,
): React.ReactNode {
  const parts = text.split(/(\[\d+\])/g);
  return parts.map((part, i) => {
    const match = part.match(/^\[(\d+)\]$/);
    if (match) {
      const n = parseInt(match[1], 10);
      const source = references[n - 1];
      const url = source?.url?.trim() || null;
      if (url && clickableCitationIds.has(n)) {
        return (
          <a
            key={i}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-blue-100 text-blue-700 text-xs font-bold ml-0.5 hover:bg-blue-200 hover:text-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            title={`打开原始来源 #${n}`}
            aria-label={`打开原始来源 #${n}`}
          >
            {n}
          </a>
        );
      }
      return (
        <sup
          key={i}
          className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-blue-100 text-blue-700 text-xs font-bold ml-0.5 cursor-default"
            title={`引用 #${n}`}
        >
          {n}
        </sup>
      );
    }
    return <span key={i}>{part}</span>;
  });
}
