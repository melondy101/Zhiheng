'use client';

import type { Report as ReportType, Source, SourceState } from '@/lib/providers';
import type { KnowledgeGraph } from '@/lib/knowledge-graph';
import KnowledgeGraphView from './KnowledgeGraphView';

interface ReportPanelProps {
  report: ReportType;
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
};

const SOURCE_STATE_COLORS: Record<SourceState, { bg: string; text: string; dot: string }> = {
  live: { bg: 'bg-green-100', text: 'text-green-700', dot: 'bg-green-500' },
  cache: { bg: 'bg-yellow-100', text: 'text-yellow-700', dot: 'bg-yellow-500' },
  demo: { bg: 'bg-gray-100', text: 'text-gray-600', dot: 'bg-gray-400' },
};

/** Group sources by type for display. */
function groupByType(sources: Source[]): Record<string, Source[]> {
  const groups: Record<string, Source[]> = {
    zhihu: [],
    web: [],
    personal_history: [],
    ai_synthesis: [],
  };
  for (const s of sources) {
    if (groups[s.type]) {
      groups[s.type].push(s);
    }
  }
  return groups;
}

const TYPE_LABELS: Record<string, string> = {
  zhihu: '知乎来源',
  web: '全网来源',
  personal_history: '我的历史报告',
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
  const grouped = groupByType(report.references);
  const excludedSet = new Set(excludedHistoryIds);

  // Determine overall worst-case source state for badge display
  const overallState: SourceState | null =
    webSourceState === 'demo' || zhihuSourceState === 'demo'
      ? 'demo'
      : webSourceState === 'cache' || zhihuSourceState === 'cache'
      ? 'cache'
      : webSourceState === 'live' || zhihuSourceState === 'live'
      ? 'live'
      : null;

  return (
    <div className="flex-1 overflow-y-auto p-6 border-r">
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
                            `${item.summary} ${item.citationIds.map((id) => `[${id}]`).join('')}`
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

      {/* Knowledge Graph */}
      <KnowledgeGraphView graph={knowledgeGraph ?? null} />

      {/* References section */}
      {report.references.length > 0 && (
        <div className="bg-white rounded-lg border p-6">
          <h3 className="font-semibold mb-4 text-blue-600">引用来源</h3>

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
                          className={`border rounded-md p-3 text-sm bg-gray-50 ${isExcluded ? 'opacity-50' : ''}`}
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
                              {src.excerpt && (
                                <p className="text-gray-600 text-xs mt-1 italic">
                                  {src.excerpt}
                                </p>
                              )}
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
                    const url = src.url?.trim() || null;

                    return (
                      <div
                        key={src.id}
                        className="border rounded-md p-3 text-sm bg-gray-50"
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
                              <div className="text-gray-400 text-xs mt-1">来源链接：未知</div>
                            )}
                            {src.excerpt && (
                              <p className="text-gray-600 text-xs mt-1 italic">
                                {src.excerpt}
                              </p>
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
      )}

      {/* #23: explicit empty state when there are no references at all */}
      {report.references.length === 0 && (
        <div className="bg-white rounded-lg border p-6">
          <h3 className="font-semibold mb-4 text-blue-600">引用来源</h3>
          <p className="text-sm text-gray-400 italic">暂无任何引用材料</p>
        </div>
      )}
    </div>
  );
}

/** Render inline text, converting [N] citation markers to styled superscript badges. */
function renderInlineCitations(text: string): React.ReactNode {
  const parts = text.split(/(\[\d+\])/g);
  return parts.map((part, i) => {
    const match = part.match(/^\[(\d+)\]$/);
    if (match) {
      const n = parseInt(match[1], 10);
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
