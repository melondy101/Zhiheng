'use client';

import { useState } from 'react';
import type { KnowledgeGraph, GraphNode, GraphEdge } from '@/lib/knowledge-graph';

interface KnowledgeGraphViewProps {
  graph: KnowledgeGraph | null;
  isLoading?: boolean;
}

const EDGE_COLORS: Record<string, string> = {
  supported: '#10b981',     // green
  inferred: '#f59e0b',      // amber
  user_claimed: '#3b82f6',  // blue
};

const EDGE_LABELS: Record<string, string> = {
  supported: '引用支持',
  inferred: 'AI 推断',
  user_claimed: '用户主张',
};

export default function KnowledgeGraphView({ graph, isLoading }: KnowledgeGraphViewProps) {
  const [selected, setSelected] = useState<{ node: GraphNode; edge?: GraphEdge } | null>(null);

  if (isLoading || !graph) {
    return (
      <div className="bg-white rounded-lg border p-6 mb-4">
        <h3 className="font-semibold mb-3 text-purple-600">🕸️ 知识图谱</h3>
        <p className="text-sm text-gray-500">知识图谱生成中…</p>
      </div>
    );
  }

  if (graph.nodes.length === 0) {
    return null;
  }

  return (
    <div className="bg-white rounded-lg border p-6 mb-4">
      <h3 className="font-semibold mb-3 text-purple-600">🕸️ 知识图谱</h3>

      {/* Legend */}
      <div className="flex gap-3 text-xs mb-4 flex-wrap">
        {Object.entries(EDGE_LABELS).map(([type, label]) => (
          <div key={type} className="flex items-center gap-1">
            <span
              className="inline-block w-3 h-3 rounded-full"
              style={{ backgroundColor: EDGE_COLORS[type] }}
            />
            <span>{label}</span>
          </div>
        ))}
      </div>

      {/* Node list (simple list-based rendering; avoids SVG layout complexity) */}
      <div className="space-y-2">
        {graph.nodes.map((node) => {
          const outgoing = graph.edges.filter((e) => e.from === node.id);
          return (
            <div
              key={node.id}
              className="border rounded p-3 cursor-pointer hover:bg-gray-50"
              onClick={() => setSelected({ node })}
            >
              <div className="font-medium text-sm">{node.label}</div>
              {outgoing.length > 0 && (
                <div className="text-xs text-gray-500 mt-1">
                  {outgoing.map((e) => {
                    const target = graph.nodes.find((n) => n.id === e.to);
                    return (
                      <span key={e.id} className="mr-2">
                        <span
                          className="inline-block w-2 h-2 rounded-full mr-1"
                          style={{ backgroundColor: EDGE_COLORS[e.type] }}
                        />
                        {e.label} → {target?.label ?? '?'}
                        {e.type === 'supported' && e.citationId && (
                          <span className="ml-1 text-blue-600">[{e.citationId}]</span>
                        )}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Detail panel */}
      {selected && (
        <div className="mt-4 p-3 bg-gray-50 rounded text-sm">
          <div className="flex justify-between items-start">
            <div>
              <div className="font-medium">{selected.node.label}</div>
              <div className="text-gray-600 mt-1">{selected.node.description}</div>
              {selected.node.sourceCitations && selected.node.sourceCitations.length > 0 && (
                <div className="text-xs text-blue-600 mt-1">
                  引用: {selected.node.sourceCitations.map((c) => `[${c}]`).join(', ')}
                </div>
              )}
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setSelected(null);
              }}
              className="text-gray-400 hover:text-gray-600"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
