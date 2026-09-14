'use client';
import { useState, useEffect } from 'react';
import { Loader2, Sparkles, Send, Check } from 'lucide-react';

import type { StoryRun, StoryChoiceOption } from '@/lib/story-run';
import { STORY_WORLDS } from '@/lib/story-run';
import type { CitedSource } from '@/lib/providers';

interface StoryViewProps {
  storyRun: StoryRun;
  sources?: CitedSource[] | null;
  loading?: boolean;
  onChoice: (choiceId: string, optionId: string) => void;
  onFreeform: (text: string) => void;
  onComplete: () => void;
  onEndEarly: () => void;
  onBridge: () => void;
}

export default function StoryView({
  storyRun,
  sources: _sources,
  loading = false,
  onChoice,
  onFreeform,
  onComplete,
  onEndEarly,
  onBridge,
}: StoryViewProps) {
  const [freeform, setFreeform] = useState('');
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<{
    type: 'choice' | 'freeform' | 'complete' | 'end_early';
    title?: string;
    optionId?: string;
  } | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const worldConfig = STORY_WORLDS[storyRun.world] ?? STORY_WORLDS.future_city;
  const currentAct = storyRun.acts.find((a) => a.actIndex === storyRun.currentActIndex) ?? storyRun.acts[0];
  const isCompleted = storyRun.status === 'completed';
  const isEndedEarly = storyRun.status === 'ended_early';

  const isBusy = Boolean(loading || pendingAction);

  // Reset selected option and freeform text when act or choice changes
  useEffect(() => {
    setSelectedOptionId(null);
    setFreeform('');
  }, [currentAct?.actIndex, currentAct?.choices.length]);

  // Clear local pending action once loading prop returns to false
  useEffect(() => {
    if (!loading) {
      setPendingAction(null);
    }
  }, [loading]);

  // Elapsed ticker for transparent AI generation feedback
  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    if (isBusy) {
      setElapsedSeconds(0);
      timer = setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      setElapsedSeconds(0);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isBusy]);

  const handleFreeformSubmit = (text: string) => {
    const trimmed = text.trim();
    if (isBusy || !trimmed) return;
    setPendingAction({ type: 'freeform', title: trimmed });
    onFreeform(trimmed);
    setFreeform('');
  };

  const handleDecisionSubmit = (choiceId: string) => {
    if (isBusy) return;
    if (selectedOptionId) {
      const selectedOpt = pendingChoice?.options.find((o) => o.id === selectedOptionId);
      if (!selectedOpt) return;
      const note = freeform.trim();
      const title = note ? `${selectedOpt.text}（执行补充：${note}）` : selectedOpt.text;
      setPendingAction({ type: 'choice', title, optionId: selectedOptionId });
      onChoice(choiceId, selectedOptionId);
    } else if (freeform.trim()) {
      handleFreeformSubmit(freeform);
    }
  };

  const handleCompleteClick = () => {
    if (isBusy) return;
    setPendingAction({
      type: 'complete',
      title: storyRun.currentActIndex === storyRun.acts.length ? '生成最终结局与思维复盘' : '进入下一幕推演',
    });
    onComplete();
  };

  const handleEndEarlyClick = () => {
    if (isBusy) return;
    setPendingAction({ type: 'end_early', title: '提前中止推演' });
    onEndEarly();
  };

  const getDynamicHint = (seconds: number) => {
    if (seconds < 3) {
      return '正在解析行动方案与前提假设...';
    }
    if (seconds < 6) {
      return '正在结合背景研报与各方立场，推演对立观点与连锁后果...';
    }
    return '正在编织下一幕情境叙事与关键冲突对白，即将呈现...';
  };

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
              id="story-abandon-btn"
              disabled={isBusy}
              onClick={handleEndEarlyClick}
              className="text-xs text-gray-500 hover:text-red-600 px-2.5 py-1 rounded border border-gray-200 hover:border-red-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              放弃推演
            </button>
          )}
        </div>
      </div>

      {/* Act timeline indicator */}
      <div className="grid grid-cols-3 gap-1 px-4 pt-2 pb-1 bg-gray-50/50 text-[11px] text-gray-600 border-b border-gray-100">
        {storyRun.acts.map((act) => {
          const isCurrent = act.actIndex === storyRun.currentActIndex;
          const isPast = act.actIndex < storyRun.currentActIndex;
          return (
            <div
              key={act.actIndex}
              className={`py-1 px-2 rounded text-center truncate transition-all flex items-center justify-center gap-1 ${
                isCurrent
                  ? 'bg-purple-50 text-purple-700 font-medium border border-purple-200 shadow-2xs'
                  : isPast
                  ? 'text-gray-400 line-through'
                  : 'text-gray-400'
              }`}
            >
              {isCurrent && isBusy && <Loader2 className="w-2.5 h-2.5 animate-spin text-purple-600 shrink-0" />}
              <span>{act.title}</span>
              {isCurrent && isBusy && <span className="text-[10px] text-purple-500 hidden sm:inline">(推演中)</span>}
            </div>
          );
        })}
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
                {currentAct.narrative || storyRun.aiScene}
              </p>
              {(currentAct.dialogue || storyRun.aiDialogue) && <div className="space-y-2 border-t border-gray-100 pt-3">{(currentAct.dialogue || storyRun.aiDialogue || []).map((line, i) => <div key={i} className="flex gap-2 text-xs"><span className={`font-semibold shrink-0 ${line.role === 'oppose' ? 'text-rose-600' : line.role === 'support' ? 'text-emerald-600' : 'text-purple-700'}`}>{line.speaker}</span><span className="text-gray-700 leading-relaxed">“{line.text}”</span></div>)}</div>}
            </div>

            {/* AI Dynamic Story Generation Loading & Hint Banner */}
            {isBusy && (
              <div
                id="story-generating-prompt"
                data-testid="story-loading-indicator"
                className="rounded-xl border border-purple-300 bg-gradient-to-br from-purple-50 via-indigo-50/80 to-white p-5 shadow-sm space-y-3.5 transition-all animate-in fade-in duration-200"
              >
                <div className="flex items-center justify-between border-b border-purple-200/60 pb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-purple-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                      <Loader2 className="w-4 h-4 animate-spin" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-purple-950 flex items-center gap-1.5">
                        <span>正在实时推演下一幕剧情...</span>
                        <span className="text-[10px] text-purple-600 font-mono font-normal">({elapsedSeconds}s)</span>
                      </div>
                      <p className="text-[11px] text-purple-700/80">
                        剧情非静态剧本，知研大模型正在根据你的决策临时演算生成
                      </p>
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-purple-100/90 text-purple-800 text-[11px] font-medium border border-purple-200">
                    <Sparkles className="w-3 h-3 text-purple-600" />
                    AI 动态生成中
                  </span>
                </div>

                {/* Current user input reflection */}
                <div className="bg-white/90 rounded-lg p-3 border border-purple-100 space-y-1.5 text-xs">
                  {pendingAction?.type === 'choice' && (
                    <div className="text-purple-900">
                      <span className="font-semibold text-purple-700">已采纳决断：</span>
                      <span className="font-medium">“{pendingAction.title}”</span>
                    </div>
                  )}
                  {pendingAction?.type === 'freeform' && (
                    <div className="text-purple-900">
                      <span className="font-semibold text-purple-700">已提交自拟方案：</span>
                      <span className="font-medium">
                        “{pendingAction.title && pendingAction.title.length > 60 ? `${pendingAction.title.slice(0, 60)}...` : pendingAction.title}”
                      </span>
                    </div>
                  )}
                  {pendingAction?.type === 'complete' && (
                    <div className="text-purple-900 font-medium">
                      正在收束当前阶段推演，生成后续章节...
                    </div>
                  )}
                  <div className="flex items-center gap-1.5 text-purple-700 font-medium pt-0.5">
                    <span className="inline-block w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
                    <span>当前进度：{getDynamicHint(elapsedSeconds)}</span>
                  </div>
                </div>

                {/* 3-stage visual reasoning progress */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px]">
                  <div className={`p-2 rounded-lg border flex items-center gap-1.5 transition-colors ${
                    elapsedSeconds >= 0 ? 'bg-purple-100/70 border-purple-300 text-purple-900 font-medium' : 'bg-gray-50 border-gray-100 text-gray-400'
                  }`}>
                    <span className="w-1.5 h-1.5 rounded-full bg-purple-600 shrink-0 animate-ping" />
                    <span>1. 评估方案前提与代价</span>
                  </div>
                  <div className={`p-2 rounded-lg border flex items-center gap-1.5 transition-colors ${
                    elapsedSeconds >= 3 ? 'bg-indigo-100/70 border-indigo-300 text-indigo-900 font-medium' : 'bg-white/60 border-purple-100 text-purple-400'
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${elapsedSeconds >= 3 ? 'bg-indigo-600 animate-ping' : 'bg-gray-300'}`} />
                    <span>2. 模拟各方博弈与反击</span>
                  </div>
                  <div className={`p-2 rounded-lg border flex items-center gap-1.5 transition-colors ${
                    elapsedSeconds >= 6 ? 'bg-emerald-100/70 border-emerald-300 text-emerald-900 font-medium' : 'bg-white/60 border-purple-100 text-purple-400'
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${elapsedSeconds >= 6 ? 'bg-emerald-600 animate-ping' : 'bg-gray-300'}`} />
                    <span>3. 构想下一幕冲突叙事</span>
                  </div>
                </div>
              </div>
            )}

            {/* Critical Choice Card */}
            {pendingChoice && (
              <div id="story-choice-card" className="bg-gradient-to-br from-purple-50/80 to-indigo-50/50 rounded-xl p-5 border border-purple-200 space-y-4">
                <div className="space-y-1">
                  <div className="text-xs font-bold text-purple-900 flex items-center gap-1.5">
                    <span>⚡</span> 关键决断：{pendingChoice.title}
                  </div>
                  <p className="text-xs text-purple-700">{pendingChoice.prompt}</p>
                  {currentAct.reasoningGoal && <span className="inline-block text-[10px] text-purple-500 bg-purple-50 px-2 py-0.5 rounded">思辨任务：{({ fact_check: '核验事实', premise: '检查前提', counterargument: '面对反方', tradeoff: '权衡代价' } as Record<string, string>)[currentAct.reasoningGoal]}</span>}
                </div>

                <div className="space-y-2.5">
                  {pendingChoice.options.map((opt: StoryChoiceOption) => {
                    const isSelected = selectedOptionId === opt.id;
                    const isBeingGenerated = pendingAction?.optionId === opt.id;
                    return (
                      <button
                        key={opt.id}
                        id={`story-option-${opt.id}`}
                        type="button"
                        disabled={isBusy}
                        onClick={() => {
                          if (isBusy) return;
                          setSelectedOptionId((prev) => (prev === opt.id ? null : opt.id));
                        }}
                        className={`w-full text-left p-3.5 rounded-lg border transition-all group ${
                          isSelected
                            ? 'bg-purple-100/90 border-purple-500 ring-2 ring-purple-300 shadow-sm'
                            : isBusy
                            ? 'bg-gray-50 border-gray-100 opacity-50 cursor-not-allowed'
                            : 'bg-white border-purple-100 hover:border-purple-300 hover:bg-purple-50/40 hover:shadow-xs'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 flex-1">
                            <div
                              className={`w-4 h-4 rounded-full border flex items-center justify-center transition-all shrink-0 ${
                                isSelected
                                  ? 'border-purple-600 bg-purple-600 text-white'
                                  : 'border-purple-300 bg-white'
                              }`}
                            >
                              {isSelected && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                            </div>
                            <div className={`text-sm font-medium ${isSelected ? 'text-purple-950 font-semibold' : 'text-gray-900 group-hover:text-purple-900'}`}>
                              {opt.text}
                            </div>
                          </div>

                          {isBeingGenerated ? (
                            <span className="flex items-center gap-1 text-xs text-purple-700 font-medium shrink-0 ml-2">
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              推演中...
                            </span>
                          ) : isSelected ? (
                            <span className="text-[11px] text-purple-700 font-semibold bg-purple-200/80 px-2 py-0.5 rounded shrink-0 ml-2">
                              已选定方案
                            </span>
                          ) : null}
                        </div>

                        <div className="mt-2.5 grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[11px] pl-6">
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
                    );
                  })}
                </div>

                {/* Freeform input container (focused by user) */}
                <div id="story-freeform-container" className="border-t border-purple-200 pt-3 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <label htmlFor="story-freeform-input" className="font-semibold text-purple-900">
                      {selectedOptionId ? '补充方案执行细节（可选）' : '或者，直接写下你自己的行动方案'}
                    </label>
                    {isBusy && (
                      <span className="text-[11px] text-purple-600 font-normal flex items-center gap-1">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        AI 正在推演中...
                      </span>
                    )}
                  </div>
                  <textarea
                    id="story-freeform-input"
                    value={freeform}
                    disabled={isBusy}
                    onChange={(e) => setFreeform(e.target.value)}
                    placeholder={
                      isBusy
                        ? "大模型正在根据方案推演下一幕剧情，请稍候..."
                        : selectedOptionId
                        ? "已选择上方预设方案。如需追加限定条件或执行补充，可在此输入；然后点击【提交我的方案】"
                        : "描述你会怎么做，以及愿意承担什么代价，然后点击【提交我的方案】"
                    }
                    className="w-full min-h-20 rounded-lg border border-purple-200 bg-white p-2.5 text-xs text-gray-800 resize-y disabled:bg-purple-50/40 disabled:cursor-not-allowed disabled:text-gray-500 transition-colors"
                  />

                  {selectedOptionId && (
                    <div className="text-xs text-purple-800 bg-purple-100/70 px-3 py-1.5 rounded-lg flex items-center gap-1.5 border border-purple-200/80">
                      <Check className="w-3.5 h-3.5 text-purple-600 shrink-0" />
                      <span className="font-medium shrink-0">当前选定：</span>
                      <span className="truncate">{pendingChoice.options.find((o) => o.id === selectedOptionId)?.text}</span>
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-3 pt-1">
                    <button
                      id="story-freeform-submit"
                      type="button"
                      disabled={(!selectedOptionId && !freeform.trim()) || isBusy}
                      onClick={() => handleDecisionSubmit(pendingChoice.id)}
                      className="px-4 py-2 rounded-lg bg-purple-600 text-white text-xs disabled:opacity-40 disabled:cursor-not-allowed hover:bg-purple-700 transition flex items-center gap-1.5 font-medium shadow-xs"
                    >
                      {isBusy ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>正在推演方案中...</span>
                        </>
                      ) : (
                        <>
                          <Send className="w-3.5 h-3.5" />
                          <span>提交我的方案</span>
                        </>
                      )}
                    </button>

                    {!selectedOptionId && !freeform.trim() && !isBusy && (
                      <span className="text-[11px] text-purple-600/80">
                        请点击上方选项或输入自拟方案后提交
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {!pendingChoice && currentAct?.choices.length === 0 && !isCompleted && (
              <div id="story-continuation-box" className="bg-purple-50 rounded-xl p-5 border border-purple-200 space-y-3">
                <label htmlFor="story-continuation-input" className="text-xs font-semibold text-purple-900 flex items-center justify-between">
                  <span>继续你的推演方案</span>
                  {isBusy && (
                    <span className="text-[11px] text-purple-600 font-normal flex items-center gap-1">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      正在推演...
                    </span>
                  )}
                </label>
                <textarea
                  id="story-continuation-input"
                  value={freeform}
                  disabled={isBusy}
                  onChange={(e) => setFreeform(e.target.value)}
                  placeholder={isBusy ? "大模型正在推演下一轮情境，请稍候..." : "描述你会怎么做，以及愿意承担什么代价"}
                  className="w-full min-h-24 rounded-lg border border-purple-200 bg-white p-2.5 text-xs resize-y disabled:bg-purple-50/50 disabled:cursor-not-allowed"
                />
                <div className="flex gap-2">
                  <button
                    id="story-continuation-submit"
                    type="button"
                    disabled={!freeform.trim() || isBusy}
                    onClick={() => handleFreeformSubmit(freeform)}
                    className="px-3.5 py-2 rounded-lg bg-purple-600 text-white text-xs disabled:opacity-40 hover:bg-purple-700 transition flex items-center gap-1.5 font-medium"
                  >
                    {isBusy && pendingAction?.type === 'freeform' ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>正在生成下一轮推演...</span>
                      </>
                    ) : (
                      <span>继续推进</span>
                    )}
                  </button>
                  <button
                    id="story-continuation-end"
                    type="button"
                    disabled={isBusy}
                    onClick={handleEndEarlyClick}
                    className="px-3 py-2 rounded-lg border border-purple-200 text-purple-700 text-xs hover:bg-purple-100/50 disabled:opacity-40 transition"
                  >
                    结束并复盘
                  </button>
                </div>
              </div>
            )}

            {/* Act finished and ready to advance */}
            {!pendingChoice && currentAct?.choices.length > 0 && storyRun.currentActIndex < storyRun.acts.length && (
              <div className="text-center py-4">
                <button
                  id="story-advance-btn"
                  disabled={isBusy}
                  onClick={handleCompleteClick}
                  className="px-6 py-2.5 rounded-lg bg-purple-600 text-white text-sm font-medium hover:bg-purple-700 shadow-sm disabled:opacity-60 flex items-center gap-2 mx-auto transition"
                >
                  {isBusy ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>正在推演并进入下一幕...</span>
                    </>
                  ) : (
                    <span>进入下一幕推演 →</span>
                  )}
                </button>
              </div>
            )}

            {/* Final act finished and ready to complete */}
            {!pendingChoice && storyRun.currentActIndex === storyRun.acts.length && currentAct?.choices.length > 0 && (
              <div className="text-center py-4">
                <button
                  id="story-final-outcome-btn"
                  disabled={isBusy}
                  onClick={handleCompleteClick}
                  className="px-6 py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 shadow-sm disabled:opacity-60 flex items-center gap-2 mx-auto transition"
                >
                  {isBusy ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>正在生成最终结局与思维复盘...</span>
                    </>
                  ) : (
                    <span>生成最终结局与推演反思 ✓</span>
                  )}
                </button>
              </div>
            )}
            {!pendingChoice && currentAct?.choices.length === 0 && !isCompleted && (
              <div className="text-center py-4">
                <button
                  id="story-summary-btn"
                  disabled={isBusy}
                  onClick={handleCompleteClick}
                  className="px-5 py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 shadow-sm disabled:opacity-60 flex items-center gap-2 mx-auto transition"
                >
                  {isBusy ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>正在生成思维复盘...</span>
                    </>
                  ) : (
                    <span>结束本轮并生成思维复盘</span>
                  )}
                </button>
              </div>
            )}
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
                id="story-bridge-btn"
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
              id="story-return-regular-btn"
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
