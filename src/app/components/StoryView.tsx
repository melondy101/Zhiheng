'use client';

import type { StoryRun, StoryChoiceOption } from '@/lib/story-run';
import { STORY_WORLDS } from '@/lib/story-run';
import type { CitedSource } from '@/lib/providers';

interface StoryViewProps {
  storyRun: StoryRun;
  sources?: CitedSource[] | null;
  onChoice: (choiceId: string, optionId: string) => void;
  onComplete: () => void;
  onEndEarly: () => void;
  onBridge: () => void;
}

export default function StoryView({
  storyRun,
  onChoice,
  onComplete,
  onEndEarly,
  onBridge,
}: StoryViewProps) {
  const worldConfig = STORY_WORLDS[storyRun.world] ?? STORY_WORLDS.future_city;
  const currentAct = storyRun.acts.find((a) => a.actIndex === storyRun.currentActIndex) ?? storyRun.acts[0];
  const isCompleted = storyRun.status === 'completed';
  const isEndedEarly = storyRun.status === 'ended_early';

  const pendingChoice = currentAct?.choices.find((c) => !c.selectedOptionId);

  const selectedChoices = storyRun.acts.flatMap((act) =>
    act.choices
      .filter((c) => c.selectedOptionId)
      .map((c) => ({
        choiceTitle: c.title,
        option: c.options.find((o) => o.id === c.selectedOptionId),
      }))
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-gradient-to-b from-gray-50 to-white" data-testid="story-view">
      {/* World header & Progress */}
      <div className="p-4 border-b bg-white/80 backdrop-blur-sm flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 text-xs rounded-full bg-purple-100 text-purple-700 font-medium">
              {worldConfig.name}
            </span>
            <span className="text-xs text-gray-500 font-mono">
              第 {storyRun.currentActIndex} 幕 / 共 {storyRun.acts.length} 幕
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-1">{worldConfig.setting}</p>
        </div>

        <div className="flex items-center gap-2">
          {!isCompleted && !isEndedEarly && (
            <button
              onClick={onEndEarly}
              className="text-xs text-gray-500 hover:text-red-600 px-2.5 py-1 rounded border border-gray-200 hover:border-red-200 transition-colors"
            >
              放弃推演
            </button>
          )}
        </div>
      </div>

      {/* Act timeline indicator */}
      <div className="grid grid-cols-3 gap-1 px-4 pt-2 pb-1 bg-gray-50/50 text-[11px] text-gray-600 border-b border-gray-100">
        {storyRun.acts.map((act) => (
          <div
            key={act.actIndex}
            className={`py-1 px-2 rounded text-center truncate ${
              act.actIndex === storyRun.currentActIndex
                ? 'bg-purple-50 text-purple-700 font-medium border border-purple-200'
                : act.actIndex < storyRun.currentActIndex
                ? 'text-gray-400 line-through'
                : 'text-gray-400'
            }`}
          >
            {act.title}
          </div>
        ))}
      </div>

      {/* Story narrative content area */}
      <div className="flex-1 overflow-y-auto p-5 space-y-6">
        {/* Render prior acts */}
        {storyRun.acts
          .filter((act) => act.actIndex < storyRun.currentActIndex)
          .map((act) => (
            <div key={act.actIndex} className="opacity-60 space-y-2 border-l-2 border-purple-200 pl-4 py-1 text-xs">
              <div className="font-semibold text-gray-700">{act.title}</div>
              <p className="text-gray-600 leading-relaxed whitespace-pre-line">{act.narrative}</p>
            </div>
          ))}

        {/* Current act narrative */}
        {currentAct && !isCompleted && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl p-5 border border-purple-100 shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-purple-900 tracking-wider">
                  【场景叙事】{currentAct.title}
                </span>
                <span className="text-[10px] text-purple-500 bg-purple-50 px-2 py-0.5 rounded">
                  核心冲突
                </span>
              </div>
              <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-line font-serif">
                {currentAct.narrative}
              </p>
            </div>

            {/* Critical Choice Card */}
            {pendingChoice && (
              <div className="bg-gradient-to-br from-purple-50/80 to-indigo-50/50 rounded-xl p-5 border border-purple-200 space-y-4">
                <div className="space-y-1">
                  <div className="text-xs font-bold text-purple-900 flex items-center gap-1.5">
                    <span>⚡</span> 关键决断：{pendingChoice.title}
                  </div>
                  <p className="text-xs text-purple-700">{pendingChoice.prompt}</p>
                </div>

                <div className="space-y-2.5">
                  {pendingChoice.options.map((opt: StoryChoiceOption) => (
                    <button
                      key={opt.id}
                      onClick={() => onChoice(pendingChoice.id, opt.id)}
                      className="w-full text-left p-3.5 rounded-lg bg-white border border-purple-100 hover:border-purple-400 hover:shadow-md transition-all group"
                    >
                      <div className="text-sm font-medium text-gray-900 group-hover:text-purple-900">
                        {opt.text}
                      </div>

                      <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[11px]">
                        <div className="text-indigo-600 bg-indigo-50/60 px-2 py-1 rounded">
                          <span className="font-semibold">前提假设：</span>
                          {opt.premise}
                        </div>
                        <div className="text-emerald-700 bg-emerald-50/60 px-2 py-1 rounded">
                          <span className="font-semibold">预期收益：</span>
                          {opt.benefit}
                        </div>
                        <div className="text-amber-700 bg-amber-50/60 px-2 py-1 rounded">
                          <span className="font-semibold">潜在代价：</span>
                          {opt.cost}
                        </div>
                        {opt.evidenceCitationIds.length > 0 && (
                          <div className="text-blue-600 bg-blue-50/60 px-2 py-1 rounded">
                            <span className="font-semibold">研报佐证：</span>
                            {opt.evidenceCitationIds.map((c) => `[${c}]`).join(' ')}
                          </div>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Act finished and ready to advance */}
            {!pendingChoice && storyRun.currentActIndex < storyRun.acts.length && (
              <div className="text-center py-4">
                <button
                  onClick={onComplete}
                  className="px-6 py-2.5 rounded-lg bg-purple-600 text-white text-sm font-medium hover:bg-purple-700 shadow-sm"
                >
                  进入下一幕推演 →
                </button>
              </div>
            )}

            {/* Final act finished and ready to complete */}
            {!pendingChoice && storyRun.currentActIndex === storyRun.acts.length && (
              <div className="text-center py-4">
                <button
                  onClick={onComplete}
                  className="px-6 py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 shadow-sm"
                >
                  生成最终结局与推演反思 ✓
                </button>
              </div>
            )}
          </div>
        )}

        {/* Story completion card */}
        {isCompleted && (
          <div className="space-y-6">
            <div className="bg-white rounded-xl p-6 border border-emerald-200 shadow-sm space-y-4">
              <div className="flex items-center gap-2 text-emerald-700 font-semibold text-base">
                <span>🏆</span> 推演达成：最终结局
              </div>
              <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-line font-serif">
                {storyRun.outcomeNarrative}
              </p>
            </div>

            {storyRun.reflectionSummary && (
              <div className="bg-purple-50/70 rounded-xl p-5 border border-purple-200 space-y-3">
                <div className="text-xs font-bold text-purple-900 flex items-center gap-1.5">
                  <span>💡</span> 推演思辨总结 (Reflection Summary)
                </div>
                <p className="text-xs text-purple-800 leading-relaxed whitespace-pre-line">
                  {storyRun.reflectionSummary}
                </p>
              </div>
            )}

            {/* Decision trace */}
            <div className="bg-gray-50 rounded-xl p-4 border border-gray-200 space-y-2">
              <div className="text-xs font-semibold text-gray-700">推演决断脉络：</div>
              <div className="space-y-2 text-xs">
                {selectedChoices.map((item, i) => (
                  <div key={i} className="flex items-start gap-2 bg-white p-2.5 rounded border border-gray-100">
                    <span className="text-purple-600 font-mono">#{i + 1}</span>
                    <div className="space-y-0.5">
                      <div className="font-medium text-gray-900">{item.option?.text ?? item.choiceTitle}</div>
                      {item.option && (
                        <div className="text-[11px] text-gray-500">
                          代价：{item.option.cost} ｜ 收益：{item.option.benefit}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <button
                onClick={onBridge}
                className="flex-1 px-5 py-3 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 text-white text-sm font-semibold hover:from-purple-700 hover:to-indigo-700 shadow-sm flex items-center justify-center gap-2"
              >
                <span>🌉</span> 一键桥接至深度思辨探问
              </button>
            </div>
          </div>
        )}

        {isEndedEarly && (
          <div className="text-center py-12 space-y-3">
            <p className="text-sm text-gray-600">本次推演已提前中止。</p>
            <button
              onClick={onBridge}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
            >
              返回普通思辨模式
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
