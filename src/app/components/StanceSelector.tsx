'use client';

import { useState } from 'react';
import type { Viewpoint } from '@/lib/providers';
import type { QuickTargetId, SessionMode } from '@/lib/mode-config';
import { CHARACTERS, adaptViewpointsForCharacter, type CharacterId } from '@/lib/character';
import { STORY_WORLDS, type StoryWorldId } from '@/lib/story-run';
import { Lightbulb, Send, Compass, Sparkles, BookOpen, Layers, Gamepad2, Check } from 'lucide-react';

interface StanceSelectorProps {
  viewpoints: string[];
  /** Structured viewpoints with provenance (preferred when provided) */
  structuredViewpoints?: Viewpoint[];
  onSelect: (
    viewpoint: Viewpoint,
    mode?: SessionMode,
    target?: QuickTargetId,
    character?: CharacterId,
    world?: StoryWorldId
  ) => void;
  onCustom: (
    text: string,
    mode?: SessionMode,
    target?: QuickTargetId,
    character?: CharacterId,
    world?: StoryWorldId
  ) => void;
}

export default function StanceSelector({
  viewpoints,
  structuredViewpoints,
  onSelect,
  onCustom,
}: StanceSelectorProps) {
  const [customText, setCustomText] = useState('');
  const [mode, setMode] = useState<SessionMode>('quick');
  const [target, setTarget] = useState<QuickTargetId>('clarify_position');
  const [character, setCharacter] = useState<CharacterId>('relaxed_friend');
  const [world, setWorld] = useState<StoryWorldId>('future_city');
  const [selectedVpId, setSelectedVpId] = useState<string | null>(null);

  // Prefer structured viewpoints when available
  const hasStructured = structuredViewpoints && structuredViewpoints.length > 0;
  const rawList: Viewpoint[] = hasStructured
    ? structuredViewpoints!
    : viewpoints.slice(0, 3).map((vp, i) => ({
        id: `v${i}`,
        text: vp,
        source: 'ai_authored' as const,
      }));

  const displayList: Viewpoint[] =
    mode === 'fun' ? adaptViewpointsForCharacter(rawList, character) : rawList;

  const handleSelect = (vp: Viewpoint) => {
    onSelect(vp, mode, target, character, world);
  };

  const handleCustom = (text: string) => {
    onCustom(text, mode, target, character, world);
  };

  const selectedVp = displayList.find((v) => v.id === selectedVpId);

  const handleCardClick = (vp: Viewpoint) => {
    if (mode === 'story') {
      if (selectedVpId === vp.id) {
        // Double-clicking or clicking when already selected launches game
        handleSelect({
          ...vp,
          source: 'ai_suggested_and_selected',
          selectedAt: Date.now(),
        });
      } else {
        setSelectedVpId(vp.id);
        setCustomText('');
      }
    } else {
      handleSelect({
        ...vp,
        source: 'ai_suggested_and_selected',
        selectedAt: Date.now(),
      });
    }
  };

  return (
    <div className="p-4 sm:p-6 border-b border-line bg-surface-elevated text-content-primary" data-testid="stance-selector">
      {/* Mode selection (#Q-01, #D-01, #F-01, #G-01) */}
      <div className="mb-5 pb-5 border-b border-line" data-testid="mode-selector">
        <label className="block text-xs font-semibold text-content-secondary uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
          <Compass className="w-3.5 h-3.5 text-accent" />
          <span>思辨模式：</span>
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <button
            type="button"
            onClick={() => setMode('quick')}
            className={`p-3 rounded-xl border text-left transition-all ${
              mode === 'quick'
                ? 'border-brand bg-brand-light text-brand font-medium shadow-xs ring-1 ring-brand/30'
                : 'border-line bg-surface hover:bg-surface-subtle hover:border-line-strong text-content-primary'
            }`}
          >
            <div className="text-xs font-bold font-serif">快速思辨</div>
            <div className="text-[10px] text-content-tertiary mt-0.5">3轮以内明确立场</div>
          </button>
          <button
            type="button"
            onClick={() => setMode('deep')}
            className={`p-3 rounded-xl border text-left transition-all ${
              mode === 'deep'
                ? 'border-brand bg-brand-light text-brand font-medium shadow-xs ring-1 ring-brand/30'
                : 'border-line bg-surface hover:bg-surface-subtle hover:border-line-strong text-content-primary'
            }`}
          >
            <div className="text-xs font-bold font-serif">深度思辨</div>
            <div className="text-[10px] text-content-tertiary mt-0.5">8策略全量认知轨迹</div>
          </button>
          <button
            type="button"
            onClick={() => setMode('fun')}
            className={`p-3 rounded-xl border text-left transition-all ${
              mode === 'fun'
                ? 'border-brand bg-brand-light text-brand font-medium shadow-xs ring-1 ring-brand/30'
                : 'border-line bg-surface hover:bg-surface-subtle hover:border-line-strong text-content-primary'
            }`}
          >
            <div className="text-xs font-bold font-serif">趣味思辨</div>
            <div className="text-[10px] text-content-tertiary mt-0.5">拟人化辩友陪伴</div>
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('story');
              if (!selectedVpId && displayList.length > 0) {
                setSelectedVpId(displayList[0].id);
              }
            }}
            className={`p-3 rounded-xl border text-left transition-all ${
              mode === 'story'
                ? 'border-purple-500 bg-purple-50/90 text-purple-900 font-medium shadow-xs ring-2 ring-purple-300'
                : 'border-line bg-surface hover:bg-surface-subtle hover:border-line-strong text-content-primary'
            }`}
          >
            <div className="text-xs font-bold font-serif flex items-center gap-1.5">
              <Gamepad2 className={`w-3.5 h-3.5 ${mode === 'story' ? 'text-purple-600' : 'text-content-tertiary'}`} />
              <span>推演剧本</span>
            </div>
            <div className={`text-[10px] mt-0.5 ${mode === 'story' ? 'text-purple-700 font-medium' : 'text-content-tertiary'}`}>
              GalGame沉浸推演
            </div>
          </button>
        </div>

        {/* Sub-config options for chosen mode */}
        {mode === 'quick' && (
          <div className="mt-3 flex items-center gap-2 text-xs flex-wrap">
            <span className="text-content-tertiary text-[11px]">快速导向：</span>
            {[
              { id: 'clarify_position', label: '明确立场' },
              { id: 'weigh_decision', label: '权衡决策' },
              { id: 'refine_expression', label: '提炼表达' },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTarget(t.id as QuickTargetId)}
                className={`px-2.5 py-1 rounded-lg text-xs border transition-colors ${
                  target === t.id
                    ? 'border-brand bg-brand-light text-brand font-medium'
                    : 'border-line bg-surface text-content-secondary hover:border-line-strong'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        {mode === 'fun' && (
          <div className="mt-3 flex items-center gap-2 text-xs flex-wrap">
            <span className="text-content-tertiary text-[11px]">陪伴辩友：</span>
            {Object.values(CHARACTERS).map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCharacter(c.id)}
                className={`px-2.5 py-1 rounded-lg text-xs border transition-colors ${
                  character === c.id
                    ? 'border-brand bg-brand-light text-brand font-medium'
                    : 'border-line bg-surface text-content-secondary hover:border-line-strong'
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}

        {mode === 'story' && (
          <div className="mt-3 p-3 rounded-xl bg-purple-50/70 border border-purple-200/80 flex items-center gap-2 text-xs flex-wrap">
            <span className="text-purple-900 font-semibold text-[11px] flex items-center gap-1 shrink-0">
              <Gamepad2 className="w-3.5 h-3.5 text-purple-600" />
              推演世界：
            </span>
            {Object.values(STORY_WORLDS).map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={() => setWorld(w.id)}
                className={`px-2.5 py-1 rounded-lg text-xs border transition-all ${
                  world === w.id
                    ? 'border-purple-600 bg-purple-600 text-white font-medium shadow-xs ring-1 ring-purple-300'
                    : 'border-purple-200 bg-white/80 text-purple-800 hover:bg-purple-100 hover:border-purple-300'
                }`}
              >
                <span className="mr-1 opacity-70">{w.theme}</span>
                {w.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <h3
        className={`font-bold text-sm sm:text-base font-serif mb-1 flex items-center gap-1.5 ${
          mode === 'story' ? 'text-purple-900' : 'text-brand'
        }`}
      >
        {mode === 'story' ? (
          <>
            <Compass className="w-4 h-4 text-purple-600 shrink-0" />
            <span>选择你的剧情起始点，或设定开局立场</span>
          </>
        ) : (
          <span>选择一个起始观点，或输入你自己的看法</span>
        )}
      </h3>
      <p className={`text-xs mb-4 leading-relaxed ${mode === 'story' ? 'text-purple-700/80' : 'text-content-secondary'}`}>
        {mode === 'story'
          ? '推演将从所选起始点展开，决定你初始面临的阵营博弈与世界线起点；AI 建议是可推翻的开局情境。'
          : 'AI 建议是可质疑的起点，不是结论；你也可以跳过并直接输入。'}
      </p>

      <div className="space-y-2.5 mb-4" data-testid="stance-options">
        {displayList.map((vp) => {
          const isSelectedInStory = mode === 'story' && selectedVpId === vp.id;
          return (
            <button
              key={vp.id}
              onClick={() => handleCardClick(vp)}
              data-testid="stance-option"
              className={`w-full text-left p-3.5 rounded-xl transition-all flex items-start gap-2.5 shadow-2xs group border ${
                mode === 'story'
                  ? isSelectedInStory
                    ? 'border-purple-500 bg-purple-50/90 ring-2 ring-purple-300 shadow-sm text-purple-950'
                    : 'border-purple-100 hover:border-purple-300 hover:bg-purple-50/40 bg-surface text-content-primary'
                  : 'border-line rounded-xl hover:border-line-strong hover:bg-surface-subtle bg-surface text-content-primary'
              }`}
            >
              {mode === 'story' ? (
                <div className="flex items-center gap-2 shrink-0 mt-0.5">
                  <div
                    className={`w-4 h-4 rounded-full border flex items-center justify-center transition-all ${
                      isSelectedInStory
                        ? 'border-purple-600 bg-purple-600 text-white'
                        : 'border-purple-300 bg-white'
                    }`}
                  >
                    {isSelectedInStory && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                  </div>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-md bg-purple-100 text-purple-800 border border-purple-200 font-mono font-medium">
                    <Sparkles className="w-2.5 h-2.5" />
                    剧情起始点
                  </span>
                </div>
              ) : (
                <span className="inline-block px-2 py-0.5 text-[10px] rounded-md bg-brand-light text-brand border border-brand-subtle font-mono font-medium shrink-0 mt-0.5">
                  AI 建议
                </span>
              )}

              <span
                className={`leading-relaxed flex-1 text-xs sm:text-sm font-medium ${
                  mode === 'story'
                    ? isSelectedInStory
                      ? 'text-purple-950 font-semibold'
                      : 'group-hover:text-purple-800'
                    : 'group-hover:text-brand'
                }`}
              >
                {vp.text}
              </span>

              {mode === 'story' && isSelectedInStory && (
                <span className="hidden sm:inline-flex items-center gap-1 text-[11px] text-purple-700 font-semibold bg-purple-100/90 px-2 py-0.5 rounded-md shrink-0">
                  已选定起始点
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={customText}
          onChange={(e) => {
            setCustomText(e.target.value);
            if (e.target.value.trim()) setSelectedVpId(null);
          }}
          placeholder={mode === 'story' ? '或输入自定义剧情起始设定 / 开局角色主张...' : '或直接输入你的观点...'}
          className={`flex-1 px-3.5 py-2.5 border rounded-xl text-xs sm:text-sm text-content-primary placeholder:text-content-tertiary outline-none transition-all ${
            mode === 'story'
              ? 'border-purple-200 bg-surface focus:ring-2 focus:ring-purple-300 focus:border-purple-500'
              : 'border-line bg-surface focus:ring-2 focus:ring-brand/20 focus:border-brand'
          }`}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              if (customText.trim()) handleCustom(customText.trim());
              else if (mode === 'story' && selectedVp) handleSelect(selectedVp);
            }
          }}
        />
        <button
          onClick={() => {
            if (customText.trim()) {
              handleCustom(customText.trim());
            } else if (mode === 'story' && selectedVp) {
              handleSelect(selectedVp);
            }
          }}
          disabled={mode === 'story' ? !customText.trim() && !selectedVp : !customText.trim()}
          className={`px-5 py-2.5 rounded-xl text-xs sm:text-sm font-medium shadow-xs transition-all active:scale-[0.98] shrink-0 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 ${
            mode === 'story'
              ? 'bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-semibold shadow-sm'
              : 'bg-brand hover:bg-brand-hover text-content-inverse'
          }`}
        >
          {mode === 'story' ? (
            <>
              <Gamepad2 className="w-4 h-4" />
              <span>开始游戏</span>
            </>
          ) : (
            '使用'
          )}
        </button>
      </div>

      <div className="mt-6 pt-5 border-t border-line">
        {mode === 'story' ? (
          <div className="bg-gradient-to-br from-purple-50/80 to-indigo-50/50 rounded-2xl p-5 border border-purple-200 text-xs text-purple-900 leading-relaxed space-y-2.5 shadow-xs">
            <p className="font-bold text-purple-900 font-serif text-xs sm:text-sm flex items-center gap-1.5">
              <Gamepad2 className="w-4 h-4 text-purple-600" />
              <span>剧情推演模式（推演剧本）玩法说明</span>
            </p>
            <p className="text-purple-800">
              知研将研报事实沉浸式转化为推演剧本，带你化身决策者亲历世界线变化：
            </p>
            <ul className="list-disc list-inside space-y-1.5 text-purple-800/90 pl-1">
              <li><strong>设定开局起始点</strong>：选择或输入你的初始立场与破局策略，直面阵营博弈；</li>
              <li><strong>动态推演交互</strong>：在每一幕关键决断中自拟方案或挑选行动，大模型将实时推演多方反弹与连锁代价；</li>
              <li><strong>决策复盘与思维画像</strong>：沉浸体验结束后，生成属于你的决策复盘报告与性格雷达。</li>
            </ul>
          </div>
        ) : (
          <div className="bg-surface rounded-2xl p-5 border border-line text-xs text-content-secondary leading-relaxed space-y-2.5 shadow-xs">
            <p className="font-bold text-brand font-serif text-xs sm:text-sm flex items-center gap-1.5">
              <Lightbulb className="w-4 h-4 text-accent" />
              <span>为什么要选择切入观点？</span>
            </p>
            <p className="text-content-secondary">
              知研思辨引擎将围绕你选择的切入点展开温和的多角度推演，协助你：
            </p>
            <ul className="list-disc list-inside space-y-1.5 text-content-secondary pl-1">
              <li>厘清结论背后的关键前提与假设</li>
              <li>检验支撑论据的有效性与适用边界</li>
              <li>发现不同视角的反思与洞见，形成更周密的个人判断</li>
            </ul>
            <p className="text-content-tertiary pt-1">
              思辨过程循序渐进，每次只聚焦一个清晰的思考维度。你随时可以在思辨过程中补充或修正你的看法。
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
