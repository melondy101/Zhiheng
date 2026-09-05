// Knowledge graph builder for ticket #7.
// Generates 6-10 nodes from report sources, with edges of three provenance types:
// - 'supported': backed by a citation (links to a Source in the report)
// - 'inferred': AI-derived relationship, not directly cited
// - 'user_claimed': derived from the user's initial opinion
// Deterministic: same inputs always produce the same graph.

import type { Source, Report } from './providers';

export type GraphNodeType = 'topic' | 'concept' | 'claim' | 'actor';
export type GraphEdgeType = 'supported' | 'inferred' | 'user_claimed';

export type ControlledPredicate =
  | '支持'
  | '反驳'
  | '导致'
  | '依赖'
  | '影响'
  | '对比'
  | '主张'
  | '相关';

export interface GraphNode {
  id: string;
  label: string;
  type?: GraphNodeType;
  description: string;
  sourceCitations?: number[]; // 1-based indices into the Report's citations map
}

export interface GraphEdge {
  id: string;
  from: string; // node id (subject)
  to: string;   // node id (object)
  subject?: string; // subject node id or label
  predicate?: ControlledPredicate | string; // controlled predicate
  object?: string; // object node id or label
  label: string;
  type: GraphEdgeType;
  citationId?: number; // 1-based citation index; required for 'supported'
  description?: string;
}

export interface KnowledgeGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  isFallback?: boolean;
  degradedReason?: string;
  /**
   * The retrieval provenance of the report's sources (#24). This is the same
   * reportSourceState that is persisted on the Session. It is attached here
   * so KnowledgeGraphView can display provenance truthfully when rendering
   * a graph that was restored from a session (not freshly generated).
   */
  sourceState?: {
    zhihu: import('./providers').SourceState;
    web: import('./providers').SourceState;
    zhihuUpdatedAt?: number;
    webUpdatedAt?: number;
    zhihuStale?: boolean;
    webStale?: boolean;
  };
}

const TARGET_NODE_COUNT = 8; // within 6-10 range
const TARGET_EDGE_COUNT = 10;

/** Extract candidate entity labels from a source's title. */
function extractEntities(source: Source): string[] {
  const text = [source.title ?? '', source.excerpt ?? ''].join(' ');
  // Match Chinese/English noun-like words, 2-12 chars
  const matches = text.match(/[一-龥]{2,8}|[A-Z][a-z]+(?:[A-Z][a-z]+)*/g) ?? [];
  return [...new Set(matches)].slice(0, 3);
}

/** Stable string hash for deterministic ids. */
function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * Build a knowledge graph from a report and its sources.
 * The graph is derived purely from sources, viewpoints, and the question.
 * It does not fabricate facts: every 'supported' edge points to a real citation.
 */
export function buildGraph(report: Report, sources: Source[]): KnowledgeGraph {
  // Pick entities from the first 6-8 sources deterministically
  const entitySet = new Map<string, { count: number; firstSource: number }>();
  sources.forEach((src, idx) => {
    const entities = extractEntities(src);
    entities.forEach((e) => {
      const cur = entitySet.get(e) ?? { count: 0, firstSource: idx };
      entitySet.set(e, { count: cur.count + 1, firstSource: cur.firstSource });
    });
  });

  // Sort by mention count, take top N
  const sortedEntities = [...entitySet.entries()]
    .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
    .slice(0, TARGET_NODE_COUNT);

  const nodes: GraphNode[] = sortedEntities.map(([label], i) => {
    const firstSourceIdx = sortedEntities[i][1].firstSource;
    const citationId = sources[firstSourceIdx]
      ? Object.keys(report.citations).map(Number).find(k => report.citations[k] === sources[firstSourceIdx])
      : undefined;
    const isActor = /(?:机构|大学|团队|作者|公司|政府|联盟|学者|协会|组织|方)$/.test(label) ||
      (sources[firstSourceIdx]?.author && label.includes(sources[firstSourceIdx]?.author ?? ''));
    return {
      id: `n${i + 1}`,
      label,
      type: (isActor ? 'actor' : 'concept') as GraphNodeType,
      description: `Entity from ${sources[firstSourceIdx]?.type ?? 'sources'}: ${label}`,
      ...(citationId ? { sourceCitations: [citationId] } : {}),
    };
  });

  // Add the question itself as a central node
  const centralId = 'n0';
  nodes.unshift({
    id: centralId,
    label: report.question.slice(0, 24) + (report.question.length > 24 ? '…' : ''),
    type: 'topic' as GraphNodeType,
    description: `核心议题: ${report.question}`,
  });

  // Build edges
  const edges: GraphEdge[] = [];
  let edgeIdx = 0;

  // 1. supported edges: central → each entity, with citation
  for (let i = 1; i < nodes.length && edgeIdx < TARGET_EDGE_COUNT; i++) {
    const node = nodes[i];
    const citation = node.sourceCitations?.[0];
    if (citation) {
      edges.push({
        id: `e${++edgeIdx}`,
        from: centralId,
        to: node.id,
        subject: centralId,
        predicate: '支持',
        object: node.id,
        label: '相关',
        type: 'supported',
        citationId: citation,
        description: `报告论述与实体 [${node.label}] 相关，由文献 [${citation}] 引用支持`,
      });
    }
  }

  // 2. inferred edges: between sibling entities (no citation)
  for (let i = 1; i < nodes.length - 1 && edgeIdx < TARGET_EDGE_COUNT; i++) {
    edges.push({
      id: `e${++edgeIdx}`,
      from: nodes[i].id,
      to: nodes[i + 1].id,
      subject: nodes[i].id,
      predicate: i % 2 === 0 ? '对比' : '影响',
      object: nodes[i + 1].id,
      label: '相关',
      type: 'inferred',
      description: `概念 [${nodes[i].label}] 与 [${nodes[i + 1].label}] 存在推断关联`,
    });
  }

  // 3. user_claimed edge: connect central to a node labelled with the initial opinion
  if (edgeIdx < TARGET_EDGE_COUNT && report.viewpoints.length > 0) {
    const target = nodes[Math.min(2, nodes.length - 1)];
    edges.push({
      id: `e${++edgeIdx}`,
      from: centralId,
      to: target.id,
      subject: centralId,
      predicate: '主张',
      object: target.id,
      label: '用户主张',
      type: 'user_claimed',
      description: `用户初步主张关联至 [${target.label}]`,
    });
  }

  return { nodes, edges };
}

/**
 * Validates graph structure, node uniqueness, and citation integrity.
 */
export function validateGraph(
  graph: KnowledgeGraph,
  report?: Report
): { valid: boolean; reason?: string } {
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    return { valid: false, reason: '图谱缺少 nodes 或 edges 数组' };
  }
  if (graph.nodes.length === 0) {
    return { valid: false, reason: '图谱节点数为空' };
  }
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  for (const node of graph.nodes) {
    if (!node.id || !node.label) {
      return { valid: false, reason: `节点缺少 id 或 label` };
    }
  }
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      return { valid: false, reason: `边端点引用了不存在的节点: ${edge.from} -> ${edge.to}` };
    }
    if (edge.type === 'supported') {
      if (typeof edge.citationId !== 'number' || edge.citationId < 1) {
        return { valid: false, reason: `引用支持边缺少有效 citationId: ${edge.id}` };
      }
      if (report && report.citations && !report.citations[edge.citationId]) {
        return { valid: false, reason: `引用支持边引用了报告不存在的 citation [${edge.citationId}]` };
      }
    }
  }
  return { valid: true };
}

/**
 * Builds a deterministic simplified fallback graph when full extraction fails.
 */
export function buildFallbackGraph(report: Report, reason: string): KnowledgeGraph {
  const centralId = 'n0';
  const nodes: GraphNode[] = [
    {
      id: centralId,
      label: report.question.slice(0, 24) + (report.question.length > 24 ? '…' : ''),
      type: 'topic',
      description: `核心议题: ${report.question}`,
    },
  ];

  // Derive up to 5 simple nodes from viewpoints or title
  const candidates = [
    ...(report.viewpoints || []).map((v) => ({ label: v.slice(0, 16), type: 'claim' as const })),
    ...(report.knowledgePoints || []).map((kp) => ({ label: kp.slice(0, 16), type: 'concept' as const })),
  ].slice(0, 5);

  candidates.forEach((cand, idx) => {
    nodes.push({
      id: `n${idx + 1}`,
      label: cand.label,
      type: cand.type,
      description: `简化提取: ${cand.label}`,
    });
  });

  const edges: GraphEdge[] = [];
  for (let i = 1; i < nodes.length; i++) {
    edges.push({
      id: `e${i}`,
      from: centralId,
      to: nodes[i].id,
      subject: centralId,
      predicate: '相关',
      object: nodes[i].id,
      label: '相关',
      type: 'inferred',
      description: `简化关联: 议题与 [${nodes[i].label}]`,
    });
  }

  return {
    nodes,
    edges,
    isFallback: true,
    degradedReason: reason,
  };
}

/**
 * Safe graph builder that validates output and degrades gracefully without throwing.
 */
export function safeBuildGraph(report: Report, sources: Source[]): KnowledgeGraph {
  try {
    const raw = buildGraph(report, sources);
    const check = validateGraph(raw, report);
    if (!check.valid) {
      return buildFallbackGraph(report, check.reason ?? '校验失败');
    }
    return raw;
  } catch (err) {
    return buildFallbackGraph(report, err instanceof Error ? err.message : String(err));
  }
}
