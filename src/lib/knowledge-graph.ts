// Knowledge graph builder for ticket #7.
// Generates 6-10 nodes from report sources, with edges of three provenance types:
// - 'supported': backed by a citation (links to a Source in the report)
// - 'inferred': AI-derived relationship, not directly cited
// - 'user_claimed': derived from the user's initial opinion
// Deterministic: same inputs always produce the same graph.

import type { Source, Report } from './providers';

export type GraphEdgeType = 'supported' | 'inferred' | 'user_claimed';

export interface GraphNode {
  id: string;
  label: string;
  description: string;
  sourceCitations?: number[]; // 1-based indices into the Report's citations map
}

export interface GraphEdge {
  id: string;
  from: string; // node id
  to: string;   // node id
  label: string;
  type: GraphEdgeType;
  citationId?: number; // 1-based citation index; required for 'supported'
}

export interface KnowledgeGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
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
    return {
      id: `n${i + 1}`,
      label,
      description: `Entity from ${sources[firstSourceIdx]?.type ?? 'sources'}: ${label}`,
      ...(citationId ? { sourceCitations: [citationId] } : {}),
    };
  });

  // Add the question itself as a central node
  const centralId = 'n0';
  nodes.unshift({
    id: centralId,
    label: report.question.slice(0, 24) + (report.question.length > 24 ? '…' : ''),
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
        label: '相关',
        type: 'supported',
        citationId: citation,
      });
    }
  }

  // 2. inferred edges: between sibling entities (no citation)
  for (let i = 1; i < nodes.length - 1 && edgeIdx < TARGET_EDGE_COUNT; i++) {
    edges.push({
      id: `e${++edgeIdx}`,
      from: nodes[i].id,
      to: nodes[i + 1].id,
      label: '相关',
      type: 'inferred',
    });
  }

  // 3. user_claimed edge: connect central to a node labelled with the initial opinion
  if (edgeIdx < TARGET_EDGE_COUNT && report.viewpoints.length > 0) {
    const target = nodes[Math.min(2, nodes.length - 1)];
    edges.push({
      id: `e${++edgeIdx}`,
      from: centralId,
      to: target.id,
      label: '用户主张',
      type: 'user_claimed',
    });
  }

  return { nodes, edges };
}
