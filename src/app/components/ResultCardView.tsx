'use client';

import { useState } from 'react';
import { buildDetailedResultCard, type DetailedResultCard } from '@/lib/result-card-builder';
import type { Session } from '@/lib/providers';
import CognitiveTrajectoryView from './CognitiveTrajectoryView';
import { buildSessionMarkdown } from '@/lib/session-export';
import { Sparkles, Share2, ArrowRight, BookOpen, CheckCircle, RefreshCw, HelpCircle } from 'lucide-react';

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
    <span className="inline-block px-2 py-0.5 text-[10px] rounded-md bg-surface-subtle text-content-secondary border border-line mt-1.5 font-mono">
      {SOURCE_LABELS[source] ?? source}
    </span>
  );
}

function TraceLink({ id }: { id: string }) {
  return (
    <span className="text-[10px] text-content-tertiary ml-1.5 font-mono" title={`来源: ${id}`}>
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
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 bg-surface-elevated text-content-primary">
      <div className="mb-2 flex items-center justify-between pb-3 border-b border-line">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-accent" />
          <h3 className="text-lg sm:text-xl font-bold text-brand font-serif">思辨成果卡</h3>
        </div>
        {session && (
          <button
            type="button"
            onClick={() => void handleShare()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-line bg-surface hover:bg-surface-subtle text-xs font-medium text-content-primary shadow-2xs transition-all hover:scale-[1.02] focus:outline-none"
            title="生成分享链接并复制"
            aria-label="生成分享链接并复制到剪切板"
            data-testid="share-card-button"
          >
            <Share2 className="w-3.5 h-3.5 text-accent" />
            <span>分享成果</span>
          </button>
        )}
      </div>
      {shareNotice && (
        <div role="status" aria-live="polite" className="fixed right-5 top-5 z-50 rounded-xl border border-semantic-success/30 bg-semantic-success-light px-4 py-3 text-xs font-medium text-semantic-success shadow-lg">
          已复制分享链接
        </div>
      )}

      <CognitiveTrajectoryView events={trajectory ?? []}>

      {/* GalGame Story Outcome (#G-05) */}
      {storyRun && (
        <section className="mb-4 bg-surface border border-line rounded-2xl p-5 space-y-3 shadow-xs">
          <div className="flex items-center justify-between pb-2 border-b border-line">
            <h4 className="text-xs sm:text-sm font-bold text-brand font-serif">推演剧本结局反思</h4>
            <span className="text-[10px] text-accent bg-accent-light px-2 py-0.5 rounded font-mono border border-accent/20">
              Act {storyRun.currentActIndex + 1}
            </span>
          </div>
          {storyRun.outcomeNarrative && (
            <p className="text-xs text-content-primary leading-relaxed font-serif">
              {storyRun.outcomeNarrative}
            </p>
          )}
          {storyRun.reflectionSummary && (
            <p className="text-xs text-content-secondary bg-surface-subtle p-3 rounded-xl border border-line leading-relaxed">
              {storyRun.reflectionSummary}
            </p>
          )}
        </section>
      )}

      {card.initialExpression && (
        <section className="mb-4">
          <h4 className="text-xs font-semibold text-content-secondary mb-1.5 uppercase tracking-wider">1. 初始表达</h4>
          <div className="text-xs sm:text-sm bg-surface p-3.5 rounded-xl border border-line leading-relaxed">
            {card.initialExpression.text}
            <TraceLink id={card.initialExpression.messageId} />
          </div>
          <SourceLabel source="user_authored" />
        </section>
      )}

      {card.startingStance && (
        <section className="mb-4">
          <h4 className="text-xs font-semibold text-content-secondary mb-1.5 uppercase tracking-wider">2. 起始立场</h4>
          <div className="text-xs sm:text-sm bg-surface p-3.5 rounded-xl border border-line leading-relaxed font-serif">
            {card.startingStance.text}
            <TraceLink id={card.startingStance.messageId ?? ''} />
          </div>
          <SourceLabel source={card.startingStance.source} />
        </section>
      )}

      {card.newEvidence.length > 0 && (
        <section className="mb-4">
          <h4 className="text-xs font-semibold text-content-secondary mb-1.5 uppercase tracking-wider">3. 新增证据</h4>
          <ul className="text-xs sm:text-sm space-y-1.5">
            {card.newEvidence.map((ev) => (
              <li key={ev.messageId} className="bg-surface p-3 rounded-xl border border-line leading-relaxed">
                {ev.text}
                <TraceLink id={ev.messageId} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {card.stanceRevisions.length > 0 && (
        <section className="mb-4">
          <h4 className="text-xs font-semibold text-content-secondary mb-1.5 uppercase tracking-wider">4. 观点修正</h4>
          <ul className="text-xs sm:text-sm space-y-2">
            {card.stanceRevisions.map((rev, i) => (
              <li key={i} className="bg-surface p-3.5 rounded-xl border border-line leading-relaxed">
                <div className="text-content-tertiary text-[11px]">从：</div>
                <div className="text-content-secondary">{rev.from.text}<TraceLink id={rev.from.messageId} /></div>
                <div className="text-accent text-[11px] mt-1.5 font-medium">到：</div>
                <div className="text-content-primary font-medium">{rev.to.text}<TraceLink id={rev.to.messageId} /></div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {card.finalPosition && (
        <section className="mb-4">
          <h4 className="text-xs font-semibold text-content-secondary mb-1.5 uppercase tracking-wider">5. 你最后表达的观点</h4>
          <div className="text-xs sm:text-sm bg-brand-light p-3.5 rounded-xl border border-brand-subtle text-brand font-medium leading-relaxed font-serif">
            {card.finalPosition.text}
            <TraceLink id={card.finalPosition.messageId} />
          </div>
        </section>
      )}

      {card.uncertainAnswers.length > 0 && (
        <section className="mb-4">
          <h4 className="text-xs font-semibold text-content-secondary mb-1.5 uppercase tracking-wider">6. 保留的不确定回答</h4>
          <ul className="text-xs sm:text-sm space-y-1.5">
            {card.uncertainAnswers.map((a) => (
              <li key={a.messageId} className="bg-surface p-3 rounded-xl border border-line text-content-secondary leading-relaxed">
                {a.text}
                <TraceLink id={a.messageId} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {card.unresolved.length > 0 && (
        <section className="mb-4">
          <h4 className="text-xs font-semibold text-content-secondary mb-1.5 uppercase tracking-wider">7. 未解决问题</h4>
          <ul className="text-xs sm:text-sm list-disc list-inside space-y-1 text-content-secondary">
            {card.unresolved.map((u, i) => (
              <li key={i}>{u}</li>
            ))}
          </ul>
        </section>
      )}

      {!card.finalPosition && !card.startingStance && !card.initialExpression && (
        <p className="text-xs text-content-tertiary">
          本次会话没有用户原创内容，成果卡为空。
        </p>
      )}
      </CognitiveTrajectoryView>

      <button
        onClick={onNewSession}
        className="w-full mt-4 py-3 px-4 bg-brand hover:bg-brand-hover text-content-inverse rounded-xl font-medium text-xs sm:text-sm shadow-xs transition-all flex items-center justify-center gap-2 active:scale-[0.98]"
      >
        <span>开启新一轮思辨</span>
        <ArrowRight className="w-4 h-4" />
      </button>
    </div>
  );
}
