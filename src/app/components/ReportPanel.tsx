'use client';

import { useEffect, useState } from 'react';

import type { Report as ReportType, Source, SourceState } from '@/lib/providers';
import type { KnowledgeGraph } from '@/lib/knowledge-graph';
import type { ServiceDiagnostic } from '@/lib/service-diagnostics';
import KnowledgeGraphView from './KnowledgeGraphView';
import { BookOpen, Sparkles, RefreshCw, ExternalLink, Bookmark, AlertTriangle, ShieldAlert, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react';

interface ReportPanelProps {
  report: ReportType;
  question?: string;
  zhihuSourceState?: SourceState;
  webSourceState?: SourceState;
  degraded?: boolean;
  degradationMessage?: string;
  diagnostics?: Record<string, ServiceDiagnostic> | null;
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

const SOURCE_STATE_COLORS: Record<SourceState, { bg: string; text: string; dot: string; border: string }> = {
  live: { bg: 'bg-semantic-success-light', text: 'text-semantic-success', dot: 'bg-semantic-success', border: 'border-semantic-success/20' },
  cache: { bg: 'bg-semantic-warning-light', text: 'text-semantic-warning', dot: 'bg-semantic-warning', border: 'border-semantic-warning/20' },
  demo: { bg: 'bg-surface-subtle', text: 'text-content-secondary', dot: 'bg-content-tertiary', border: 'border-line' },
  unavailable: { bg: 'bg-semantic-error-light', text: 'text-semantic-error', dot: 'bg-semantic-error', border: 'border-semantic-error/20' },
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

/** #19: cache badge text — stale caches show the expiry flag plus the time */
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
  diagnostics,
  excludedHistoryIds = [],
  onHistorySourceToggle,
  onRegenerate,
  knowledgeGraph,
  cacheUpdatedAt = null,
  cacheStale = false,
}: ReportPanelProps) {
  const [recommendations, setRecommendations] = useState<{ author: Source[]; topics: Source[] }>({ author: [], topics: [] });
  const [showDiagnosticsDetail, setShowDiagnosticsDetail] = useState(false);
  const grouped = groupByType(report.references);
  const excludedSet = new Set(excludedHistoryIds);

  const diagList = diagnostics ? Object.values(diagnostics) : [];
  const degradedDiags = diagList.filter(d => !d.success || d.reason !== 'ok');

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
    <div className="flex min-w-0 flex-1 flex-col overflow-y-auto border-r border-line bg-surface p-4 sm:p-6 space-y-6">
      <main className="min-w-0 flex-1 space-y-6">
        {/* Source state badge & diagnostics pill */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          {overallState && (
            <div className="flex items-center gap-2">
              <span
                data-testid="report-source-state"
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono font-medium border ${SOURCE_STATE_COLORS[overallState].bg} ${SOURCE_STATE_COLORS[overallState].text} ${SOURCE_STATE_COLORS[overallState].border}`}
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

          {degradedDiags.length > 0 && (
            <button
              type="button"
              onClick={() => setShowDiagnosticsDetail(prev => !prev)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 hover:bg-amber-500/20 transition-colors cursor-pointer"
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>服务诊断 ({degradedDiags.length} 项降级)</span>
              {showDiagnosticsDetail ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          )}
        </div>

        {/* Degradation Diagnostics Box */}
        {(degradedDiags.length > 0 || (degraded && degradationMessage)) && (
          <div className="p-3.5 bg-amber-500/10 border border-amber-500/20 rounded-xl space-y-2 text-xs">
            <div className="flex items-start gap-2 text-amber-700 dark:text-amber-400 font-medium">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="space-y-1 min-w-0 flex-1">
                <p className="font-semibold">接口状态与降级说明</p>
                <p className="text-content-secondary leading-relaxed">
                  {degradationMessage || '部分检索或AI服务触发限制，系统已自动通过内置知识库与备用策略生成完整研报。'}
                </p>
              </div>
            </div>

            {(showDiagnosticsDetail || degradedDiags.length > 0) && (
              <div className="pt-2 border-t border-amber-500/20 space-y-1.5">
                {degradedDiags.map((d, i) => (
                  <div key={i} className="flex items-start justify-between gap-2 p-2 bg-surface rounded-lg border border-line text-[11px]">
                    <div className="space-y-0.5">
                      <span className="font-semibold text-content-primary">{d.serviceName}</span>
                      <p className="text-content-secondary">{d.message}</p>
                      {d.detail && <p className="text-[10px] text-content-tertiary font-mono">{d.detail}</p>}
                    </div>
                    <span
                      className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-mono font-medium ${
                        d.reason === 'daily_quota'
                          ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                          : d.reason === 'rate_limit'
                          ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                          : 'bg-surface-subtle text-content-secondary'
                      }`}
                    >
                      {d.reasonLabel}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Regenerate button */}
        {onRegenerate && excludedHistoryIds.length > 0 && (
          <div>
            <button
              id="regenerate-report-btn"
              data-testid="regenerate-report-button"
              onClick={onRegenerate}
              className="inline-flex items-center gap-2 px-3.5 py-2 bg-brand hover:bg-brand-hover text-content-inverse text-xs font-medium rounded-xl shadow-xs transition-all"
            >
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              重新生成报告（已排除 {excludedHistoryIds.length} 条历史材料）
            </button>
          </div>
        )}

        {/* Title & Subtitle Header */}
        <div className="space-y-2 pb-2 border-b border-line">
          {report.subtitle && (
            <div className="flex flex-wrap items-center gap-2">
              <span
                data-testid="report-subtitle-badge"
                className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-semibold bg-brand-light text-brand border border-brand-subtle"
              >
                <Bookmark className="w-3 h-3 text-accent" />
                {report.subtitle}
              </span>
              {report.originalQuestion && report.originalQuestion !== report.question && (
                <span className="text-xs text-content-tertiary line-clamp-1">
                  原议题：{report.originalQuestion}
                </span>
              )}
            </div>
          )}
          <h2 className="text-xl sm:text-2xl font-bold text-content-primary leading-snug font-serif">
            {report.title}
          </h2>
        </div>

        {/* 核心观点 */}
        {report.synthesis && report.synthesis.viewpoints.length > 0 ? (
          <div className="bg-surface-elevated rounded-2xl border border-line p-5 sm:p-6 shadow-xs space-y-4" data-testid="report-synthesis">
            <h3 className="font-bold text-sm sm:text-base text-brand font-serif flex items-center gap-2 pb-2 border-b border-line" data-testid="report-viewpoints-heading">
              <Sparkles className="w-4 h-4 text-accent" />
              <span>核心观点提炼</span>
            </h3>
            <ol className="space-y-4" data-testid="report-viewpoints">
              {report.synthesis.viewpoints.map((viewpoint, index) => (
                <li key={viewpoint.id} data-testid="report-viewpoint" className="border-b border-line pb-4 last:border-b-0 last:pb-0">
                  <p className="font-semibold text-xs sm:text-sm text-content-primary mb-2.5 leading-relaxed" data-testid="report-viewpoint-conclusion">
                    <span className="font-mono text-accent mr-1">[{index + 1}]</span>
                    {viewpoint.conclusion}
                  </p>
                  {viewpoint.evidence.length > 0 && (
                    <div className="ml-1 pl-3 border-l-2 border-accent/40 bg-surface-subtle/40 p-3 rounded-r-xl" data-testid="report-viewpoint-evidence">
                      <h4 className="font-semibold text-[11px] mb-1.5 text-content-secondary uppercase tracking-wider flex items-center gap-1">
                        <BookOpen className="w-3 h-3 text-accent" />
                        <span>论据出处与摘要</span>
                      </h4>
                      <ul className="list-disc list-inside space-y-1.5 text-xs text-content-secondary leading-relaxed">
                        {viewpoint.evidence.map((item, itemIndex) => (
                          <li key={itemIndex}>
                            {renderInlineCitations(
                              `${item.summary} ${item.citationIds.map((id) => `[${id}]`).join('')}`,
                              report.references,
                              new Set(
                                report.references
                                  .map((source, idx) => {
                                    const state = source.type === 'zhihu' ? zhihuSourceState : webSourceState;
                                    return isUsableExternalUrl(source, state) ? idx + 1 : null;
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
            className="bg-surface-elevated rounded-2xl border border-line p-5 text-xs text-content-secondary shadow-xs"
            data-testid="report-synthesis-legacy"
          >
            当前未能生成 AI 综合观点；材料仍保留在下方引用来源中。请在 AI 服务可用后重新生成报告。
          </div>
        )}

        {/* 1. 知识图谱 */}
        <KnowledgeGraphView
          graph={knowledgeGraph ?? null}
          onCitationClick={(citationId) => {
            const el = document.getElementById(`source-citation-${citationId}`);
            if (el) {
              el.scrollIntoView({ behavior: 'smooth', block: 'center' });
              el.classList.add('ring-2', 'ring-accent');
              setTimeout(() => el.classList.remove('ring-2', 'ring-accent'), 2000);
            }
          }}
        />

        {/* 2. 引用来源 */}
        <section className="rounded-2xl border border-line bg-surface-elevated p-5 shadow-xs" data-testid="references-sidebar">
          <div className="flex items-center justify-between mb-4 pb-2 border-b border-line">
            <h3 className="text-sm sm:text-base font-bold text-brand font-serif flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-accent" />
              <span>引用来源 ({report.references.length})</span>
            </h3>
            <span className="text-[11px] text-content-tertiary">研报支撑材料明细与出处</span>
          </div>

          {report.references.length > 0 ? (
            <div className="space-y-4">
              {Object.entries(grouped).map(([type, sources]) => {
                if (sources.length === 0) return null;

                // personal_history
                if (type === 'personal_history') {
                  return (
                    <div key={type} className="border-t border-line pt-3 first:border-t-0 first:pt-0">
                      <h4 className="text-[11px] font-semibold text-content-secondary mb-2.5 uppercase tracking-wider">
                        本报告引用 {sources.length} 条个人历史
                      </h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                        {sources.map((src) => {
                          const globalIndex = report.references.indexOf(src) + 1;
                          const isExcluded = src.sourceSessionId
                            ? excludedSet.has(src.sourceSessionId)
                            : false;

                          return (
                            <div
                              key={src.id}
                              id={`source-citation-${globalIndex}`}
                              className={`border border-line rounded-xl p-3 text-xs bg-surface transition-all ${isExcluded ? 'opacity-50' : 'hover:bg-surface-subtle'}`}
                            >
                              <div className="flex items-start gap-2.5">
                                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-brand text-content-inverse text-[10px] font-mono font-bold shrink-0 mt-0.5">
                                  {globalIndex}
                                </span>
                                <div className="flex-1 min-w-0">
                                  <span className="text-content-primary font-medium line-clamp-1">
                                    {src.title ?? '个人历史报告'}
                                  </span>
                                  <div className="text-content-tertiary text-[11px] mt-1">
                                    {isExcluded
                                      ? '来源链接：未选择'
                                      : `来源链接：个人历史报告（${src.provenance ?? '个人上下文'}）`}
                                  </div>
                                  {onHistorySourceToggle && src.sourceSessionId && (
                                    <div className="mt-2 flex items-center gap-2">
                                      <input
                                        type="checkbox"
                                        id={`history-toggle-${src.sourceSessionId}`}
                                        data-testid="history-source-checkbox"
                                        checked={!isExcluded}
                                        onChange={(e) =>
                                          onHistorySourceToggle(src.sourceSessionId!, e.target.checked)
                                        }
                                        className="w-3.5 h-3.5 rounded border-line text-brand focus:ring-brand accent-brand"
                                      />
                                      <label
                                        htmlFor={`history-toggle-${src.sourceSessionId}`}
                                        className="text-[11px] text-content-secondary cursor-pointer select-none"
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
                  <div key={type} className="border-t border-line pt-3 first:border-t-0 first:pt-0">
                    <h4 className="text-[11px] font-semibold text-content-secondary mb-2.5 uppercase tracking-wider">
                      {TYPE_LABELS[type] ?? type}（{sources.length}）
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                      {sources.map((src) => {
                        const globalIndex = report.references.indexOf(src) + 1;
                        const sourceState = src.type === 'zhihu' ? zhihuSourceState : webSourceState;
                        const url = isUsableExternalUrl(src, sourceState) ? src.url!.trim() : null;

                        return (
                          <div
                            key={src.id}
                            id={`source-citation-${globalIndex}`}
                            className="border border-line rounded-xl p-3 text-xs bg-surface transition-all hover:bg-surface-subtle"
                          >
                            <div className="flex items-start gap-2.5">
                              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-brand text-content-inverse text-[10px] font-mono font-bold shrink-0 mt-0.5">
                                {globalIndex}
                              </span>
                              <div className="flex-1 min-w-0">
                                <div className="text-content-primary text-xs font-medium">
                                  <span>{src.author ?? '未知作者'}</span>
                                  {src.title && (
                                    <>
                                      <span className="text-content-tertiary mx-1">/</span>
                                      <span className="text-content-primary font-semibold line-clamp-1 inline">
                                        {src.title}
                                      </span>
                                    </>
                                  )}
                                </div>
                                {src.excerpt && (
                                  <p className="text-[11px] text-content-secondary mt-1 line-clamp-2 leading-relaxed">
                                    {src.excerpt}
                                  </p>
                                )}
                                {url ? (
                                  <div className="mt-1.5">
                                    <a
                                      href={url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-accent hover:underline text-[11px] inline-flex items-center gap-1 break-all"
                                    >
                                      <span>查看原始出处</span>
                                      <ExternalLink className="w-3 h-3" />
                                    </a>
                                  </div>
                                ) : (
                                  <div className="text-content-tertiary text-[10px] mt-1 font-mono">
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
            <p className="text-xs italic text-content-tertiary py-2">暂无任何引用材料</p>
          )}
        </section>

        {/* 3. 相关推荐 */}
        {(recommendations.author.length > 0 || recommendations.topics.length > 0) && (
          <section className="rounded-2xl border border-line bg-surface-elevated p-5 shadow-xs" data-testid="recommendations-sidebar">
            <div className="flex items-center justify-between mb-4 pb-2 border-b border-line">
              <h3 className="text-sm sm:text-base font-bold text-brand font-serif flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-accent" />
                <span>相关推荐与拓展阅读</span>
              </h3>
              <span className="text-[11px] text-content-tertiary">同作者与关联话题推荐</span>
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
  return (
    <section>
      <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-content-secondary">
        {title}
      </h4>
      <div className="space-y-2">
        {sources.map((source) => (
          <a
            key={source.id}
            href={source.url!}
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded-xl border border-line bg-surface p-3 hover:border-line-strong hover:bg-surface-subtle transition-colors"
          >
            <span className="block text-xs font-medium text-content-primary">
              {source.title ?? source.excerpt ?? '知乎内容'}
            </span>
            <span className="mt-1 block break-all text-[10px] text-accent font-mono">
              {source.url}
            </span>
          </a>
        ))}
      </div>
    </section>
  );
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
            className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-brand-light text-brand border border-brand-subtle text-[10px] font-mono font-bold ml-0.5 hover:bg-brand hover:text-content-inverse transition-colors"
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
          className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-brand-light text-brand border border-brand-subtle text-[10px] font-mono font-bold ml-0.5 cursor-default"
          title={`引用 #${n}`}
        >
          {n}
        </sup>
      );
    }
    return <span key={i}>{part}</span>;
  });
}
