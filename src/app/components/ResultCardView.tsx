'use client';

import type { ResultCard as ResultCardType } from '@/lib/providers';

interface ResultCardViewProps {
  card: ResultCardType;
  onNewSession: () => void;
}

const SOURCE_LABELS: Record<string, string> = {
  user_authored: '用户原创',
  ai_suggested_and_selected: 'AI 建议（已选择）',
  ai_authored: 'AI 生成（未选择）',
};

function SourceLabel({ source }: { source: string }) {
  return (
    <span className="inline-block px-2 py-0.5 text-[10px] rounded bg-gray-100 text-gray-600 mt-1">
      {SOURCE_LABELS[source] ?? source}
    </span>
  );
}

export default function ResultCardView({ card, onNewSession }: ResultCardViewProps) {
  return (
    <div className="flex-1 overflow-y-auto p-6">
      <h3 className="text-xl font-bold text-blue-600 mb-4">思辨成果卡</h3>

      {card.initialStance && (
        <div className="mb-4">
          <h4 className="text-sm font-semibold text-gray-600 mb-1">最初立场</h4>
          <p className="text-sm bg-gray-50 p-3 rounded">{card.initialStance.text}</p>
          <SourceLabel source={card.initialStance.source} />
        </div>
      )}

      {card.selectedStartingStance && (
        <div className="mb-4">
          <h4 className="text-sm font-semibold text-gray-600 mb-1">选择的初始立场</h4>
          <p className="text-sm bg-blue-50 p-3 rounded">{card.selectedStartingStance.text}</p>
          <SourceLabel source={card.selectedStartingStance.source} />
        </div>
      )}

      <div className="mb-4">
        <h4 className="text-sm font-semibold text-gray-600 mb-1">最终观点</h4>
        <p className="text-sm bg-green-50 p-3 rounded">
          {card.finalPosition || '未形成明确最终观点'}
        </p>
      </div>

      <button
        onClick={onNewSession}
        className="w-full mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
      >
        开启新一轮思辨
      </button>
    </div>
  );
}
