'use client';

import { useState } from 'react';
import type { Viewpoint } from '@/lib/providers';
import type { QuickTargetId, SessionMode } from '@/lib/mode-config';
import { CHARACTERS, adaptViewpointsForCharacter, type CharacterId } from '@/lib/character';
import { STORY_WORLDS, type StoryWorldId } from '@/lib/story-run';
import { Lightbulb, Send, Compass, Sparkles, BookOpen, Layers } from 'lucide-react';

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
            onClick={() => setMode('story')}
            className={`p-3 rounded-xl border text-left transition-all ${
              mode === 'story'
                ? 'border-brand bg-brand-light text-brand font-medium shadow-xs ring-1 ring-brand/30'
                : 'border-line bg-surface hover:bg-surface-subtle hover:border-line-strong text-content-primary'
            }`}
          >
            <div className="text-xs font-bold font-serif">推演剧本</div>
            <div className="text-[10px] text-content-tertiary mt-0.5">GalGame沉浸推演</div>
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
          <div className="mt-3 flex items-center gap-2 text-xs flex-wrap">
            <span className="text-content-tertiary text-[11px]">推演世界：</span>
            {Object.values(STORY_WORLDS).map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={() => setWorld(w.id)}
                className={`px-2.5 py-1 rounded-lg text-xs border transition-colors ${
                  world === w.id
                    ? 'border-brand bg-brand-light text-brand font-medium'
                    : 'border-line bg-surface text-content-secondary hover:border-line-strong'
                }`}
              >
                {w.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <h3 className="font-bold text-sm sm:text-base text-brand font-serif mb-1">
        选择一个起始观点，或输入你自己的看法
      </h3>
      <p className="text-xs text-content-secondary mb-4 leading-relaxed">
        AI 建议是可质疑的起点，不是结论；你也可以跳过并直接输入。
      </p>

      <div className="space-y-2.5 mb-4" data-testid="stance-options">
        {displayList.map((vp) => (
          <button
            key={vp.id}
            onClick={() =>
              handleSelect({
                ...vp,
                source: 'ai_suggested_and_selected',
                selectedAt: Date.now(),
              })
            }
            data-testid="stance-option"
            className="w-full text-left p-3.5 border border-line rounded-xl hover:border-line-strong hover:bg-surface-subtle bg-surface text-xs sm:text-sm text-content-primary transition-all flex items-start gap-2.5 shadow-2xs group"
          >
            <span className="inline-block px-2 py-0.5 text-[10px] rounded-md bg-brand-light text-brand border border-brand-subtle font-mono font-medium shrink-0 mt-0.5">
              AI 建议
            </span>
            <span className="leading-relaxed group-hover:text-brand font-medium">
              {vp.text}
            </span>
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={customText}
          onChange={(e) => setCustomText(e.target.value)}
          placeholder="或直接输入你的观点..."
          className="flex-1 px-3.5 py-2.5 border border-line bg-surface rounded-xl text-xs sm:text-sm text-content-primary placeholder:text-content-tertiary focus:ring-2 focus:ring-brand/20 focus:border-brand outline-none transition-all"
          onKeyDown={(e) => e.key === 'Enter' && customText.trim() && handleCustom(customText.trim())}
        />
        <button
          onClick={() => customText.trim() && handleCustom(customText.trim())}
          className="px-4 py-2.5 bg-brand hover:bg-brand-hover text-content-inverse rounded-xl text-xs sm:text-sm font-medium shadow-xs transition-all active:scale-[0.98] shrink-0"
        >
          使用
        </button>
      </div>

      <div className="mt-6 pt-5 border-t border-line">
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
      </div>
    </div>
  );
}
