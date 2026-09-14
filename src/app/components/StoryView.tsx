'use client';
import { useState } from 'react';

import type { StoryRun, StoryChoiceOption } from '@/lib/story-run';
import { STORY_WORLDS } from '@/lib/story-run';
import type { CitedSource } from '@/lib/providers';

interface StoryViewProps {
  storyRun: StoryRun;
  sources?: CitedSource[] | null;
  onChoice: (choiceId: string, optionId: string) => void;
  onFreeform: (text: string) => void;
  onComplete: () => void;
  onEndEarly: () => void;
  onBridge: () => void;
}

export default function StoryView({
  storyRun,
  onChoice,
  onFreeform,
  onComplete,
  onEndEarly,
  onBridge,
}: StoryViewProps) {
  const [freeform, setFreeform] = useState('');
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
              {act.choices.filter((c) => c.selectedOptionId).map((c) => { const opt = c.options.find((o) => o.id === c.selectedOptionId); return opt ? <p key={c.id} className="text-purple-700 bg-purple-50/70 rounded px-2 py-1.5">选择后果：{opt.consequence}</p> : null; })}
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
                {storyRun.aiScene || currentAct.narrative}
              </p>
              {(storyRun.aiDialogue || currentAct.dialogue) && <div className="space-y-2 border-t border-gray-100 pt-3">{(storyRun.aiDialogue || currentAct.dialogue || []).map((line, i) => <div key={i} className="flex gap-2 text-xs"><span className={`font-semibold shrink-0 ${line.role === 'oppose' ? 'text-rose-600' : line.role === 'support' ? 'text-emerald-600' : 'text-purple-700'}`}>{line.speaker}</span><span className="text-gray-700 leading-relaxed">“{line.text}”</span></div>)}</div>}
            </div>

            {/* Critical Choice Card */}
            {pendingChoice && (
              <div className="bg-gradient-to-br from-purple-50/80 to-indigo-50/50 rounded-xl p-5 border border-purple-200 space-y-4">
                <div className="space-y-1">
                  <div className="text-xs font-bold text-purple-900 flex items-center gap-1.5">
                    <span>⚡</span> 关键决断：{pendingChoice.title}
                  </div>
                  <p className="text-xs text-purple-700">{pendingChoice.prompt}</p>
                  {currentAct.reasoningGoal && <span className="inline-block text-[10px] text-purple-500 bg-purple-50 px-2 py-0.5 rounded">思辨任务：{({ fact_check: '核验事实', premise: '检查前提', counterargument: '面对反方', tradeoff: '权衡代价' } as Record<string, string>)[currentAct.reasoningGoal]}</span>}
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
                <div className="border-t border-purple-200 pt-3 space-y-2"><label className="text-xs font-semibold text-purple-900">或者，写下你自己的行动方案</label><textarea value={freeform} onChange={(e) => setFreeform(e.target.value)} placeholder="描述你会怎么做，以及愿意承担什么代价" className="w-full min-h-20 rounded-lg border border-purple-200 bg-white p-2.5 text-xs text-gray-800 resize-y" /><button type="button" disabled={!freeform.trim()} onClick={() => { onFreeform(freeform.trim()); setFreeform(''); }} className="px-3 py-2 rounded-lg bg-purple-600 text-white text-xs disabled:opacity-40">提交我的方案</button></div>
              </div>
            )}
            {!pendingChoice && currentAct?.choices.length === 0 && !isCompleted && <div className="bg-purple-50 rounded-xl p-5 border border-purple-200 space-y-3"><label className="text-xs font-semibold text-purple-900">继续你的推演方案</label><textarea value={freeform} onChange={(e) => setFreeform(e.target.value)} placeholder="描述你会怎么做，以及愿意承担什么代价" className="w-full min-h-24 rounded-lg border border-purple-200 bg-white p-2.5 text-xs resize-y" /><div className="flex gap-2"><button type="button" disabled={!freeform.trim()} onClick={() => { onFreeform(freeform.trim()); setFreeform(''); }} className="px-3 py-2 rounded-lg bg-purple-600 text-white text-xs disabled:opacity-40">继续推进</button><button type="button" onClick={onEndEarly} className="px-3 py-2 rounded-lg border border-purple-200 text-purple-700 text-xs">结束并复盘</button></div></div>}

            {/* Act finished and ready to advance */}
            {!pendingChoice && currentAct?.choices.length > 0 && storyRun.currentActIndex < storyRun.acts.length && (
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
            {!pendingChoice && storyRun.currentActIndex === storyRun.acts.length && currentAct?.choices.length > 0 && (
              <div className="text-center py-4">
                <button
                  onClick={onComplete}
                  className="px-6 py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 shadow-sm"
                >
                  生成最终结局与推演反思 ✓
                </button>
              </div>
            )}
            {!pendingChoice && currentAct?.choices.length === 0 && !isCompleted && <div className="text-center py-4"><button onClick={onComplete} className="px-5 py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-medium">结束本轮并生成思维复盘</button></div>}
          </div>
        )}

        {/* Story completion card */}
        {isCompleted && (
          <div className="space-y-6">
            {storyRun.thinkingProfile && <div className="bg-indigo-50 rounded-xl p-5 border border-indigo-200 space-y-3"><div className="flex items-center justify-between"><div className="text-sm font-semibold text-indigo-900">知研思维型人格：{storyRun.thinkingProfile.name}</div><span className="font-mono text-xs text-indigo-600">{storyRun.thinkingProfile.code}</span></div><p className="text-xs text-indigo-700">基于 {storyRun.thinkingProfile.sampleSize} 次决策，当前置信度 {Math.round(storyRun.thinkingProfile.confidence * 100)}%</p><div className="grid grid-cols-2 gap-2">{storyRun.thinkingProfile.axes.map((axis) => <div key={axis.key} className="bg-white/70 rounded p-2 text-[11px]"><div className="font-semibold text-gray-700">{axis.key}</div><div className="text-indigo-700">{axis.score >= 0 ? axis.positive : axis.negative}</div></div>)}</div><div className="text-xs text-emerald-700">思维强项：{storyRun.thinkingProfile.strengths.join('；')}</div><div className="text-xs text-amber-700">可能短板：{storyRun.thinkingProfile.blindSpots.join('；')}</div><p className="text-[10px] text-indigo-500">这是基于推演行为生成的娱乐化思维画像，可随更多决策变化。</p></div>}
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
