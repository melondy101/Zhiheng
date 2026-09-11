'use client';

import React, { useState, useMemo, useId } from 'react';
import type { KnowledgeGraph, GraphNode, GraphEdge, GraphNodeType, GraphEdgeType } from '@/lib/knowledge-graph';

interface KnowledgeGraphViewProps {
  graph: KnowledgeGraph | null;
  isLoading?: boolean;
  onCitationClick?: (citationId: number) => void;
}

const NODE_TYPE_LABELS: Record<GraphNodeType, string> = {
  topic: '核心议题',
  concept: '关键概念',
  claim: '主要观点',
  actor: '行动主体',
};

const NODE_TYPE_COLORS: Record<GraphNodeType, { fill: string; stroke: string; text: string; badgeBg: string; badgeText: string }> = {
  topic: { fill: '#f3e8ff', stroke: '#9333ea', text: '#581c87', badgeBg: 'bg-purple-100', badgeText: 'text-purple-800' },
  concept: { fill: '#eff6ff', stroke: '#3b82f6', text: '#1e40af', badgeBg: 'bg-blue-100', badgeText: 'text-blue-800' },
  claim: { fill: '#ecfdf5', stroke: '#10b981', text: '#065f46', badgeBg: 'bg-emerald-100', badgeText: 'text-emerald-800' },
  actor: { fill: '#fffbeb', stroke: '#f59e0b', text: '#92400e', badgeBg: 'bg-amber-100', badgeText: 'text-amber-800' },
};

const EDGE_COLORS: Record<GraphEdgeType, string> = {
  supported: '#10b981',     // green
  inferred: '#f59e0b',      // amber
  user_claimed: '#3b82f6',  // blue
};

const EDGE_LABELS: Record<GraphEdgeType, string> = {
  supported: '引用支持',
  inferred: 'AI 推断',
  user_claimed: '用户主张',
};

const EDGE_DASH: Record<GraphEdgeType, string | undefined> = {
  supported: undefined,
  inferred: '5 4',
  user_claimed: '3 3',
};

interface PositionedNode {
  node: GraphNode;
  x: number;
  y: number;
  radius: number;
  type: GraphNodeType;
}

/**
 * Deterministic force-directed layout computation.
 * Pure function with no external random numbers or side effects.
 */
function computeForceLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  width = 640,
  height = 380
): Record<string, { x: number; y: number; radius: number; type: GraphNodeType }> {
  if (nodes.length === 0) return {};

  const cx = width / 2;
  const cy = height / 2;
  const positions: Record<string, { x: number; y: number; vx: number; vy: number; radius: number; type: GraphNodeType }> = {};

  // Initial circular positioning with topic at center
  nodes.forEach((n, idx) => {
    const type = n.type || (idx === 0 ? 'topic' : 'concept');
    const radius = type === 'topic' ? 28 : 20;

    if (type === 'topic' || idx === 0) {
      positions[n.id] = { x: cx, y: cy, vx: 0, vy: 0, radius, type };
    } else {
      const otherCount = Math.max(1, nodes.length - 1);
      const angle = ((idx - 1) / otherCount) * 2 * Math.PI - Math.PI / 2;
      const initialDist = 120 + ((idx % 2) * 25);
      positions[n.id] = {
        x: cx + Math.cos(angle) * initialDist,
        y: cy + Math.sin(angle) * initialDist,
        vx: 0,
        vy: 0,
        radius,
        type,
      };
    }
  });

  // Run 60 simulation steps
  const iterations = 60;
  const k = Math.sqrt((width * height) / Math.max(nodes.length, 1)) * 0.75;

  for (let step = 0; step < iterations; step++) {
    // 1. Repulsion between all node pairs
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const u = positions[nodes[i].id];
        const v = positions[nodes[j].id];
        let dx = u.x - v.x;
        let dy = u.y - v.y;
        let dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 1) {
          dx = (i * 7) % 5 + 1;
          dy = (j * 11) % 5 + 1;
          dist = Math.sqrt(dx * dx + dy * dy);
        }
        const force = (k * k) / dist;
        const fx = (dx / dist) * force * 0.05;
        const fy = (dy / dist) * force * 0.05;
        u.vx += fx;
        u.vy += fy;
        v.vx -= fx;
        v.vy -= fy;
      }
    }

    // 2. Attraction along edges
    for (const e of edges) {
      const u = positions[e.from];
      const v = positions[e.to];
      if (!u || !v) continue;
      const dx = v.x - u.x;
      const dy = v.y - u.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 1) continue;
      const force = (dist * dist) / k;
      const fx = (dx / dist) * force * 0.04;
      const fy = (dy / dist) * force * 0.04;
      u.vx += fx;
      u.vy += fy;
      v.vx -= fx;
      v.vy -= fy;
    }

    // 3. Center gravity & boundary damping
    const temp = 1 - (step / iterations) * 0.8;
    for (const id of Object.keys(positions)) {
      const p = positions[id];
      // Topic node has higher center pull
      const gravity = p.type === 'topic' ? 0.08 : 0.03;
      p.vx += (cx - p.x) * gravity;
      p.vy += (cy - p.y) * gravity;

      p.x += Math.max(-15, Math.min(15, p.vx * temp));
      p.y += Math.max(-15, Math.min(15, p.vy * temp));

      // Margin bounding
      const pad = p.radius + 14;
      p.x = Math.max(pad, Math.min(width - pad, p.x));
      p.y = Math.max(pad, Math.min(height - pad, p.y));

      p.vx *= 0.8;
      p.vy *= 0.8;
    }
  }

  const result: Record<string, { x: number; y: number; radius: number; type: GraphNodeType }> = {};
  for (const id of Object.keys(positions)) {
    result[id] = {
      x: Math.round(positions[id].x * 10) / 10,
      y: Math.round(positions[id].y * 10) / 10,
      radius: positions[id].radius,
      type: positions[id].type,
    };
  }
  return result;
}

export default function KnowledgeGraphView({
  graph,
  isLoading,
  onCitationClick,
}: KnowledgeGraphViewProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'graph' | 'text'>('graph');

  const instanceId = useId();

  const layout = useMemo(() => {
    if (!graph || graph.nodes.length === 0) return {};
    return computeForceLayout(graph.nodes, graph.edges, 640, 380);
  }, [graph]);

  if (isLoading || !graph) {
    return (
      <div className="bg-surface-elevated rounded-2xl border border-line p-5 sm:p-6 mb-4 shadow-xs" data-testid="knowledge-graph-loading">
        <div className="flex items-center justify-between mb-3 pb-2 border-b border-line">
          <h3 className="font-bold text-sm sm:text-base text-brand font-serif flex items-center gap-2">
            <span>🕸️</span> 知识图谱
          </h3>
          <span className="text-xs text-content-tertiary">构建中…</span>
        </div>
        <div className="h-64 flex flex-col items-center justify-center bg-surface rounded-xl border border-dashed border-line">
          <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-xs text-content-secondary">正在从多源报告与论述中提炼知识实体与拓扑关系…</p>
        </div>
      </div>
    );
  }

  if (graph.nodes.length === 0) {
    return null;
  }

  const selectedNode = selectedNodeId ? graph.nodes.find((n) => n.id === selectedNodeId) ?? null : null;
  const selectedEdge = selectedEdgeId ? graph.edges.find((e) => e.id === selectedEdgeId) ?? null : null;

  const handleSelectNode = (nodeId: string) => {
    setSelectedNodeId((prev) => (prev === nodeId ? null : nodeId));
    setSelectedEdgeId(null);
  };

  const handleSelectEdge = (edgeId: string) => {
    setSelectedEdgeId((prev) => (prev === edgeId ? null : edgeId));
    setSelectedNodeId(null);
  };

  const handleClearSelection = () => {
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
  };

  // Connected edges for the selected node
  const nodeOutgoingEdges = selectedNode ? graph.edges.filter((e) => e.from === selectedNode.id) : [];
  const nodeIncomingEdges = selectedNode ? graph.edges.filter((e) => e.to === selectedNode.id) : [];

  return (
    <div
      className="bg-surface-elevated rounded-2xl border border-line p-5 sm:p-6 shadow-xs text-content-primary"
      data-testid="knowledge-graph-container"
      role="region"
      aria-label="知识图谱"
      id={`knowledge-graph-${instanceId}`}
    >
      {/* Header with Title & View Mode Toggle */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4 pb-2 border-b border-line">
        <div>
          <h3 className="font-bold text-sm sm:text-base text-brand font-serif flex items-center gap-2" data-testid="knowledge-graph-title">
            <span>🕸️</span> 知识图谱
          </h3>
          <p className="text-[11px] text-content-secondary mt-0.5">
            结构化呈现议题核心概念、争议主张与引证关系（支持键盘与无障碍交互）
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* View mode toggle button */}
          <button
            type="button"
            onClick={() => setViewMode(viewMode === 'graph' ? 'text' : 'graph')}
            className="text-xs px-3 py-1.5 rounded-xl border border-line text-content-primary bg-surface hover:bg-surface-subtle transition-colors font-medium flex items-center gap-1.5 shadow-2xs"
            aria-pressed={viewMode === 'text'}
            data-testid="graph-view-mode-toggle"
          >
            {viewMode === 'graph' ? (
              <>
                <svg className="w-3.5 h-3.5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                </svg>
                切换为文本列表
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" />
                </svg>
                切换为力导向图
              </>
            )}
          </button>
        </div>
      </div>

      {/* Honest degradation banner if fallback */}
      {graph.isFallback && (
        <div
          className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-md text-xs text-amber-800 flex items-start gap-2"
          data-testid="graph-degraded-banner"
          role="status"
        >
          <span className="shrink-0 text-amber-600 font-bold">⚠️</span>
          <div>
            <span className="font-semibold">【简化图谱降级】</span>
            {graph.degradedReason || '由于抽取限制，图谱已自动生成确定性结构化简化视图，不影响报告事实阅读。'}
          </div>
        </div>
      )}

      {/* Provenance and Legend */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs mb-4 pb-3 border-b border-gray-100">
        {/* Node types legend */}
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-gray-400 font-medium">节点:</span>
          {(['topic', 'concept', 'claim', 'actor'] as GraphNodeType[]).map((t) => (
            <div key={t} className="flex items-center gap-1.5">
              <span
                className="w-2.5 h-2.5 rounded-full border shrink-0"
                style={{
                  backgroundColor: NODE_TYPE_COLORS[t].fill,
                  borderColor: NODE_TYPE_COLORS[t].stroke,
                }}
              />
              <span className="text-gray-600">{NODE_TYPE_LABELS[t]}</span>
            </div>
          ))}
        </div>

        {/* Edge provenance legend */}
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-gray-400 font-medium">关系:</span>
          {(['supported', 'inferred', 'user_claimed'] as GraphEdgeType[]).map((t) => (
            <div key={t} className="flex items-center gap-1.5">
              <span
                className="w-3.5 h-0.5 inline-block shrink-0"
                style={{
                  backgroundColor: EDGE_COLORS[t],
                  borderTop: t === 'inferred' ? '1px dashed #f59e0b' : t === 'user_claimed' ? '1px dotted #3b82f6' : undefined,
                }}
              />
              <span className="text-gray-600">{EDGE_LABELS[t]}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Main View: Force-directed SVG Graph or Accessible Text List */}
      {viewMode === 'graph' ? (
        <div
          className="relative w-full bg-slate-50/60 rounded-lg border border-slate-200 overflow-hidden"
          data-testid="force-directed-graph-canvas"
        >
          <svg
            viewBox="0 0 640 380"
            className="w-full h-auto block select-none"
            role="application"
            aria-label="无箭头力导向知识拓扑图。可使用 Tab 键聚焦并在节点或连接间切换，按 Enter 或空格键查看详情。"
            tabIndex={0}
          >
            {/* Edges */}
            <g className="edges" data-testid="graph-edges-group">
              {graph.edges.map((edge) => {
                const u = layout[edge.from];
                const v = layout[edge.to];
                if (!u || !v) return null;

                const isSelected = selectedEdgeId === edge.id;
                const isConnectedToSelectedNode =
                  selectedNodeId === edge.from || selectedNodeId === edge.to;
                const color = EDGE_COLORS[edge.type] || '#94a3b8';
                const strokeDash = EDGE_DASH[edge.type];
                const fromNode = graph.nodes.find((n) => n.id === edge.from);
                const toNode = graph.nodes.find((n) => n.id === edge.to);

                return (
                  <g key={edge.id} className="edge-group" data-testid={`edge-${edge.id}`}>
                    {/* Visual line (arrow-free) */}
                    <line
                      x1={u.x}
                      y1={u.y}
                      x2={v.x}
                      y2={v.y}
                      stroke={color}
                      strokeWidth={isSelected ? 3.5 : isConnectedToSelectedNode ? 2.5 : 1.75}
                      strokeDasharray={strokeDash}
                      strokeOpacity={
                        selectedNodeId
                          ? isConnectedToSelectedNode
                            ? 1
                            : 0.2
                          : selectedEdgeId
                          ? isSelected
                            ? 1
                            : 0.25
                          : 0.75
                      }
                      className="transition-all duration-200"
                    />

                    {/* Interactive hit area for easy mouse/touch/keyboard selection */}
                    <line
                      x1={u.x}
                      y1={u.y}
                      x2={v.x}
                      y2={v.y}
                      stroke="transparent"
                      strokeWidth={16}
                      role="button"
                      tabIndex={0}
                      aria-label={`连接: 从 ${fromNode?.label ?? edge.from} 到 ${toNode?.label ?? edge.to}，关系: ${edge.predicate || edge.label} (${EDGE_LABELS[edge.type]})`}
                      aria-pressed={isSelected}
                      onClick={() => handleSelectEdge(edge.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleSelectEdge(edge.id);
                        }
                      }}
                      className="cursor-pointer focus:outline-none focus-visible:stroke-purple-400/40"
                    />
                  </g>
                );
              })}
            </g>

            {/* Nodes */}
            <g className="nodes" data-testid="graph-nodes-group">
              {graph.nodes.map((node, idx) => {
                const pos = layout[node.id];
                if (!pos) return null;

                const nodeType = node.type || (idx === 0 ? 'topic' : 'concept');
                const theme = NODE_TYPE_COLORS[nodeType] || NODE_TYPE_COLORS.concept;
                const isSelected = selectedNodeId === node.id;
                const isEdgeEndpoint = selectedEdge
                  ? selectedEdge.from === node.id || selectedEdge.to === node.id
                  : false;
                const isDimmed =
                  (selectedNodeId && !isSelected && !graph.edges.some((e) => (e.from === selectedNodeId && e.to === node.id) || (e.to === selectedNodeId && e.from === node.id))) ||
                  (selectedEdgeId && !isEdgeEndpoint);

                // Truncate label inside circle
                const displayLabel =
                  node.label.length > 6 ? `${node.label.slice(0, 5)}…` : node.label;

                return (
                  <g
                    key={node.id}
                    transform={`translate(${pos.x}, ${pos.y})`}
                    role="button"
                    tabIndex={0}
                    aria-label={`实体节点: ${node.label}，类型: ${NODE_TYPE_LABELS[nodeType]}`}
                    aria-pressed={isSelected}
                    onClick={() => handleSelectNode(node.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleSelectNode(node.id);
                      }
                    }}
                    className="cursor-pointer focus:outline-none group transition-opacity duration-200"
                    style={{ opacity: isDimmed ? 0.35 : 1 }}
                    data-testid={`node-${node.id}`}
                  >
                    {/* Focus/Selection Ring */}
                    {(isSelected || isEdgeEndpoint) && (
                      <circle
                        r={pos.radius + 6}
                        fill="none"
                        stroke={isSelected ? '#9333ea' : '#3b82f6'}
                        strokeWidth={2.5}
                        strokeDasharray="4 3"
                        className="animate-spin-slow"
                      />
                    )}

                    {/* Base Node Circle */}
                    <circle
                      r={pos.radius}
                      fill={theme.fill}
                      stroke={theme.stroke}
                      strokeWidth={isSelected ? 3 : 2}
                      className="transition-transform group-hover:scale-110 group-focus-visible:ring-2"
                    />

                    {/* Node Text Label */}
                    <text
                      textAnchor="middle"
                      dy="0.32em"
                      fontSize={pos.radius > 24 ? 12 : 10.5}
                      fontWeight="600"
                      fill={theme.text}
                      pointerEvents="none"
                    >
                      {displayLabel}
                    </text>

                    {/* Secondary Type Pill Below Node */}
                    <text
                      y={pos.radius + 13}
                      textAnchor="middle"
                      fontSize={9}
                      fill="#64748b"
                      pointerEvents="none"
                      className="font-medium"
                    >
                      {NODE_TYPE_LABELS[nodeType]}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>

          {/* Quick interactive tip */}
          <div className="absolute bottom-2 right-2 text-[11px] text-gray-400 bg-white/80 px-2 py-0.5 rounded border border-gray-200 pointer-events-none">
            点击节点或连接线查看详情
          </div>
        </div>
      ) : (
        /* Accessible Equivalent Text List Mode */
        <div
          className="space-y-3"
          data-testid="accessible-text-list-mode"
          aria-label="等价知识图谱结构化列表"
        >
          <div className="text-xs text-gray-500 mb-2">
            为方便键盘无障碍阅读与屏幕朗读器，以下按实体节点与关联关系完整展开：
          </div>

          <div className="divide-y border rounded-lg bg-white overflow-hidden">
            {graph.nodes.map((node) => {
              const nodeType = node.type || 'concept';
              const theme = NODE_TYPE_COLORS[nodeType];
              const outgoing = graph.edges.filter((e) => e.from === node.id);
              const isSelected = selectedNodeId === node.id;

              return (
                <div
                  key={node.id}
                  className={`p-4 transition-colors cursor-pointer ${
                    isSelected ? 'bg-purple-50/70 border-l-4 border-l-purple-600' : 'hover:bg-gray-50'
                  }`}
                  onClick={() => handleSelectNode(node.id)}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSelected}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleSelectNode(node.id);
                    }
                  }}
                  data-testid={`text-node-${node.id}`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${theme.badgeBg} ${theme.badgeText}`}
                      >
                        {NODE_TYPE_LABELS[nodeType]}
                      </span>
                      <span className="font-semibold text-sm text-gray-900">{node.label}</span>
                    </div>
                    {node.sourceCitations && node.sourceCitations.length > 0 && (
                      <span className="text-xs text-blue-600 font-medium">
                        引用: {node.sourceCitations.map((c) => `[${c}]`).join(' ')}
                      </span>
                    )}
                  </div>

                  <p className="text-xs text-gray-600 mb-2">{node.description}</p>

                  {/* Connected edges list */}
                  {outgoing.length > 0 && (
                    <div className="text-xs space-y-1 mt-2 pl-2 border-l-2 border-gray-200">
                      <span className="text-[11px] font-medium text-gray-400">输出关联:</span>
                      {outgoing.map((edge) => {
                        const target = graph.nodes.find((n) => n.id === edge.to);
                        return (
                          <div key={edge.id} className="flex items-center gap-1.5 flex-wrap text-gray-700">
                            <span
                              className="w-2 h-2 rounded-full inline-block shrink-0"
                              style={{ backgroundColor: EDGE_COLORS[edge.type] }}
                            />
                            <span className="font-medium text-purple-700">{edge.predicate || edge.label}</span>
                            <span className="text-gray-400">→</span>
                            <span className="font-medium text-gray-900">{target?.label ?? edge.to}</span>
                            <span className="text-gray-400 text-[10px]">({EDGE_LABELS[edge.type]})</span>
                            {edge.type === 'supported' && edge.citationId && (
                              <span className="text-blue-600 font-semibold text-[11px]">
                                [{edge.citationId}]
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Interactive Detail Drawer / Panel */}
      {(selectedNode || selectedEdge) && (
        <div
          className="mt-4 p-4 bg-slate-50 border border-slate-200 rounded-lg text-sm transition-all"
          data-testid="graph-detail-panel"
        >
          <div className="flex justify-between items-start mb-2">
            <h4 className="font-semibold text-gray-900 flex items-center gap-2">
              <span>📌</span>
              {selectedNode ? '实体详情' : '关系详情'}
            </h4>
            <button
              type="button"
              onClick={handleClearSelection}
              className="text-gray-400 hover:text-gray-600 p-1 rounded hover:bg-gray-200/60 transition-colors"
              aria-label="关闭详情面板"
              data-testid="close-detail-panel"
            >
              ✕
            </button>
          </div>

          {/* Node details */}
          {selectedNode && (
            <div className="space-y-3" data-testid="selected-node-details">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      NODE_TYPE_COLORS[selectedNode.type || 'concept'].badgeBg
                    } ${NODE_TYPE_COLORS[selectedNode.type || 'concept'].badgeText}`}
                  >
                    {NODE_TYPE_LABELS[selectedNode.type || 'concept']}
                  </span>
                  <span className="font-bold text-base text-gray-900">{selectedNode.label}</span>
                </div>
                <p className="text-xs text-gray-600 leading-relaxed">{selectedNode.description}</p>
              </div>

              {/* Citations */}
              {selectedNode.sourceCitations && selectedNode.sourceCitations.length > 0 && (
                <div className="text-xs flex items-center gap-2 flex-wrap">
                  <span className="text-gray-500 font-medium">支持文献:</span>
                  {selectedNode.sourceCitations.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => onCitationClick?.(c)}
                      className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 font-semibold"
                    >
                      来源 [{c}]
                    </button>
                  ))}
                </div>
              )}

              {/* Connected outgoing & incoming */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-200 text-xs">
                <div>
                  <span className="font-medium text-gray-500 block mb-1">发起关系:</span>
                  {nodeOutgoingEdges.length > 0 ? (
                    <ul className="space-y-1">
                      {nodeOutgoingEdges.map((e) => {
                        const target = graph.nodes.find((n) => n.id === e.to);
                        return (
                          <li
                            key={e.id}
                            className="flex items-center gap-1.5 cursor-pointer hover:text-purple-700"
                            onClick={() => handleSelectEdge(e.id)}
                          >
                            <span
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{ backgroundColor: EDGE_COLORS[e.type] }}
                            />
                            <span className="font-medium">{e.predicate || e.label}</span>
                            <span className="text-gray-400">→</span>
                            <span>{target?.label ?? e.to}</span>
                            {e.citationId && (
                              <span className="text-blue-600 font-bold">[{e.citationId}]</span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <span className="text-gray-400">无发起关系</span>
                  )}
                </div>

                <div>
                  <span className="font-medium text-gray-500 block mb-1">被指关系:</span>
                  {nodeIncomingEdges.length > 0 ? (
                    <ul className="space-y-1">
                      {nodeIncomingEdges.map((e) => {
                        const source = graph.nodes.find((n) => n.id === e.from);
                        return (
                          <li
                            key={e.id}
                            className="flex items-center gap-1.5 cursor-pointer hover:text-purple-700"
                            onClick={() => handleSelectEdge(e.id)}
                          >
                            <span
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{ backgroundColor: EDGE_COLORS[e.type] }}
                            />
                            <span>{source?.label ?? e.from}</span>
                            <span className="text-gray-400">→</span>
                            <span className="font-medium">{e.predicate || e.label}</span>
                            {e.citationId && (
                              <span className="text-blue-600 font-bold">[{e.citationId}]</span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <span className="text-gray-400">无被指关系</span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Edge details */}
          {selectedEdge && (
            <div className="space-y-3" data-testid="selected-edge-details">
              {(() => {
                const fromNode = graph.nodes.find((n) => n.id === selectedEdge.from);
                const toNode = graph.nodes.find((n) => n.id === selectedEdge.to);
                return (
                  <>
                    <div className="flex items-center gap-2 flex-wrap text-sm font-medium">
                      <span className="px-2 py-0.5 rounded bg-purple-100 text-purple-800 text-xs">
                        {fromNode?.label ?? selectedEdge.from}
                      </span>
                      <span className="text-gray-400 font-bold">──[</span>
                      <span className="text-purple-700 font-bold">
                        {selectedEdge.predicate || selectedEdge.label}
                      </span>
                      <span className="text-gray-400 font-bold">]──►</span>
                      <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-800 text-xs">
                        {toNode?.label ?? selectedEdge.to}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap text-xs">
                      <span className="text-gray-500 font-medium">来源属性:</span>
                      <span
                        className="px-2 py-0.5 rounded font-semibold text-white text-[11px]"
                        style={{ backgroundColor: EDGE_COLORS[selectedEdge.type] }}
                      >
                        {EDGE_LABELS[selectedEdge.type]}
                      </span>
                      {selectedEdge.type === 'supported' && selectedEdge.citationId && (
                        <button
                          type="button"
                          onClick={() => onCitationClick?.(selectedEdge.citationId!)}
                          className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 font-semibold hover:bg-blue-100"
                        >
                          报告引用 [{selectedEdge.citationId}]
                        </button>
                      )}
                    </div>

                    <div className="text-xs text-gray-600 bg-white p-2.5 rounded border border-gray-100">
                      {selectedEdge.description ||
                        (selectedEdge.type === 'supported'
                          ? `文献明确支持 ${fromNode?.label} 与 ${toNode?.label} 之间的论证逻辑。`
                          : selectedEdge.type === 'inferred'
                          ? `AI 根据上下文语义推断的关系，未直接声明于单一文献。`
                          : `源自用户对话中提出的主张与观点。`)}
                    </div>
                  </>
                );
              })()}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
