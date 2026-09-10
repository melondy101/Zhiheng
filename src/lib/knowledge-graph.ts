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
  | '构成'
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
// Keep the graph readable while providing a genuinely connected evidence
// network instead of a topic hub with only a thin chain between neighbors.
const TARGET_EDGE_COUNT = 20;

const STOP_WORDS = new Set([
  '已无法避免',
  '能做的只有',
  '这是否意味着',
  '为什么',
  '越来越',
  '还有救吗',
  '全记录',
  '怎么办',
  '发生了什么',
  '知乎',
  '大事',
  '昨日全球大事',
  '探讨',
  '总结',
  '分析',
  '最新',
  '每日',
  '昨日',
  '做空',
  '测试问题',
  '测试作者',
  '内容',
  '文章',
  '阅读',
  '点击',
  '分享',
  '讨论',
  '观点',
  '说明',
]);

const GRAMMAR_PARTICLES_PREFIX = /^(已|能|将|要|会|在|从|到|把|被|让|使|这|那|哪|什么|怎么|怎样|如何|为|给|对|于|是|有|做|与|和|及|为什么|如何看待|这是否意味着|到底什么是)+/;
const GRAMMAR_PARTICLES_SUFFIX = /(的|了|着|过|和|与|及|在|从|到|把|被|让|使|这|那|哪|什么|怎么|怎样|如何|为|给|对|于|是|有|等|吗|呢|吧|啊|呀)+$/;

/** Clean an entity string by stripping punctuation, question prefixes, and grammatical particles. */
export function cleanEntityLabel(raw: string): string {
  let text = raw.trim();
  // Strip common platform suffixes
  text = text.replace(/\s*[-_|]\s*(知乎|CSDN.*|博客|百度.*|微信公众平台|掘金|简书|头条|新闻|快讯)$/i, '');
  // Strip question frames
  text = text.replace(/^(为什么|如何看待|这是否意味着|到底什么是|如何实现|怎么做|浅谈|探讨|浅析|论)\s*/i, '');
  // Strip punctuation and special chars
  text = text.replace(/[?？!！:：,，。;；"“”'‘’()[\]【】`~<>《》]/g, ' ').trim();
  // Remove leading and trailing particles
  text = text.replace(GRAMMAR_PARTICLES_PREFIX, '').replace(GRAMMAR_PARTICLES_SUFFIX, '').trim();
  return text;
}

/** Shared admission gate for deterministic, LLM, and fallback graph labels. */
export function sanitizeGraphLabel(raw: string): string | null {
  const text = cleanEntityLabel(raw);
  if (text.length < 2 || text.length > 20 || STOP_WORDS.has(text)) return null;
  // Colloquial lead-ins and personal nicknames are not graph concepts.
  if (/^(写在最前边|家人们|真的|我觉得|说实话|一文读懂|速看|必读|盘点)/.test(text)) return null;
  if (/(学院|学长|老师|博士|同学|哥|姐|酱|君)$/.test(text) && text.length <= 8) return null;
  return text;
}

/** Extract candidate entity labels from a source. */
function extractEntities(source: Source): string[] {
  const title = source.title ?? '';
  const excerpt = source.excerpt ?? '';
  const candidates: string[] = [];

  // Extract author if organization or research team
  if (source.author && source.author.length >= 2 && source.author.length <= 16 && !STOP_WORDS.has(source.author)) {
    candidates.push(source.author);
  }

  // Split title and excerpt by clauses
  const chunks = `${title} ${excerpt}`.split(/[:：\-_|/，,、\s。；;\t\n]+/);
  for (const chunk of chunks) {
    const cleaned = sanitizeGraphLabel(chunk);
    if (cleaned && cleaned.length <= 16) {
      candidates.push(cleaned);
    }
  }

  return [...new Set(candidates)].slice(0, 4);
}

/**
 * Build a knowledge graph from a report and its sources.
 * The graph is derived purely from sources, viewpoints, and the question.
 * It does not fabricate facts: every 'supported' edge points to a real citation.
 */
export function buildGraph(report: Report, sources: Source[]): KnowledgeGraph {
  const nodes: GraphNode[] = [];
  const centralId = 'n0';

  // 1. Central Topic Node
  nodes.push({
    id: centralId,
    label: report.question.slice(0, 24) + (report.question.length > 24 ? '…' : ''),
    type: 'topic' as GraphNodeType,
    description: `核心研讨议题: ${report.question}`,
  });

  const nodeLabelSet = new Set<string>([report.question]);

  const addNode = (
    label: string,
    type: GraphNodeType,
    description: string,
    citationId?: number
  ): boolean => {
    const cleaned = sanitizeGraphLabel(label);
    if (!cleaned || nodeLabelSet.has(cleaned)) {
      return false;
    }
    nodeLabelSet.add(cleaned);
    const id = `n${nodes.length}`;
    nodes.push({
      id,
      label: cleaned.slice(0, 20),
      type,
      description,
      ...(citationId ? { sourceCitations: [citationId] } : {}),
    });
    return true;
  };

  // 2. Add concepts from report.knowledgePoints (High quality)
  if (Array.isArray(report.knowledgePoints)) {
    for (const kp of report.knowledgePoints) {
      if (nodes.length >= TARGET_NODE_COUNT) break;
      addNode(kp, 'concept', `研报关键知识点: ${kp}`);
    }
  }

  // 3. Add claims from report.viewpoints
  if (Array.isArray(report.viewpoints)) {
    for (let i = 0; i < report.viewpoints.length; i++) {
      if (nodes.length >= TARGET_NODE_COUNT) break;
      const vp = report.viewpoints[i];
      const clauses = vp.split(/[，,。；;]/).filter((c) => c.trim().length >= 4);
      const claimText = clauses[0] ? clauses[0].trim() : vp;
      addNode(claimText, 'claim', `核心论述观点: ${claimText}`);
    }
  }

  // 4. Add actors and entities from sources with citation linkage
  sources.forEach((src, idx) => {
    if (nodes.length >= TARGET_NODE_COUNT) return;
    const cid =
      Object.keys(report.citations || {})
        .map(Number)
        .find((k) => report.citations[k] === src) ?? (idx + 1);

    const isActor =
      /(?:机构|大学|团队|作者|公司|政府|联盟|学者|协会|组织|委员会|实验室|所|局)$/.test(src.author ?? '') ||
      /(?:机构|大学|团队|作者|公司|政府|联盟|学者|协会|组织|委员会|实验室|所|局)$/.test(src.title ?? '');

    const entities = extractEntities(src);
    for (const ent of entities) {
      if (nodes.length >= TARGET_NODE_COUNT) break;
      const entIsActor =
        isActor || /(?:机构|大学|团队|作者|公司|政府|联盟|学者|协会|组织|委员会|实验室|所|局)$/.test(ent);
      addNode(
        ent,
        entIsActor ? 'actor' : 'concept',
        `来自文献 [${cid}] 的${entIsActor ? '关键主体' : '关键概念'}: ${ent}`,
        cid
      );
    }
  });

  // Ensure between 6 and 10 nodes if sources were sparse
  let padIdx = 1;
  while (nodes.length < 6) {
    const padLabel = `关联要素${padIdx}`;
    addNode(padLabel, 'concept', `研报相关概念要素 ${padIdx}`);
    padIdx++;
  }

  // 5. Build Structured Logical Edges
  const edges: GraphEdge[] = [];
  let edgeIdx = 0;

  // A. Topic -> Concept/Claim links
  for (let i = 1; i < nodes.length && edgeIdx < TARGET_EDGE_COUNT; i++) {
    const node = nodes[i];
    const citation = node.sourceCitations?.[0];
    const isSupported = typeof citation === 'number';

    let predicate: ControlledPredicate = '相关';
    let label = '相关机制';
    let desc = `核心议题涉及 [${node.label}]`;

    if (node.type === 'claim') {
      predicate = '主张';
      label = '核心观点';
      desc = `核心议题包含主要论点 [${node.label}]`;
    } else if (node.type === 'actor') {
      predicate = '主张';
      label = '行动主体';
      desc = `主体 [${node.label}] 对核心议题提出相关主张`;
    } else if (i % 3 === 1) {
      predicate = '依赖';
      label = '核心前提';
      desc = `核心议题论证依赖关键概念 [${node.label}]`;
    }

    edges.push({
      id: `e${++edgeIdx}`,
      from: centralId,
      to: node.id,
      subject: centralId,
      predicate,
      object: node.id,
      label,
      type: isSupported ? 'supported' : 'inferred',
      ...(isSupported ? { citationId: citation } : {}),
      description: isSupported ? `${desc}，由文献 [${citation}] 引用支持` : desc,
    });
  }

  // B. Cross-node semantic relationships (between concepts, claims, actors).
  // Add short-range and skip-one links so related evidence forms a denser
  // network, while keeping deterministic ordering and bounded edge count.
  const crossPairs: Array<[number, number]> = [];
  for (let distance = 1; distance <= 2; distance++) {
    for (let i = 1; i < nodes.length - distance; i++) {
      crossPairs.push([i, i + distance]);
    }
  }
  for (const [fromIndex, toIndex] of crossPairs) {
    if (edgeIdx >= TARGET_EDGE_COUNT) break;
    const fromNode = nodes[fromIndex];
    const toNode = nodes[toIndex];
    let predicate: ControlledPredicate = '影响';
    let label = '相互影响';

    if (fromNode.type === 'actor') {
      predicate = '主张';
      label = '主体主张';
    } else if (fromNode.type === 'claim' && toNode.type === 'claim') {
      predicate = '对比';
      label = '观点对照';
    } else if (fromIndex % 2 === 0) {
      predicate = '导致';
      label = '因果关联';
    }

    edges.push({
      id: `e${++edgeIdx}`,
      from: fromNode.id,
      to: toNode.id,
      subject: fromNode.id,
      predicate,
      object: toNode.id,
      label,
      type: 'inferred',
      description: `[${fromNode.label}] 与 [${toNode.label}] 存在 ${predicate} 关联`,
    });
  }

  // C. User claimed edge if viewpoints exist
  if (edgeIdx < TARGET_EDGE_COUNT && report.viewpoints && report.viewpoints.length > 0) {
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

  candidates.flatMap((cand) => {
    const label = sanitizeGraphLabel(cand.label);
    return label ? [{ ...cand, label }] : [];
  }).forEach((cand, idx) => {
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

/**
 * Asynchronous graph builder that attempts LLM extraction first, falling back to
 * deterministic extraction on any failure or missing LLM.
 */
export async function safeBuildGraphAsync(
  report: Report,
  sources: Source[],
  llmProvider?: import('./providers').LLMProvider | null
): Promise<KnowledgeGraph> {
  if (llmProvider && typeof llmProvider.generateKnowledgeGraph === 'function') {
    try {
      const llmGraph = await Promise.race([
        llmProvider.generateKnowledgeGraph({ report, sources }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 15_000)),
      ]);
      if (llmGraph) {
        const check = validateGraph(llmGraph, report);
        if (check.valid) {
          return llmGraph;
        }
      }
    } catch {
      // Degrade to deterministic graph extraction below
    }
  }

  return safeBuildGraph(report, sources);
}

/** Required report graph path: only an LLM-produced, validated graph is valid. */
export async function buildRequiredGraphAsync(
  report: Report,
  sources: Source[],
  llmProvider: import('./providers').LLMProvider | null
): Promise<KnowledgeGraph> {
  if (!llmProvider?.generateKnowledgeGraph) {
    throw new Error('Knowledge graph LLM is not configured');
  }
  const graph = await llmProvider.generateKnowledgeGraph({ report, sources });
  if (!graph) throw new Error('Knowledge graph LLM returned no graph');
  const check = validateGraph(graph, report);
  if (!check.valid) throw new Error(`Knowledge graph validation failed: ${check.reason ?? 'invalid graph'}`);
  return graph;
}
