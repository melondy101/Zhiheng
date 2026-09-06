'use client';

import { useEffect, useRef } from 'react';

import type { CitedSource, Message, Session } from '@/lib/providers';
import { isRoundAnswer } from '@/lib/providers';
import type { FeedbackCueState } from './SessionFeedbackCue';
import type { StrategyId } from '@/lib/strategy-engine';
import { TRANSITION_ACTIONS, type TransitionActionId } from '@/lib/mode-config';
import SessionFeedbackCue from './SessionFeedbackCue';
import StoryView from './StoryView';
import CognitiveTrajectoryView from './CognitiveTrajectoryView';

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
  /** #26/T3: retry a failed optimistic user message. */
  onRetryMessage?: (msgId: string) => void;
  onExit?: () => void;
  /** #5: dismiss the summary gate suggestion (non-blocking). */
  onSummaryContinue?: () => void;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  /** #26/T3: true while an answer is being sent (form visually disabled). */
  formLoading?: boolean;
  /** #26/T3: inline 刘看山 feedback cue state derived from page state. */
  feedbackCueState?: FeedbackCueState | null;
  /** #26/T5: AI direct answer text for the most recent user input. */
  aiReply?: string | null;
  /** #26/T5: follow-up question or gentle encouragement text. */
  followUp?: string | null;
  /** #26/T5: number of completed directive (strategy-directed) rounds. */
  directiveRound?: number;
  /** #26/T5: true when the summary gate should be shown (after every 3rd directive round). */
  suggestSummary?: boolean;
  /** Session object for mode, phase, character, storyRun (#M1) */
  session?: Session | null;
  onTransitionChoice?: (choice: TransitionActionId) => void;
  onStoryChoice?: (choiceId: string, optionId: string) => void;
  onStoryEndEarly?: () => void;
  onStoryComplete?: () => void;
  onStoryBridge?: () => void;
}

const STRATEGY_LABELS: Record<StrategyId, string> = {
  M1_evidence: '证据追问',
  M2_premise: '前提追问',
  M3_anchoring: '锚定揭露',
  M4_steelman: '钢铁人反驳',
  M5_system2: '系统二激活',
  M6_reversal: '立场反转',
  M7_metacognition: '元认知追问',
  M8_contradiction: '立场崩塌检测',
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
  onRetryMessage,
  onExit,
  onSummaryContinue,
  messagesEndRef,
  formLoading = false,
  feedbackCueState = null,
  aiReply,
  followUp,
  directiveRound = 0,
  suggestSummary = false,
  session = null,
  onTransitionChoice,
  onStoryChoice,
  onStoryEndEarly,
  onStoryComplete,
  onStoryBridge,
}: QAPanelProps) {
  const scrollTargetRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to the end when new messages arrive.
  useEffect(() => {
    if (scrollTargetRef.current) {
      scrollTargetRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length]);

  // GalGame Interactive Story Mode (#G-05)
  if (session?.mode === 'story' && session?.storyRun) {
    return (
      <StoryView
        storyRun={session.storyRun}
        sources={sources}
        onChoice={onStoryChoice ?? (() => {})}
        onComplete={onStoryComplete ?? (() => {})}
        onEndEarly={onStoryEndEarly ?? (() => {})}
        onBridge={onStoryBridge ?? (() => {})}
      />
    );
  }

  const lastAssistantIndex = messages.map((m) => m.role).lastIndexOf('assistant');

  return (
    <div className="flex-1 min-w-0 flex flex-col bg-white h-full" data-testid="qa-panel">
      <div className="px-5 py-3 border-b flex items-center justify-between bg-gray-50/70">
        <span className="text-xs text-gray-600 font-medium flex items-center">
          第 {currentRound || messages.filter(isRoundAnswer).length + 1} 轮
          {currentStrategy && (
            <span className="ml-2 px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-[11px] font-normal">
              {STRATEGY_LABELS[currentStrategy]}
            </span>
          )}
          {session?.character && (
            <span className="ml-2 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-normal">
              {session.character === 'relaxed_friend'
                ? '辩友：轻松朋友'
                : session.character === 'ancient_scholar'
                ? '辩友：古风辩友'
                : '辩友：二次元搭档'}
            </span>
          )}
        </span>
        {onExit && (
          <button
            type="button"
            onClick={onExit}
            className="text-xs px-2.5 py-1 rounded border border-gray-200 text-gray-600 hover:text-blue-600 hover:border-blue-300 hover:bg-white transition-colors font-medium shadow-xs"
          >
            结束本次思辨
          </button>
        )}
      </div>

      {/* Cognitive Trajectory compact view in deep mode (#D-03) */}
      {session?.cognitiveTrajectory && session.cognitiveTrajectory.length > 0 && (
        <div className="px-5 py-2.5 bg-indigo-50/40 border-b border-indigo-100/60">
          <CognitiveTrajectoryView events={session.cognitiveTrajectory} compact />
        </div>
      )}

      {/* Orientation phase guidance banner (#Q-01, #Q-02) */}
      {session?.phase === 'orientation' && (
        <div className="px-5 py-2.5 bg-blue-50/70 border-b border-blue-100 flex flex-wrap items-center justify-between gap-2 text-xs text-blue-900">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-blue-700">🎯 定向引导阶段</span>
            <span className="text-gray-400">·</span>
            <span className="text-gray-600">
              {session.target === 'clarify_position'
                ? '目标：厘清核心立场与事实依据'
                : session.target === 'weigh_decision'
                ? '目标：权衡决策代价与对立观点'
                : session.target === 'refine_expression'
                ? '目标：打磨论据与表达自洽性'
                : '目标：梳理报告核心脉络'}
            </span>
          </div>
          {onTransitionChoice && (
            <button
              type="button"
              onClick={() => onTransitionChoice('challenge_claim')}
              className="text-xs text-blue-600 hover:text-blue-800 hover:underline font-medium cursor-pointer flex items-center gap-1"
            >
              <span>直接开启深度挑战</span>
              <span>&rarr;</span>
            </button>
          )}
        </div>
      )}

      {/* The question area also renders before the first answer (#16): the
          round 1 question quotes the selected stance and carries the report
          sources, so it must be visible while messages is still empty. */}
      {(messages.length > 0 || currentQuestion || session?.phase === 'transitionChoice' || formLoading) && (
        <div className="flex-1 overflow-y-auto p-6" ref={messagesEndRef}>
          {/* Initial question pending / in flight */}
          {messages.length === 0 && !currentQuestion && formLoading && session?.phase !== 'transitionChoice' && (
            <div className="bg-blue-50/60 border border-blue-100/80 rounded-xl p-4 mb-4">
              <p className="text-xs text-blue-700 font-semibold mb-1">知研正在构思第 1 轮引导问题...</p>
              <div className="animate-pulse space-y-2 mt-2">
                <div className="h-3.5 bg-blue-200/60 rounded w-3/4"></div>
                <div className="h-3.5 bg-blue-200/40 rounded w-1/2"></div>
              </div>
            </div>
          )}
          {/* Transition Choice Card (#Q-02) */}
          {session?.phase === 'transitionChoice' && (
            <div
              data-testid="transition-choice-card"
              className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-5 mb-5 space-y-3"
            >
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-blue-900">报告梳理已就绪，请选择下一步行动</h4>
                <span className="text-[10px] text-blue-700 bg-blue-100/80 px-2 py-0.5 rounded font-medium">
                  定向过渡
                </span>
              </div>
              <p className="text-xs text-gray-600">
                你已完成初步梳理。知研推荐直接开启深度逻辑挑战；也可以先检验关键证据或最强反方。
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                {TRANSITION_ACTIONS.map((act) => (
                  <button
                    key={act.id}
                    type="button"
                    onClick={() => onTransitionChoice?.(act.id)}
                    className="p-3 bg-white border border-blue-100 hover:border-blue-400 hover:shadow-xs rounded-lg text-left transition-all group"
                  >
                    <div className="text-xs font-semibold text-gray-900 group-hover:text-blue-700 flex items-center justify-between">
                      {act.label}
                      {act.recommended && (
                        <span className="text-[9px] bg-blue-600 text-white px-1.5 py-0.5 rounded">
                          推荐
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-gray-500 mt-1">{act.description}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Initial question before any user answers have been sent */}
          {messages.length === 0 && currentQuestion && (
            <div className="bg-blue-50/70 border border-blue-200/80 rounded-xl p-4 mb-4">
              <p className="text-xs text-blue-700 font-semibold mb-1">知研引导思考</p>
              <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
                {currentQuestion}
              </p>
              <SourcesSection sources={sources} />
              {usedFallback && (
                <p className="text-xs text-orange-600 mt-2">⚠️ AI 服务异常，已使用策略模板</p>
              )}
            </div>
          )}

          {/* Message history */}
          {messages.length > 0 && (
            <div className="space-y-4 mb-4">
              {messages.map((msg, idx) => {
                const isLastAssistant =
                  msg.role === 'assistant' && idx === lastAssistantIndex;
                return (
                  <div
                    key={msg.id}
                    className={`p-4 rounded-xl ${
                      msg.role === 'user'
                        ? 'bg-blue-600 text-white ml-8 rounded-br-xs'
                        : 'bg-gray-100 mr-8 text-gray-800 rounded-bl-xs'
                    } ${msg.status === 'pending' ? 'opacity-60' : ''} ${
                      msg.status === 'failed' ? 'border-2 border-red-400' : ''
                    }`}
                  >
                    <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.text}</p>
                    {msg.status === 'pending' && (
                      <p className="text-xs text-blue-200 mt-1">发送中...</p>
                    )}
                    {msg.status === 'failed' && onRetryMessage && (
                      <button
                        type="button"
                        onClick={() => onRetryMessage(msg.id)}
                        className="text-xs text-red-300 hover:text-red-100 underline mt-1"
                      >
                        点击重试
                      </button>
                    )}
                    {isLastAssistant && (
                      <div className="mt-2 pt-2 border-t border-gray-200/60">
                        <SourcesSection sources={sources} />
                        {usedFallback && (
                          <p className="text-xs text-orange-600 mt-2">
                            ⚠️ AI 服务异常，已使用策略模板
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* If there were only user messages and no assistant message yet, keep sources mounted */}
              {lastAssistantIndex === -1 && (
                <SourcesSection sources={sources} />
              )}

              {/* Inline feedback cue inside the message list */}
              {feedbackCueState && (
                <SessionFeedbackCue
                  state={feedbackCueState}
                  className="inline-flex text-left"
                />
              )}
              <div ref={scrollTargetRef} />
            </div>
          )}

          {/* #5: three-round summary gate */}
          {suggestSummary && (
            <div
              className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4"
              data-testid="summary-gate"
            >
              <p className="text-sm font-medium mb-2 text-green-700">
                你已经完成了 {directiveRound} 轮定向思考，要不要继续聊，还是就此生成总结？
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onContinue}
                  data-testid="summary-gate-continue"
                  className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs hover:bg-green-700"
                >
                  继续聊
                </button>
                <button
                  type="button"
                  onClick={onExit}
                  data-testid="summary-gate-complete"
                  className="px-3 py-1.5 border border-green-300 text-green-700 rounded-lg text-xs hover:bg-green-100"
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

      {/* No-messages window: show the cue before the first round (#48). */}
      {!messages.length && feedbackCueState && feedbackCueState !== 'retrieving' && (
        <SessionFeedbackCue state={feedbackCueState} className="m-3" />
      )}

      {!isCheckpoint && !pendingDecision && (
        <form onSubmit={onSubmit} className="p-4 border-t bg-white">
          <div className="flex gap-2">
            <input
              type="text"
              value={answer}
              onChange={(e) => onAnswerChange(e.target.value)}
              placeholder={formLoading ? '正在发送...' : '输入你的回答...'}
              disabled={formLoading}
              className="flex-1 p-2.5 border rounded-lg text-sm disabled:bg-gray-100 disabled:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="submit"
              disabled={!answer.trim() || formLoading}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed font-medium transition-colors"
            >
              {formLoading ? '发送中...' : '发送'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
