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
    <div className="flex min-w-0 flex-1 flex-col overflow-y-auto border-r bg-slate-50 p-6 space-y-6">
      <main className="min-w-0 flex-1 space-y-6">
        {/* Source state badge (#18: honest live/cache/demo disclosure; #19 adds
            the cache retrieval time for cache states) */}
        {overallState && (
          <div className="flex items-center gap-2">
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
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 text-xs">
            {degradationMessage}
          </div>
        )}

        {/* #23: regenerate button — visible only after user has excluded at least one history source */}
        {onRegenerate && excludedHistoryIds.length > 0 && (
          <div>
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

        {/* Title & Subtitle Header */}
        <div className="space-y-2">
          {report.subtitle && (
            <div className="flex flex-wrap items-center gap-2">
              <span
                data-testid="report-subtitle-badge"
                className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-100"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                {report.subtitle}
              </span>
              {report.originalQuestion && report.originalQuestion !== report.question && (
                <span className="text-xs text-slate-400 line-clamp-1">
                  原议题：{report.originalQuestion}
                </span>
              )}
            </div>
          )}
          <h2 className="text-2xl font-bold text-slate-900 leading-snug">{report.title}</h2>
        </div>

        {/* PRD v4.2 §3.3: title → 核心观点 (each with its own evidence) →
            知识图谱 → 分类引用。When synthesis is unavailable, show an explicit
            notice rather than a fabricated set of viewpoints. */}
        {report.synthesis && report.synthesis.viewpoints.length > 0 ? (
          <div className="bg-white rounded-xl border border-slate-200/80 p-6 shadow-xs" data-testid="report-synthesis">
            <h3 className="font-semibold text-base mb-4 text-blue-600 flex items-center gap-2" data-testid="report-viewpoints-heading">
              <span>🎯 核心观点</span>
            </h3>
            <ol className="space-y-4" data-testid="report-viewpoints">
              {report.synthesis.viewpoints.map((viewpoint, index) => (
                <li key={viewpoint.id} data-testid="report-viewpoint" className="border-b border-slate-100 pb-4 last:border-b-0 last:pb-0">
                  <p className="font-medium text-sm text-slate-900 mb-2 leading-relaxed" data-testid="report-viewpoint-conclusion">
                    观点 {index + 1}：{viewpoint.conclusion}
                  </p>
                  {viewpoint.evidence.length > 0 && (
                    <div className="ml-2 pl-3 border-l-2 border-slate-100" data-testid="report-viewpoint-evidence">
                      <h4 className="font-medium text-xs mb-1.5 text-slate-600">📖 主要内容</h4>
                      <ul className="list-disc list-inside space-y-1.5 text-sm text-slate-700 leading-relaxed">
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
            className="bg-white rounded-xl border border-slate-200/80 p-6 text-sm text-slate-500 shadow-xs"
            data-testid="report-synthesis-legacy"
          >
            当前未能生成 AI 综合观点；材料仍保留在下方引用来源中。请在 AI 服务可用后重新生成报告。
          </div>
        )}

        {/* 1. 知识图谱 (放到报告正文下方) */}
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

        {/* 2. 引用来源 (放到知识图谱下方) */}
        <section className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-xs" data-testid="references-sidebar">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-blue-600 flex items-center gap-2">
              <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
              <span>引用来源（{report.references.length}）</span>
            </h3>
            <span className="text-xs text-slate-400">研报支撑材料明细与出处</span>
          </div>

          {report.references.length > 0 ? (
            <div className="space-y-5">
              {Object.entries(grouped).map(([type, sources]) => {
                if (sources.length === 0) return null;

                // personal_history
                if (type === 'personal_history') {
                  return (
                    <div key={type} className="border-t border-slate-100 pt-4 first:border-t-0 first:pt-0">
                      <h4 className="text-xs font-semibold text-slate-500 mb-3 uppercase tracking-wider">
                        本报告引用 {sources.length} 条个人历史
                      </h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {sources.map((src) => {
                          const globalIndex = report.references.indexOf(src) + 1;
                          const isExcluded = src.sourceSessionId
                            ? excludedSet.has(src.sourceSessionId)
                            : false;

                          return (
                            <div
                              key={src.id}
                              id={`source-citation-${globalIndex}`}
                              className={`border border-slate-200 rounded-lg p-3 text-sm bg-slate-50/70 transition-all ${isExcluded ? 'opacity-50' : ''}`}
                            >
                              <div className="flex items-start gap-2.5">
                                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-xs font-bold shrink-0 mt-0.5">
                                  {globalIndex}
                                </span>
                                <div className="flex-1 min-w-0">
                                  <span className="text-slate-900 font-medium line-clamp-1">
                                    {src.title ?? '个人历史报告'}
                                  </span>
                                  <div className="text-slate-400 text-xs mt-1">
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
                                        className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                      />
                                      <label
                                        htmlFor={`history-toggle-${src.sourceSessionId}`}
                                        className="text-xs text-slate-600 cursor-pointer select-none"
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

                // Other source types
                return (
                  <div key={type} className="border-t border-slate-100 pt-4 first:border-t-0 first:pt-0">
                    <h4 className="text-xs font-semibold text-slate-500 mb-3 uppercase tracking-wider">
                      {TYPE_LABELS[type] ?? type}（{sources.length}）
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {sources.map((src) => {
                        const globalIndex = report.references.indexOf(src) + 1;
                        const sourceState = src.type === 'zhihu' ? zhihuSourceState : webSourceState;
                        const url = isUsableExternalUrl(src, sourceState) ? src.url!.trim() : null;

                        return (
                          <div
                            key={src.id}
                            id={`source-citation-${globalIndex}`}
                            className="border border-slate-200 rounded-lg p-3 text-sm bg-slate-50/70 transition-all hover:bg-slate-50"
                          >
                            <div className="flex items-start gap-2.5">
                              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-xs font-bold shrink-0 mt-0.5">
                                {globalIndex}
                              </span>
                              <div className="flex-1 min-w-0">
                                <div className="text-slate-800 text-xs font-medium">
                                  <span>{src.author ?? '未知作者'}</span>
                                  {src.title && (
                                    <>
                                      <span className="text-slate-300 mx-1">/</span>
                                      <span className="text-slate-900 font-semibold line-clamp-1 inline">
                                        {src.title}
                                      </span>
                                    </>
                                  )}
                                </div>
                                {src.excerpt && (
                                  <p className="text-xs text-slate-500 mt-1 line-clamp-2 leading-relaxed">
                                    {src.excerpt}
                                  </p>
                                )}
                                {url ? (
                                  <div className="mt-1.5">
                                    <a
                                      href={url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-blue-600 hover:underline text-xs inline-flex items-center gap-1 break-all"
                                    >
                                      <span>查看原始出处</span>
                                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                      </svg>
                                    </a>
                                  </div>
                                ) : (
                                  <div className="text-slate-400 text-[11px] mt-1">
                                    {sourceState === 'demo' ? '演示数据：无原始链接' : '来源链接：内置/非公开材料'}
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
          ) : (
            <p className="text-sm italic text-slate-400 py-2">暂无任何引用材料</p>
          )}
        </section>

        {/* 3. 相关推荐 / 相关阅读 (放到引用来源下方) */}
        {(recommendations.author.length > 0 || recommendations.topics.length > 0) && (
          <section className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-xs" data-testid="recommendations-sidebar">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-emerald-700 flex items-center gap-2">
                <svg className="w-5 h-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
                </svg>
                <span>相关推荐与拓展阅读</span>
              </h3>
              <span className="text-xs text-slate-400">同作者与关联话题推荐</span>
            </div>
            <div className="space-y-4">
              {recommendations.author.length > 0 && (
                <RecommendationGroup title="被引用作者的其他帖子" sources={recommendations.author} />
              )}
              {recommendations.topics.length > 0 && (
                <RecommendationGroup title="相关话题推荐" sources={recommendations.topics} />
              )}
            </div>
          </section>
        )}
      </main>
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
