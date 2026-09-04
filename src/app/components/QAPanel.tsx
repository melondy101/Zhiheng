'use client';

import type { CitedSource, Message } from '@/lib/providers';
import { isRoundAnswer } from '@/lib/providers';
import type { StrategyId } from '@/lib/strategy-engine';

interface QAPanelProps {
  messages: Message[];
  currentQuestion: string | null;
  currentStrategy?: StrategyId | null;
  currentRound?: number;
  /** True while the checkpoint decision (继续 / 结束) is pending (#14). */
  isCheckpoint?: boolean;
  /**
   * True while the explicit 继续/结束 decision after the third consecutive
   * uncertain answer is pending (#17). The answer form is hidden and the
   * user must choose — the session never auto-completes.
   */
  pendingDecision?: boolean;
  usedFallback?: boolean;
  hintMessage?: string | null;
  hintOptions?: string[] | null;
  /**
   * Report evidence for the current question (#16). Empty/null renders an
   * explicit no-source notice — never a fabricated link.
   */
  sources?: CitedSource[] | null;
  /** #17: visible when the completion API failed; offers a retry entry. */
  completeError?: string | null;
  answer: string;
  onAnswerChange: (text: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onContinue?: () => void;
  /** #17: continue from the uncertainty decision gate. */
  onDecisionContinue?: () => void;
  /** #17: retry the failed completion. */
  onRetryComplete?: () => void;
  onExit?: () => void;
  /** #5: dismiss the summary gate suggestion (non-blocking). */
  onSummaryContinue?: () => void;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  /** #5: AI direct answer to a user question. */
  aiReply?: string | null;
  /** #5: follow-up question, or null when summary gate is shown. */
  followUp?: string | null;
  /** #5: directive round counter (substantive responses). */
  directiveRound?: number;
  /** #5: true when the summary gate should be shown. */
  suggestSummary?: boolean;
}

const STRATEGY_LABELS: Record<StrategyId, string> = {
  M1_evidence: '证据追问',
  M2_premise: '前提追问',
  M4_steelman: '钢铁人反驳',
  M6_reversal: '立场反转',
  M5_restate: '观点重述',
};

/**
 * Honest type labels (#18): every rendered source shows its provenance, so an
 * `ai_synthesis` entry can never masquerade as an external fact link
 * (PRD 3.4: AI 综合分析不得伪装成事实引用).
 */
const SOURCE_TYPE_LABELS: Record<CitedSource['source']['type'], string> = {
  zhihu: '知乎',
  web: '全网',
  ai_synthesis: 'AI 综合分析',
  personal_history: '历史报告',
};

/**
 * Report evidence under the current question (#16). Sources are the exact
 * citation objects from the session report: a source without a URL renders
 * as plain text, never as a link with an invented href. When no usable
 * sources exist the panel says so explicitly.
 */
function SourcesSection({ sources }: { sources: CitedSource[] | null | undefined }) {
  if (!sources || sources.length === 0) {
    return (
      <div data-testid="qa-sources" className="mt-2">
        <p className="text-xs text-gray-500">本会话暂无可引用来源。</p>
      </div>
    );
  }
  return (
    <div data-testid="qa-sources" className="mt-2">
      <p className="text-xs text-gray-500">相关报告来源：</p>
      <ul className="mt-1 space-y-1">
        {sources.map(({ index, source }) => {
          const label = source.title ?? source.author ?? `来源 ${index}`;
          // #18: same trim rule as interrogation-context.ts — a
          // whitespace-only URL is not a usable link and renders as plain
          // text, never as a link.
          const url = source.url?.trim() || null;
          return (
            <li key={`${index}-${source.id}`} className="text-xs">
              {url ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 underline hover:text-blue-800"
                >
                  {label}
                </a>
              ) : (
                <span className="text-gray-600">{label}</span>
              )}
              <span className="ml-1.5 px-1 py-0.5 rounded bg-gray-100 text-gray-500">
                {SOURCE_TYPE_LABELS[source.type]}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function QAPanel({
  messages,
  currentQuestion,
  currentStrategy,
  currentRound = 0,
  isCheckpoint = false,
  pendingDecision = false,
  usedFallback = false,
  hintMessage,
  hintOptions,
  sources,
  completeError,
  answer,
  onAnswerChange,
  onSubmit,
  onContinue,
  onDecisionContinue,
  onRetryComplete,
  onExit,
  onSummaryContinue,
  messagesEndRef,
  aiReply,
  followUp,
  directiveRound = 0,
  suggestSummary = false,
}: QAPanelProps) {
  return (
    <div className="w-[450px] flex flex-col bg-white">
      <div className="px-4 py-2 border-b flex items-center justify-between bg-gray-50">
        <span className="text-xs text-gray-600">
          第 {currentRound || messages.filter(isRoundAnswer).length + 1} 轮
          {currentStrategy && (
            <span className="ml-2 px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">
              {STRATEGY_LABELS[currentStrategy]}
            </span>
          )}
        </span>
        {onExit && (
          <button
            onClick={onExit}
            className="text-xs text-red-500 hover:text-red-700"
          >
            结束本次思辨
          </button>
        )}
      </div>

      {/* The question area also renders before the first answer (#16): the
          round 1 question quotes the selected stance and carries the report
          sources, so it must be visible while messages is still empty. */}
      {(messages.length > 0 || currentQuestion) && (
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
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}

          {/* #5: AI direct answer — shown as a distinct assistant message when
              the user asked a question. */}
          {aiReply && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4 mr-8">
              <p className="text-xs text-green-600 mb-1 font-medium">AI 回答</p>
              <p className="text-sm text-gray-800">{aiReply}</p>
            </div>
          )}

          {(followUp || currentQuestion) && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
              <p className="text-sm font-medium mb-2">
                {followUp && !suggestSummary ? '追问:' : '当前问题:'}
              </p>
              <p className="text-sm">{followUp || currentQuestion}</p>
              <SourcesSection sources={sources} />
              {usedFallback && (
                <p className="text-xs text-orange-600 mt-2">⚠️ AI 服务异常，已使用策略模板</p>
              )}
            </div>
          )}

          {/* #5: three-round summary gate */}
          {suggestSummary && !isCheckpoint && !pendingDecision && (
            <div
              data-testid="summary-gate"
              className="bg-purple-50 border border-purple-200 rounded-lg p-4 text-sm mb-4"
            >
              <p className="font-medium text-purple-700 mb-1">阶段小结</p>
              <p className="text-gray-600">
                你已经完成了 {directiveRound} 轮定向思辨。可以选择继续深入讨论，也可以生成总结。
              </p>
              <div className="flex gap-2 mt-3">
                <button
                  type="button"
                  onClick={onSummaryContinue}
                  className="px-3 py-1.5 bg-purple-600 text-white rounded-lg text-xs hover:bg-purple-700"
                >
                  继续聊
                </button>
                <button
                  type="button"
                  onClick={onExit}
                  className="px-3 py-1.5 border border-purple-300 text-purple-700 rounded-lg text-xs hover:bg-purple-100"
                >
                  生成总结
                </button>
              </div>
            </div>
          )}

          {hintMessage && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
              <p className="text-sm">{hintMessage}</p>
              {hintOptions && (
                <ul className="mt-2 text-sm space-y-1">
                  {hintOptions.map((h, i) => (
                    <li key={i} className="text-gray-700">• {h}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {isCheckpoint && (
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 text-sm mb-4">
              <p className="font-medium text-purple-700 mb-1">阶段小结</p>
              <p className="text-gray-600">
                你已完成第 1–{currentRound} 轮诘问。是否继续下一阶段，还是就此结束？
              </p>
              {currentRound === 5 && (
                <p className="text-gray-600 mt-1">
                  本阶段依次完成了：证据追问、前提追问、钢铁人反驳、立场反转、观点重述。
                </p>
              )}
              <div className="flex gap-2 mt-3">
                <button
                  type="button"
                  onClick={onContinue}
                  className="px-3 py-1.5 bg-purple-600 text-white rounded-lg text-xs hover:bg-purple-700"
                >
                  继续
                </button>
                <button
                  type="button"
                  onClick={onExit}
                  className="px-3 py-1.5 border border-purple-300 text-purple-700 rounded-lg text-xs hover:bg-purple-100"
                >
                  结束并生成成果卡
                </button>
              </div>
            </div>
          )}

          {pendingDecision && (
            <div
              data-testid="decision-gate"
              className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm mb-4"
            >
              <p className="font-medium text-blue-700 mb-1">是否结束本次思辨？</p>
              <p className="text-gray-600">
                你可以继续从其他角度讨论，也可以结束并生成成果卡。
              </p>
              <div className="flex gap-2 mt-3">
                <button
                  type="button"
                  onClick={onDecisionContinue}
                  className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs hover:bg-blue-700"
                >
                  继续
                </button>
                <button
                  type="button"
                  onClick={onExit}
                  className="px-3 py-1.5 border border-blue-300 text-blue-700 rounded-lg text-xs hover:bg-blue-100"
                >
                  结束并生成成果卡
                </button>
              </div>
            </div>
          )}

          {completeError && (
            <div
              data-testid="complete-error"
              className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm mb-4"
            >
              <p className="text-red-600">{completeError}</p>
              {onRetryComplete && (
                <button
                  type="button"
                  onClick={onRetryComplete}
                  className="mt-2 px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs hover:bg-red-700"
                >
                  重试生成成果卡
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {!currentQuestion && messages.length === 0 && (
        <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
          选择观点后开始思辨
        </div>
      )}

      {!isCheckpoint && !pendingDecision && !suggestSummary && (
        <form onSubmit={onSubmit} className="p-4 border-t">
          <div className="flex gap-2">
            <input
              type="text"
              value={answer}
              onChange={(e) => onAnswerChange(e.target.value)}
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
    </div>
  );
}
