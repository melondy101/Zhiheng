'use client';

import type { Message } from '@/lib/providers';
import type { StrategyId } from '@/lib/strategy-engine';

interface QAPanelProps {
  messages: Message[];
  currentQuestion: string | null;
  currentStrategy?: StrategyId | null;
  currentRound?: number;
  isCheckpoint?: boolean;
  answer: string;
  onAnswerChange: (text: string) => void;
  onSubmit: (e: React.FormEvent) => void;
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
  answer,
  onAnswerChange,
  onSubmit,
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
            </div>
          )}

          {isCheckpoint && (
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 text-sm">
              <p className="font-medium text-purple-700 mb-1">检查点</p>
              <p className="text-gray-600">
                阶段性小结。是否继续下一阶段？选择"结束"将生成成果卡。
              </p>
            </div>
          )}
        </div>
      )}

      {!currentQuestion && messages.length === 0 && (
        <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
          选择观点后开始思辨
        </div>
      )}

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
    </div>
  );
}
