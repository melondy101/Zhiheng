'use client';

import type { CognitiveTrajectoryEvent } from '@/lib/cognitive-trajectory';
import { COGNITIVE_EVENT_LABELS } from '@/lib/cognitive-trajectory';
import type { ReactNode } from 'react';

interface CognitiveTrajectoryViewProps {
  events: CognitiveTrajectoryEvent[];
  compact?: boolean;
  children?: ReactNode;
}

export default function CognitiveTrajectoryView({
  events,
  compact = false,
  children,
}: CognitiveTrajectoryViewProps) {
  if ((!events || events.length === 0) && !children) {
    return null;
  }

  if (compact) {
    return (
      <div className="p-3 bg-indigo-50/60 rounded-xl border border-indigo-100 text-xs space-y-2" data-testid="cognitive-trajectory-compact">
        <div className="flex items-center justify-between font-semibold text-indigo-900">
          <span className="flex items-center gap-1.5">
            <span>🧭</span> 认知轨迹演进 ({events.length} 节点)
          </span>
          <span className="text-[10px] text-indigo-500 font-normal">客观记录 · 无评判</span>
        </div>
        <div className="flex flex-wrap gap-1.5 pt-1">
          {events.map((ev, i) => (
            <span
              key={ev.id}
              className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] bg-white border border-indigo-200 text-indigo-700 shadow-2xs"
              title={`${ev.summary} (${ev.description})`}
            >
              <span className="font-mono text-[9px] mr-1 text-indigo-400">#{i + 1}</span>
              {COGNITIVE_EVENT_LABELS[ev.type] ?? ev.type}
            </span>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 bg-white rounded-xl border border-indigo-100 shadow-xs space-y-3" data-testid="cognitive-trajectory-full">
      <div className="flex items-center justify-between border-b border-indigo-50 pb-2">
        <div>
          <h4 className="text-xs font-bold text-indigo-950 flex items-center gap-1.5">
            <span>🧭</span> 认知轨迹 (Cognitive Trajectory)
          </h4>
          <p className="text-[10px] text-gray-500 mt-0.5">
            基于会话真实交互客观梳理，不作主观评判，展示思考层层推进的脉络。
          </p>
        </div>
        <span className="px-2 py-0.5 text-[10px] rounded-full bg-indigo-50 text-indigo-600 font-medium">
          {events.length} 个思辨节点
        </span>
      </div>

      <div className="relative pl-4 space-y-3 border-l-2 border-indigo-100 my-2">
        {events.map((ev, index) => (
          <div key={ev.id} className="relative group">
            {/* Node bullet */}
            <div className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-indigo-400 border-2 border-white ring-1 ring-indigo-200" />

            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-indigo-900">
                  {COGNITIVE_EVENT_LABELS[ev.type] ?? ev.type}
                </span>
                <span className="text-[10px] text-gray-400 font-mono">
                  步骤 {index + 1}
                </span>
                {ev.messageId && (
                  <span className="text-[9px] text-gray-400 bg-gray-50 px-1 rounded font-mono">
                    [{ev.messageId.slice(0, 8)}]
                  </span>
                )}
              </div>

              <p className="text-xs text-gray-700 bg-gray-50/80 p-2.5 rounded-lg border border-gray-100 leading-relaxed font-sans">
                {ev.description}
              </p>
            </div>
          </div>
        ))}
      </div>
      {children}
    </div>
  );
}
