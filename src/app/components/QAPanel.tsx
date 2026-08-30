'use client';

import type { Message } from '@/lib/providers';

interface QAPanelProps {
  messages: Message[];
  currentQuestion: string | null;
  answer: string;
  onAnswerChange: (text: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
}

export default function QAPanel({
  messages,
  currentQuestion,
  answer,
  onAnswerChange,
  onSubmit,
  messagesEndRef,
}: QAPanelProps) {
  return (
    <div className="w-[450px] flex flex-col bg-white">
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
