'use client';

import { useState } from 'react';
import type { Viewpoint } from '@/lib/providers';
import type { QuickTargetId, SessionMode } from '@/lib/mode-config';
import { CHARACTERS, adaptViewpointsForCharacter, type CharacterId } from '@/lib/character';
import { STORY_WORLDS, type StoryWorldId } from '@/lib/story-run';

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
    <div className="p-6 border-b" data-testid="stance-selector">
      {/* Mode selection (#Q-01, #D-01, #F-01, #G-01) */}
      <div className="mb-5 pb-5 border-b border-gray-100" data-testid="mode-selector">
        <label className="block text-xs font-semibold text-gray-700 mb-2">思辨模式：</label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <button
            type="button"
            onClick={() => setMode('quick')}
            className={`p-2.5 rounded-lg border text-left transition-colors ${
              mode === 'quick'
                ? 'border-blue-500 bg-blue-50/50 text-blue-900 font-medium'
                : 'border-gray-200 hover:border-gray-300 text-gray-700'
            }`}
          >
            <div className="text-xs font-semibold">快速思辨</div>
            <div className="text-[10px] text-gray-500 mt-0.5">3轮以内明确立场</div>
          </button>
          <button
            type="button"
            onClick={() => setMode('deep')}
            className={`p-2.5 rounded-lg border text-left transition-colors ${
              mode === 'deep'
                ? 'border-indigo-500 bg-indigo-50/50 text-indigo-900 font-medium'
                : 'border-gray-200 hover:border-gray-300 text-gray-700'
            }`}
          >
            <div className="text-xs font-semibold">深度思辨</div>
            <div className="text-[10px] text-gray-500 mt-0.5">8策略全量认知轨迹</div>
          </button>
          <button
            type="button"
            onClick={() => setMode('fun')}
            className={`p-2.5 rounded-lg border text-left transition-colors ${
              mode === 'fun'
                ? 'border-emerald-500 bg-emerald-50/50 text-emerald-900 font-medium'
                : 'border-gray-200 hover:border-gray-300 text-gray-700'
            }`}
          >
            <div className="text-xs font-semibold">趣味思辨</div>
            <div className="text-[10px] text-gray-500 mt-0.5">拟人化辩友陪伴</div>
          </button>
          <button
            type="button"
            onClick={() => setMode('story')}
            className={`p-2.5 rounded-lg border text-left transition-colors ${
              mode === 'story'
                ? 'border-purple-500 bg-purple-50/50 text-purple-900 font-medium'
                : 'border-gray-200 hover:border-gray-300 text-gray-700'
            }`}
          >
            <div className="text-xs font-semibold">推演剧本</div>
            <div className="text-[10px] text-gray-500 mt-0.5">GalGame沉浸推演</div>
          </button>
        </div>

        {/* Sub-config options for chosen mode */}
        {mode === 'quick' && (
          <div className="mt-3 flex items-center gap-2 text-xs">
            <span className="text-gray-500 text-[11px]">快速导向：</span>
            {[
              { id: 'clarify_position', label: '明确立场' },
              { id: 'weigh_decision', label: '权衡决策' },
              { id: 'refine_expression', label: '提炼表达' },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTarget(t.id as QuickTargetId)}
                className={`px-2.5 py-1 rounded text-xs border ${
                  target === t.id
                    ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        {mode === 'fun' && (
          <div className="mt-3 flex items-center gap-2 text-xs">
            <span className="text-gray-500 text-[11px]">陪伴辩友：</span>
            {Object.values(CHARACTERS).map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCharacter(c.id)}
                className={`px-2.5 py-1 rounded text-xs border ${
                  character === c.id
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-700 font-medium'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}

        {mode === 'story' && (
          <div className="mt-3 flex items-center gap-2 text-xs">
            <span className="text-gray-500 text-[11px]">推演世界：</span>
            {Object.values(STORY_WORLDS).map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={() => setWorld(w.id)}
                className={`px-2.5 py-1 rounded text-xs border ${
                  world === w.id
                    ? 'border-purple-500 bg-purple-50 text-purple-700 font-medium'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                }`}
              >
                {w.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <h3 className="font-semibold mb-2">选择一个起始观点，或输入你自己的看法</h3>
      <p className="text-xs text-gray-500 mb-4">
        AI 建议是可质疑的起点，不是结论；你也可以跳过并直接输入。
      </p>

      <div className="space-y-2 mb-4" data-testid="stance-options">
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
            className="w-full text-left p-3 border rounded-lg hover:border-blue-500 hover:bg-blue-50 text-sm transition-colors"
          >
            <span className="inline-block px-1.5 py-0.5 text-[10px] rounded bg-blue-50 text-blue-600 mr-2 align-middle font-medium">
              AI 建议
            </span>
            {vp.text}
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={customText}
          onChange={(e) => setCustomText(e.target.value)}
          placeholder="或直接输入你的观点..."
          className="flex-1 p-2 border rounded-lg text-sm"
          onKeyDown={(e) => e.key === 'Enter' && customText.trim() && handleCustom(customText.trim())}
        />
        <button
          onClick={() => customText.trim() && handleCustom(customText.trim())}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
        >
          使用
        </button>
      </div>

      <div className="mt-8 pt-6 border-t border-gray-100">
        <div className="bg-blue-50/60 rounded-xl p-5 border border-blue-100/80 text-xs text-gray-600 leading-relaxed space-y-2.5">
          <p className="font-semibold text-blue-900 text-sm flex items-center gap-1.5">
            <span>💡</span> 为什么要选择切入观点？
          </p>
          <p className="text-gray-700">
            知研思辨引擎将围绕你选择的切入点展开温和的多角度推演，协助你：
          </p>
          <ul className="list-disc list-inside space-y-1.5 text-gray-600 pl-1">
            <li>厘清结论背后的关键前提与假设</li>
            <li>检验支撑论据的有效性与适用边界</li>
            <li>发现不同视角的反思与洞见，形成更周密的个人判断</li>
          </ul>
          <p className="text-gray-500 pt-1">
            思辨过程循序渐进，每次只聚焦一个清晰的思考维度。你随时可以在思辨过程中补充或修正你的看法。
          </p>
        </div>
      </div>
    </div>
  );
}
