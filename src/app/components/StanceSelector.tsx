'use client';

import { useState } from 'react';
import type { Viewpoint } from '@/lib/providers';

interface StanceSelectorProps {
  viewpoints: string[];
  /** Structured viewpoints with provenance (preferred when provided) */
  structuredViewpoints?: Viewpoint[];
  onSelect: (viewpoint: Viewpoint) => void;
  onCustom: (text: string) => void;
}

export default function StanceSelector({
  viewpoints,
  structuredViewpoints,
  onSelect,
  onCustom,
}: StanceSelectorProps) {
  const [customText, setCustomText] = useState('');

  // Prefer structured viewpoints when available
  const hasStructured = structuredViewpoints && structuredViewpoints.length > 0;

  return (
    <div className="p-6 border-b" data-testid="stance-selector">
      <h3 className="font-semibold mb-2">选择一个观点，或输入你自己的看法</h3>
      <p className="text-xs text-gray-500 mb-4">
        三个 AI 建议提供不同切入角度；你也可以跳过并直接输入。
      </p>

      <div className="space-y-2 mb-4" data-testid="stance-options">
        {hasStructured
          ? structuredViewpoints!.map((vp) => (
              <button
                key={vp.id}
                onClick={() =>
                  onSelect({
                    ...vp,
                    source: 'ai_suggested_and_selected',
                    selectedAt: Date.now(),
                  })
                }
                data-testid="stance-option"
                className="w-full text-left p-3 border rounded-lg hover:border-blue-500 hover:bg-blue-50 text-sm"
              >
                <span className="inline-block px-1.5 py-0.5 text-[10px] rounded bg-blue-50 text-blue-600 mr-2 align-middle">
                  AI 建议
                </span>
                {vp.text}
              </button>
            ))
          : viewpoints.slice(0, 3).map((vp, i) => (
              <button
                key={i}
                onClick={() =>
                  onSelect({
                    id: `v${i}`,
                    text: vp,
                    source: 'ai_suggested_and_selected',
                    selectedAt: Date.now(),
                  })
                }
                data-testid="stance-option"
                className="w-full text-left p-3 border rounded-lg hover:border-blue-500 hover:bg-blue-50 text-sm"
              >
                <span className="inline-block px-1.5 py-0.5 text-[10px] rounded bg-blue-50 text-blue-600 mr-2 align-middle">
                  AI 建议
                </span>
                {vp}
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
          onKeyDown={(e) => e.key === 'Enter' && customText.trim() && onCustom(customText.trim())}
        />
        <button
          onClick={() => customText.trim() && onCustom(customText.trim())}
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
