'use client';

import type { Report as ReportType, Source, SourceState } from '@/lib/providers';

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
    ai_synthesis: [],
    personal_history: [],
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
  web: '外部资料',
  ai_synthesis: 'AI 综合归纳',
  personal_history: '个人历史报告',
};

export default function ReportPanel({
  report,
  zhihuSourceState,
  webSourceState,
  degraded,
  degradationMessage,
  excludedHistoryIds = [],
  onHistorySourceToggle,
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
      {/* Source state badge */}
      {overallState && (
        <div className="mb-4">
          <span
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${SOURCE_STATE_COLORS[overallState].bg} ${SOURCE_STATE_COLORS[overallState].text}`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${SOURCE_STATE_COLORS[overallState].dot}`}
            />
            {SOURCE_STATE_LABELS[overallState]}
          </span>
        </div>
      )}

      {/* Degradation warning */}
      {degraded && degradationMessage && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 text-xs">
          {degradationMessage}
        </div>
      )}

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
        <div className="text-sm leading-relaxed">
          {report.content.split('\n').map((line, i) => {
            if (line.startsWith('## ')) {
              return (
                <h4 key={i} className="font-semibold text-base mt-4 mb-2 text-gray-800">
                  {line.slice(3)}
                </h4>
              );
            }
            if (line === '') return <br key={i} />;
            if (/^\d+\./.test(line.trim())) {
              return (
                <p key={i} className="ml-4 mb-1">
                  {renderInlineCitations(line)}
                </p>
              );
            }
            if (line.trim().startsWith('- ')) {
              return (
                <p key={i} className="ml-4 mb-1">
                  {renderInlineCitations(line.trim().slice(2))}
                </p>
              );
            }
            return (
              <p key={i} className="mb-2">
                {renderInlineCitations(line)}
              </p>
            );
          })}
        </div>
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

      {/* References section */}
      {report.references.length > 0 && (
        <div className="bg-white rounded-lg border p-6">
          <h3 className="font-semibold mb-4 text-blue-600">引用来源</h3>

          {Object.entries(grouped).map(([type, sources]) => {
            if (sources.length === 0) return null;
            return (
              <div key={type} className="mb-5 last:mb-0">
                <h4 className="text-sm font-medium text-gray-500 mb-2 uppercase tracking-wide">
                  {TYPE_LABELS[type] ?? type}
                </h4>
                <div className="space-y-3">
                  {sources.map((src) => {
                    const globalIndex = report.references.indexOf(src) + 1;
                    const isHistory = src.type === 'personal_history';
                    const isExcluded = isHistory && src.sourceSessionId ? excludedSet.has(src.sourceSessionId) : false;

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
                            {src.url ? (
                              <div className="mt-1">
                                <a
                                  href={src.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-blue-600 hover:underline text-xs break-all"
                                >
                                  {src.url}
                                </a>
                              </div>
                            ) : isHistory ? (
                              <div className="text-gray-400 text-xs mt-1">
                                {isExcluded ? '来源链接：未选择' : `来源链接：个人历史报告（${src.provenance ?? '个人上下文'}）`}
                              </div>
                            ) : (
                              <div className="text-gray-400 text-xs mt-1">
                                来源链接：未知
                              </div>
                            )}
                            {src.excerpt && (
                              <p className="text-gray-600 text-xs mt-1 italic">
                                {src.excerpt}
                              </p>
                            )}
                            {isHistory && onHistorySourceToggle && src.sourceSessionId && (
                              <div className="mt-2 flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  id={`history-toggle-${src.sourceSessionId}`}
                                  checked={!isExcluded}
                                  onChange={(e) => onHistorySourceToggle(src.sourceSessionId!, e.target.checked)}
                                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                />
                                <label
                                  htmlFor={`history-toggle-${src.sourceSessionId}`}
                                  className="text-xs text-gray-600 cursor-pointer"
                                >
                                  {isExcluded ? '未选择' : '已选择'}（点击{isExcluded ? '重新选择' : '取消选择'}）
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
          })}
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
