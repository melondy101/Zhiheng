'use client';

import { useState } from 'react';
import { buildDetailedResultCard, type DetailedResultCard } from '@/lib/result-card-builder';
import type { Session } from '@/lib/providers';
import CognitiveTrajectoryView from './CognitiveTrajectoryView';
import { buildSessionMarkdown } from '@/lib/session-export';

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

async function copyToClipboard(value: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Fall through to the textarea fallback for local HTTP browsers.
    }
  }
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  return copied;
}

export function ResultCardViewFromSession({ session, onNewSession }: {
  session: Session;
  onNewSession: () => void;
}) {
  const card = buildDetailedResultCard(session);
  return <ResultCardView card={card} session={session} onNewSession={onNewSession} />;
}

export default function ResultCardView({ card, session, onNewSession }: ResultCardViewProps) {
  const [shareNotice, setShareNotice] = useState(false);
  const trajectory = session?.cognitiveTrajectory;
  const storyRun = session?.storyRun;
  const handleShare = async () => {
    if (!session) return;
    try {
      const response = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown: buildSessionMarkdown(session) }),
      });
      const data = await response.json() as { url?: string; shortened?: boolean; sinkConfigured?: boolean };
      if (!response.ok || !data.url) throw new Error('分享链接生成失败');
      if (await copyToClipboard(data.url)) {
        setShareNotice(true);
        window.setTimeout(() => setShareNotice(false), 2600);
      }
    } catch (error) {
      console.error('Failed to generate share link:', error);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">
      <div className="mb-2 flex items-center gap-3">
        <h3 className="text-xl font-bold text-blue-600">思辨成果卡</h3>
        {session && (
          <button
            type="button"
            onClick={() => void handleShare()}
            className="group inline-flex min-h-12 min-w-12 items-center justify-center rounded-full border border-slate-200 bg-white p-2 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-emerald-500"
            title="生成分享链接并复制"
            aria-label="生成分享链接并复制到剪切板"
            data-testid="share-card-button"
          >
            <img src="/sharethis-icon.avif" alt="分享" width="36" height="36" className="h-9 w-9 rounded-full object-cover" />
          </button>
        )}
      </div>
      {shareNotice && <div role="status" aria-live="polite" className="fixed right-5 top-5 z-50 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700 shadow-lg">已复制分享链接</div>}

      <CognitiveTrajectoryView events={trajectory ?? []}>

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
      </CognitiveTrajectoryView>

      <button
        onClick={onNewSession}
        className="w-full mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
      >
        开启新一轮思辨
      </button>
    </div>
  );
}
