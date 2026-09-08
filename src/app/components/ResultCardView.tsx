'use client';

import { buildDetailedResultCard, type DetailedResultCard } from '@/lib/result-card-builder';
import type { Session } from '@/lib/providers';
import CognitiveTrajectoryView from './CognitiveTrajectoryView';

interface ResultCardViewProps {
  card: DetailedResultCard;
  session?: Session;
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

function TraceLink({ id }: { id: string }) {
  return (
    <span className="text-[10px] text-gray-400 ml-1" title={`来源: ${id}`}>
      [{id.slice(0, 12)}]
    </span>
  );
}

export function ResultCardViewFromSession({ session, onNewSession }: {
  session: Session;
  onNewSession: () => void;
}) {
  const card = buildDetailedResultCard(session);
  return <ResultCardView card={card} session={session} onNewSession={onNewSession} />;
}

export default function ResultCardView({ card, session, onNewSession }: ResultCardViewProps) {
  const trajectory = session?.cognitiveTrajectory;
  const storyRun = session?.storyRun;

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">
      <h3 className="text-xl font-bold text-blue-600 mb-2">思辨成果卡</h3>

      {/* Cognitive Trajectory (#D-03) */}
      {trajectory && trajectory.length > 0 && (
        <section className="mb-4">
          <CognitiveTrajectoryView events={trajectory} />
        </section>
      )}

      {/* GalGame Story Outcome (#G-05) */}
      {storyRun && (
        <section className="mb-4 bg-purple-50/70 border border-purple-200 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-purple-900">推演剧本结局反思</h4>
            <span className="text-[10px] text-purple-700 bg-purple-100 px-2 py-0.5 rounded">
              Act {storyRun.currentActIndex + 1}
            </span>
          </div>
          {storyRun.outcomeNarrative && (
            <p className="text-xs text-gray-800 leading-relaxed font-serif">
              {storyRun.outcomeNarrative}
            </p>
          )}
          {storyRun.reflectionSummary && (
            <p className="text-xs text-purple-900 bg-white/80 p-3 rounded border border-purple-100 leading-relaxed">
              {storyRun.reflectionSummary}
            </p>
          )}
        </section>
      )}

      {card.initialExpression && (
        <section className="mb-4">
          <h4 className="text-sm font-semibold text-gray-600 mb-1">1. 初始表达</h4>
          <p className="text-sm bg-gray-50 p-3 rounded">
            {card.initialExpression.text}
            <TraceLink id={card.initialExpression.messageId} />
          </p>
          <SourceLabel source="user_authored" />
        </section>
      )}

      {card.startingStance && (
        <section className="mb-4">
          <h4 className="text-sm font-semibold text-gray-600 mb-1">2. 起始立场</h4>
          <p className="text-sm bg-blue-50 p-3 rounded">
            {card.startingStance.text}
            <TraceLink id={card.startingStance.messageId ?? ''} />
          </p>
          <SourceLabel source={card.startingStance.source} />
        </section>
      )}

      {card.newEvidence.length > 0 && (
        <section className="mb-4">
          <h4 className="text-sm font-semibold text-gray-600 mb-1">3. 新增证据</h4>
          <ul className="text-sm space-y-1">
            {card.newEvidence.map((ev) => (
              <li key={ev.messageId} className="bg-green-50 p-2 rounded">
                {ev.text}
                <TraceLink id={ev.messageId} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {card.stanceRevisions.length > 0 && (
        <section className="mb-4">
          <h4 className="text-sm font-semibold text-gray-600 mb-1">4. 观点修正</h4>
          <ul className="text-sm space-y-2">
            {card.stanceRevisions.map((rev, i) => (
              <li key={i} className="bg-yellow-50 p-2 rounded">
                <div className="text-gray-500 text-xs">从：</div>
                <div>{rev.from.text}<TraceLink id={rev.from.messageId} /></div>
                <div className="text-gray-500 text-xs mt-1">到：</div>
                <div>{rev.to.text}<TraceLink id={rev.to.messageId} /></div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {card.finalPosition && (
        <section className="mb-4">
          <h4 className="text-sm font-semibold text-gray-600 mb-1">5. 你最后表达的观点</h4>
          <p className="text-sm bg-purple-50 p-3 rounded">
            {card.finalPosition.text}
            <TraceLink id={card.finalPosition.messageId} />
          </p>
        </section>
      )}

      {card.uncertainAnswers.length > 0 && (
        <section className="mb-4">
          <h4 className="text-sm font-semibold text-gray-600 mb-1">6. 保留的不确定回答</h4>
          <ul className="text-sm space-y-1">
            {card.uncertainAnswers.map((a) => (
              <li key={a.messageId} className="bg-gray-50 p-2 rounded">
                {a.text}
                <TraceLink id={a.messageId} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {card.unresolved.length > 0 && (
        <section className="mb-4">
          <h4 className="text-sm font-semibold text-gray-600 mb-1">7. 未解决问题</h4>
          <ul className="text-sm list-disc list-inside">
            {card.unresolved.map((u, i) => (
              <li key={i}>{u}</li>
            ))}
          </ul>
        </section>
      )}

      {!card.finalPosition && !card.startingStance && !card.initialExpression && (
        <p className="text-sm text-gray-500">
          本次会话没有用户原创内容，成果卡为空。
        </p>
      )}

      <button
        onClick={onNewSession}
        className="w-full mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
      >
        开启新一轮思辨
      </button>
    </div>
  );
}
