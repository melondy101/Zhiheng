'use client';

import { useEffect, useRef } from 'react';
import type { LLMFailureReason } from '@/lib/llm-fallback';

import type { CitedSource, Message, Session } from '@/lib/providers';
import { isRoundAnswer } from '@/lib/providers';
import type { FeedbackCueState } from './SessionFeedbackCue';
import type { StrategyId } from '@/lib/strategy-engine';
import { TRANSITION_ACTIONS, type TransitionActionId } from '@/lib/mode-config';
import SessionFeedbackCue from './SessionFeedbackCue';
import StoryView from './StoryView';
import CognitiveTrajectoryView from './CognitiveTrajectoryView';
import { Sparkles, Send, ArrowRight, AlertCircle, HelpCircle, Compass } from 'lucide-react';

function fallbackMessage(reason?: LLMFailureReason): string {
  if (reason === 'timeout') return 'AI 响应较慢，已使用策略模板';
  if (reason === 'network') return 'AI 连接失败，已使用策略模板';
  if (reason === 'http') return 'AI 服务暂时拒绝请求，已使用策略模板';
  if (reason === 'invalid_response' || reason === 'invalid_synthesis') return 'AI 返回内容未通过校验，已使用策略模板';
  return 'AI 服务异常，已使用策略模板';
}

interface QAPanelProps {
  messages: Message[];
  currentQuestion: string | null;
  currentStrategy?: StrategyId | null;
  currentRound?: number;
  isCheckpoint?: boolean;
  pendingDecision?: boolean;
  usedFallback?: boolean;
  fallbackReason?: LLMFailureReason;
  hintMessage?: string | null;
  hintOptions?: string[] | null;
  sources?: CitedSource[] | null;
  completeError?: string | null;
  answer: string;
  onAnswerChange: (text: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onContinue?: () => void;
  onDecisionContinue?: () => void;
  onRetryComplete?: () => void;
  onRetryMessage?: (msgId: string) => void;
  onExit?: () => void;
  onSummaryContinue?: () => void;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  formLoading?: boolean;
  feedbackCueState?: FeedbackCueState | null;
  aiReply?: string | null;
  followUp?: string | null;
  directiveRound?: number;
  suggestSummary?: boolean;
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

const SOURCE_TYPE_LABELS: Record<CitedSource['source']['type'], string> = {
  zhihu: '知乎',
  web: '全网',
  ai_synthesis: 'AI 综合分析',
  personal_history: '历史报告',
  knowledge_base: '内置知识库',
};

function SourcesSection({ sources }: { sources: CitedSource[] | null | undefined }) {
  if (!sources || sources.length === 0) {
    return (
      <div data-testid="qa-sources" className="mt-2.5">
        <p className="text-[11px] text-content-tertiary">本会话暂无可引用来源。</p>
      </div>
    );
  }
  return (
    <div data-testid="qa-sources" className="mt-2.5">
      <p className="text-[11px] text-content-tertiary font-medium">相关报告来源：</p>
      <ul className="mt-1 space-y-1">
        {sources.map(({ index, source }) => {
          const label = source.title ?? source.author ?? `来源 ${index}`;
          const url = source.url?.trim() || null;
          return (
            <li key={`${index}-${source.id}`} className="text-xs flex items-center gap-1.5 flex-wrap">
              {url ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent underline hover:text-accent-hover break-all"
                >
                  {label}
                </a>
              ) : (
                <span className="text-content-secondary">{label}</span>
              )}
              <span className="px-1.5 py-0.5 rounded bg-surface-subtle text-content-tertiary text-[10px] font-mono border border-line">
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
  fallbackReason,
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
  messagesEndRef,
  formLoading = false,
  feedbackCueState = null,
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

  useEffect(() => {
    if (scrollTargetRef.current) {
      scrollTargetRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length]);

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
    <div className="flex-1 min-w-0 flex flex-col bg-surface-elevated h-full" data-testid="qa-panel">
      {/* QA Header */}
      <div className="px-4 sm:px-6 py-2.5 border-b border-line flex items-center justify-between bg-surface/50">
        <span className="text-xs text-content-secondary font-medium flex items-center flex-wrap gap-1.5">
          <span className="font-mono font-semibold text-content-primary">
            第 {currentRound || messages.filter(isRoundAnswer).length + 1} 轮
          </span>
          {currentStrategy && (
            <span className="px-2 py-0.5 rounded-full bg-brand-light text-brand text-[11px] font-medium border border-brand-subtle">
              {STRATEGY_LABELS[currentStrategy]}
            </span>
          )}
          {session?.character && (
            <span className="px-2 py-0.5 rounded-full bg-surface-subtle text-content-primary text-[11px] font-medium border border-line">
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
            className="text-xs px-2.5 py-1 rounded-lg border border-line text-content-secondary hover:text-brand hover:border-line-strong hover:bg-surface-subtle transition-colors font-medium shadow-2xs"
          >
            结束本次思辨
          </button>
        )}
      </div>

      {/* Cognitive Trajectory compact view */}
      {session?.cognitiveTrajectory && session.cognitiveTrajectory.length > 0 && (
        <div className="px-4 sm:px-6 py-2 bg-surface-subtle/50 border-b border-line">
          <CognitiveTrajectoryView events={session.cognitiveTrajectory} compact />
        </div>
      )}

      {/* Orientation phase guidance banner */}
      {session?.phase === 'orientation' && (
        <div className="px-4 sm:px-6 py-2.5 bg-brand-light/60 border-b border-brand-subtle flex flex-wrap items-center justify-between gap-2 text-xs text-brand">
          <div className="flex items-center gap-1.5">
            <Compass className="w-3.5 h-3.5 text-accent shrink-0" />
            <span className="font-semibold">定向引导阶段</span>
            <span className="text-content-tertiary">·</span>
            <span className="text-content-secondary">
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
              className="text-xs text-accent hover:text-accent-hover hover:underline font-medium cursor-pointer flex items-center gap-1"
            >
              <span>直接开启深度挑战</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Messages / Discussion Body */}
      {(messages.length > 0 || currentQuestion || session?.phase === 'transitionChoice' || formLoading) && (
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4" ref={messagesEndRef}>
          {/* Initial question pending */}
          {messages.length === 0 && !currentQuestion && formLoading && session?.phase !== 'transitionChoice' && (
            <div className="bg-surface border border-line rounded-2xl p-5 mb-4 shadow-xs">
              <p className="text-xs text-accent font-semibold mb-1 flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5" />
                <span>知研正在构思第 1 轮引导问题...</span>
              </p>
              <div className="animate-pulse space-y-2 mt-3">
                <div className="h-3.5 bg-surface-subtle rounded w-3/4"></div>
                <div className="h-3.5 bg-surface-subtle rounded w-1/2"></div>
              </div>
            </div>
          )}

          {/* Transition Choice Card */}
          {session?.phase === 'transitionChoice' && (
            <div
              data-testid="transition-choice-card"
              className="bg-surface rounded-2xl border border-line p-5 mb-5 space-y-3 shadow-xs"
            >
              <div className="flex items-center justify-between pb-2 border-b border-line">
                <h4 className="text-xs sm:text-sm font-bold text-brand font-serif">报告梳理已就绪，请选择下一步行动</h4>
                <span className="text-[10px] text-accent bg-accent-light px-2 py-0.5 rounded font-medium border border-accent/20">
                  定向过渡
                </span>
              </div>
              <p className="text-xs text-content-secondary leading-relaxed">
                你已完成初步梳理。知研推荐直接开启深度逻辑挑战；也可以先检验关键证据或最强反方。
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                {TRANSITION_ACTIONS.map((act) => (
                  <button
                    key={act.id}
                    type="button"
                    onClick={() => onTransitionChoice?.(act.id)}
                    className="p-3 bg-surface-elevated border border-line hover:border-line-strong hover:bg-surface-subtle rounded-xl text-left transition-all group"
                  >
                    <div className="text-xs font-semibold text-content-primary group-hover:text-brand flex items-center justify-between">
                      {act.label}
                      {act.recommended && (
                        <span className="text-[9px] bg-brand text-content-inverse px-1.5 py-0.5 rounded">
                          推荐
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-content-secondary mt-1">{act.description}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Initial question */}
          {messages.length === 0 && currentQuestion && (
            <div className="bg-surface border border-line rounded-2xl p-5 shadow-xs">
              <p className="text-xs text-brand font-semibold mb-2 flex items-center gap-1">
                <span className="question-cursor" />
                <span>知研引导思考</span>
              </p>
              <p className="text-sm text-content-primary leading-relaxed whitespace-pre-wrap font-serif" data-testid="current-question">
                {currentQuestion}
              </p>
              <SourcesSection sources={sources} />
              {usedFallback && (
                <p className="text-xs text-semantic-warning mt-2 flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" />
                  <span>{fallbackMessage(fallbackReason)}</span>
                </p>
              )}
            </div>
          )}

          {/* Message history */}
          {messages.length > 0 && (
            <div className="space-y-4">
              {messages.map((msg, idx) => {
                const isLastAssistant = msg.role === 'assistant' && idx === lastAssistantIndex;
                return (
                  <div
                    key={msg.id}
                    data-testid="qa-message"
                    className={`p-4 rounded-2xl ${
                      msg.role === 'user'
                        ? 'bg-brand text-content-inverse ml-8 sm:ml-12 rounded-br-xs shadow-xs'
                        : 'bg-surface border border-line text-content-primary mr-8 sm:mr-12 rounded-bl-xs shadow-xs'
                    } ${msg.status === 'pending' ? 'opacity-60' : ''} ${
                      msg.status === 'failed' ? 'border-2 border-semantic-error' : ''
                    }`}
                  >
                    <p className="text-xs sm:text-sm whitespace-pre-wrap leading-relaxed">{msg.text}</p>
                    {msg.status === 'pending' && (
                      <p className="text-[11px] text-brand-light mt-1">发送中...</p>
                    )}
                    {msg.status === 'failed' && onRetryMessage && (
                      <button
                        type="button"
                        onClick={() => onRetryMessage(msg.id)}
                        className="text-xs text-semantic-error hover:underline mt-1 block"
                      >
                        点击重试
                      </button>
                    )}
                    {isLastAssistant && (
                      <div className="mt-2.5 pt-2.5 border-t border-line">
                        <SourcesSection sources={sources} />
                        {usedFallback && (
                          <p className="text-xs text-semantic-warning mt-2 flex items-center gap-1">
                            <AlertCircle className="w-3.5 h-3.5" />
                            <span>{fallbackMessage(fallbackReason)}</span>
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {lastAssistantIndex === -1 && (
                <SourcesSection sources={sources} />
              )}

              {feedbackCueState && (
                <SessionFeedbackCue
                  state={feedbackCueState}
                  className="inline-flex text-left my-2"
                />
              )}
              <div ref={scrollTargetRef} />
            </div>
          )}

          {/* Summary Gate */}
          {suggestSummary && (
            <div
              className="bg-semantic-success-light border border-semantic-success/30 rounded-2xl p-4 sm:p-5 shadow-xs"
              data-testid="summary-gate"
            >
              <p className="text-xs sm:text-sm font-medium mb-3 text-semantic-success leading-relaxed">
                你已经完成了 {directiveRound} 轮定向思考，要不要继续聊，还是就此生成总结？
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onContinue}
                  data-testid="summary-gate-continue"
                  className="px-3.5 py-1.5 bg-semantic-success text-white rounded-xl text-xs font-medium hover:opacity-90 shadow-2xs transition-opacity"
                >
                  继续聊
                </button>
                <button
                  type="button"
                  onClick={onExit}
                  data-testid="summary-gate-complete"
                  className="px-3.5 py-1.5 border border-semantic-success/40 text-semantic-success rounded-xl text-xs font-medium hover:bg-semantic-success/10 transition-colors"
                >
                  生成总结
                </button>
              </div>
            </div>
          )}

          {hintMessage && (
            <div className="bg-brand-light border border-brand-subtle rounded-2xl p-4 text-xs text-content-primary">
              <p className="font-medium flex items-center gap-1.5">
                <HelpCircle className="w-3.5 h-3.5 text-accent" />
                <span>{hintMessage}</span>
              </p>
              {hintOptions && (
                <ul className="mt-2 space-y-1 text-content-secondary pl-5 list-disc">
                  {hintOptions.map((h, i) => (
                    <li key={i}>{h}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {isCheckpoint && (
            <div className="bg-surface border border-line rounded-2xl p-5 text-xs text-content-primary shadow-xs" data-testid="checkpoint-gate">
              <p className="font-bold text-sm text-brand font-serif mb-1">阶段小结</p>
              <p className="text-content-secondary leading-relaxed">
                你已完成第 1–{currentRound} 轮诘问。是否继续下一阶段，还是就此结束？
              </p>
              {currentRound === 5 && (
                <p className="text-content-tertiary mt-1">
                  本阶段依次完成了：证据追问、前提追问、钢铁人反驳、立场反转、观点重述。
                </p>
              )}
              <div className="flex gap-2 mt-3.5">
                <button
                  type="button"
                  onClick={onContinue}
                  className="px-3.5 py-1.5 bg-brand text-content-inverse rounded-xl text-xs font-medium hover:bg-brand-hover shadow-2xs"
                >
                  继续
                </button>
                <button
                  type="button"
                  onClick={onExit}
                  className="px-3.5 py-1.5 border border-line text-content-primary rounded-xl text-xs font-medium hover:bg-surface-subtle"
                >
                  结束并生成成果卡
                </button>
              </div>
            </div>
          )}

          {pendingDecision && (
            <div
              data-testid="decision-gate"
              className="bg-surface border border-line rounded-2xl p-5 text-xs text-content-primary shadow-xs"
            >
              <p className="font-bold text-sm text-brand font-serif mb-1">是否结束本次思辨？</p>
              <p className="text-content-secondary leading-relaxed">
                你可以继续从其他角度讨论，也可以结束并生成成果卡。
              </p>
              <div className="flex gap-2 mt-3.5">
                <button
                  type="button"
                  onClick={onDecisionContinue}
                  className="px-3.5 py-1.5 bg-brand text-content-inverse rounded-xl text-xs font-medium hover:bg-brand-hover shadow-2xs"
                >
                  继续
                </button>
                <button
                  type="button"
                  onClick={onExit}
                  className="px-3.5 py-1.5 border border-line text-content-primary rounded-xl text-xs font-medium hover:bg-surface-subtle"
                >
                  结束并生成成果卡
                </button>
              </div>
            </div>
          )}

          {completeError && (
            <div
              data-testid="complete-error"
              className="bg-semantic-error-light border border-semantic-error/30 rounded-2xl p-4 text-xs text-semantic-error"
            >
              <p>{completeError}</p>
              {onRetryComplete && (
                <button
                  type="button"
                  onClick={onRetryComplete}
                  className="mt-2 px-3 py-1.5 bg-semantic-error text-white rounded-xl text-xs hover:opacity-90 font-medium"
                >
                  重试生成成果卡
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {!messages.length && feedbackCueState && feedbackCueState !== 'retrieving' && (
        <SessionFeedbackCue state={feedbackCueState} className="m-3" />
      )}

      {/* Input Form */}
      {!isCheckpoint && !pendingDecision && (
        <form onSubmit={onSubmit} className="p-3 sm:p-4 border-t border-line bg-surface-elevated">
          <div className="flex gap-2 items-center">
            <input
              type="text"
              value={answer}
              onChange={(e) => onAnswerChange(e.target.value)}
              placeholder={formLoading ? '正在发送...' : '输入你的观点或论述...'}
              disabled={formLoading}
              className="flex-1 px-3.5 py-2.5 border border-line bg-surface rounded-xl text-xs sm:text-sm text-content-primary placeholder:text-content-tertiary focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand disabled:opacity-50 transition-all leading-relaxed"
            />
            <button
              type="submit"
              data-testid="send-answer-button"
              disabled={!answer.trim() || formLoading}
              className="px-4 py-2.5 bg-brand hover:bg-brand-hover text-content-inverse rounded-xl text-xs sm:text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed shadow-xs transition-all flex items-center gap-1.5 shrink-0 active:scale-[0.98]"
            >
              {formLoading ? (
                <span>发送中...</span>
              ) : (
                <>
                  <span>发送</span>
                  <Send className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
