'use client';

import type { Message } from '@/lib/providers';
import type { StrategyId } from '@/lib/strategy-engine';

interface QAPanelProps {
  messages: Message[];
  currentQuestion: string | null;
  currentStrategy?: StrategyId | null;
  currentRound?: number;
  /** True while the checkpoint decision (继续 / 结束) is pending (#14). */
  isCheckpoint?: boolean;
  usedFallback?: boolean;
  hintMessage?: string | null;
  hintOptions?: string[] | null;
  answer: string;
  onAnswerChange: (text: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onContinue?: () => void;
  onExit?: () => void;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
}

const STRATEGY_LABELS: Record<StrategyId, string> = {
  M1_evidence: '证据追问',
  M2_premise: '前提追问',
  M4_steelman: '钢铁人反驳',
  M6_reversal: '立场反转',
  M5_restate: '观点重述',
};

export default function QAPanel({
  messages,
  currentQuestion,
  currentStrategy,
  currentRound = 0,
  isCheckpoint = false,
  usedFallback = false,
  hintMessage,
  hintOptions,
  answer,
  onAnswerChange,
  onSubmit,
  onContinue,
  onExit,
  messagesEndRef,
}: QAPanelProps) {
  return (
    <div className="w-[450px] flex flex-col bg-white">
      <div className="px-4 py-2 border-b flex items-center justify-between bg-gray-50">
        <span className="text-xs text-gray-600">
          第 {currentRound || messages.filter((m) => m.role === 'user').length + 1} 轮
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

      {messages.length > 0 && (
        <div className="flex-1 overflow-y-auto p-6">
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

          {currentQuestion && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
              <p className="text-sm font-medium mb-2">追问:</p>
              <p className="text-sm">{currentQuestion}</p>
              {usedFallback && (
                <p className="text-xs text-orange-600 mt-2">⚠️ AI 服务异常，已使用策略模板</p>
              )}
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
        </div>
      )}

      {!currentQuestion && messages.length === 0 && (
        <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
          选择观点后开始思辨
        </div>
      )}

      {!isCheckpoint && (
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
