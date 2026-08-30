'use client';

import { useState } from 'react';
import type { Viewpoint } from '@/lib/providers';

interface StanceSelectorProps {
  viewpoints: string[];
  onSelect: (viewpoint: Viewpoint) => void;
  onCustom: (text: string) => void;
}

export default function StanceSelector({ viewpoints, onSelect, onCustom }: StanceSelectorProps) {
  const [customText, setCustomText] = useState('');
  return (
    <div className="p-6 border-b">
      <h3 className="font-semibold mb-4">选择一个观点，或输入你自己的看法</h3>
      <div className="space-y-2 mb-4">
        {viewpoints.slice(0, 3).map((vp, i) => (
          <button
            key={i}
            onClick={() => onSelect({ id: `v${i}`, text: vp, source: 'ai_authored' })}
            className="w-full text-left p-3 border rounded-lg hover:border-blue-500 hover:bg-blue-50 text-sm"
          >
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
    </div>
  );
}
