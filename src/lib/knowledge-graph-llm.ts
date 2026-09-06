// LLM-backed Knowledge Graph Extraction for Zhiyan (#KG-01, #KG-02, #KG-03).
//
// Extracts structured semantic entities (topic, concept, claim, actor) and
// logical relations with controlled predicates from report materials via LLM.

import type { Report, Source } from './providers';
import type {
  ControlledPredicate,
  GraphEdge,
  GraphEdgeType,
  GraphNode,
  GraphNodeType,
  KnowledgeGraph,
} from './knowledge-graph';
import { validateGraph } from './knowledge-graph';

export const VALID_PREDICATES: ControlledPredicate[] = [
  '支持',
  '反驳',
  '导致',
  '依赖',
  '影响',
  '对比',
  '主张',
  '相关',
];

export const VALID_NODE_TYPES: GraphNodeType[] = [
  'topic',
  'concept',
  'claim',
  'actor',
];

export const VALID_EDGE_TYPES: GraphEdgeType[] = [
  'supported',
  'inferred',
  'user_claimed',
];

export const GRAPH_EXTRACTION_SYSTEM_PROMPT = `你是「知研」知识图谱结构化抽取引擎。请阅读用户提供的核心议题、研报要点与编号材料，提取议题的核心概念、主要论点、关键主体，并构建它们之间的逻辑思辨关系网络。

【输出要求】
必须直接输出符合如下规范的合法 JSON 对象，严禁包含任何前缀、解释说明或 markdown 代码块标记：
{
  "nodes": [
    {
      "id": "n0",
      "label": "简短核心议题(2-15字)",
      "type": "topic",
      "description": "议题概述",
      "sourceCitations": []
    },
    {
      "id": "n1",
      "label": "关键概念或论断(2-12字，严禁提取无意义碎词)",
      "type": "concept",
      "description": "该概念或论断在讨论中的具体含义",
      "sourceCitations": [1]
    }
  ],
  "edges": [
    {
      "id": "e1",
      "from": "n0",
      "to": "n1",
      "predicate": "支持",
      "label": "核心支撑",
      "type": "supported",
      "citationId": 1,
      "description": "该关系的逻辑解释"
    }
  ]
}

【抽取规则】
1. 节点数量：提取 6 至 10 个节点（必须包含一个 id 为 'n0'、type 为 'topic' 的中心议题节点）。
2. 节点类型（type）：
   - 'topic': 核心讨论议题（固定为 n0）。
   - 'concept': 核心专业概念或机制（如“自适应学习系统”、“算法偏见”）。
   - 'claim': 核心论据或立场判断（如“个性化教学成效显著”、“认知外包削弱独立思考”）。
   - 'actor': 关键机构、团队或行动主体（如“清华大学团队”、“OpenAI”）。
3. 边数量：提取 8 至 14 条具有实质逻辑连结的边。
4. 谓词受控：predicate 只能是 '支持' | '反驳' | '导致' | '依赖' | '影响' | '对比' | '主张' | '相关' 之一。
5. 真实引用约束：所有 type 为 'supported' 的边和节点的 sourceCitations 只能填写所给材料中真实存在的编号，严禁捏造编号。对于没有直接文献出处的推论，type 标为 'inferred' 且不填 citationId。`;

export function buildGraphExtractionUserPrompt(report: Report, sources: Source[]): string {
  const viewpointsText =
    report.viewpoints && report.viewpoints.length > 0
      ? report.viewpoints.map((v, i) => `${i + 1}. ${v}`).join('\n')
      : '暂无结构化观点';

  const knowledgePointsText =
    report.knowledgePoints && report.knowledgePoints.length > 0
      ? report.knowledgePoints.map((k, i) => `- ${k}`).join('\n')
      : '暂无知识点';

  const referencesText =
    sources.length > 0
      ? sources
          .slice(0, 10)
          .map((src, i) => {
            const cid =
              Object.keys(report.citations || {})
                .map(Number)
                .find((k) => report.citations[k] === src) ?? (i + 1);
            const title = src.title ? src.title.slice(0, 60) : '无标题';
            const excerpt = src.excerpt ? src.excerpt.slice(0, 120) : '无摘要';
            return `[${cid}] (${src.type}) 标题：${title} | 摘要：${excerpt}`;
          })
          .join('\n')
      : '无外部参考材料';

  return `核心议题：${report.question}

研报核心观点：
${viewpointsText}

研报知识点：
${knowledgePointsText}

参考材料：
${referencesText}`;
}

export function buildGraphExtractionMessages(
  report: Report,
  sources: Source[]
): Array<{ role: 'system' | 'user'; content: string }> {
  return [
    { role: 'system', content: GRAPH_EXTRACTION_SYSTEM_PROMPT },
    { role: 'user', content: buildGraphExtractionUserPrompt(report, sources) },
  ];
}

/**
 * Parses and validates an untrusted JSON string from LLM into a valid KnowledgeGraph.
 */
export function parseGraphExtractionResponse(
  content: string,
  report: Report
): KnowledgeGraph | null {
  if (!content || typeof content !== 'string') return null;

  let cleaned = content.trim();
  // Strip markdown code fences if model returned ```json ... ```
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') return null;
  const raw = parsed as { nodes?: unknown; edges?: unknown };
  if (!Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) return null;

  const validCitations = new Set(
    Object.keys(report.citations || {}).map(Number)
  );

  // 1. Process Nodes
  const nodeMap = new Map<string, GraphNode>();
  let hasCentralTopic = false;

  for (let idx = 0; idx < raw.nodes.length; idx++) {
    const item = raw.nodes[idx];
    if (!item || typeof item !== 'object') continue;
    const nodeObj = item as Record<string, unknown>;

    const rawId = typeof nodeObj.id === 'string' && nodeObj.id.trim() ? nodeObj.id.trim() : `n${idx}`;
    const rawLabel = typeof nodeObj.label === 'string' ? nodeObj.label.trim() : '';
    if (!rawLabel) continue;

    let rawType = typeof nodeObj.type === 'string' ? (nodeObj.type.toLowerCase() as GraphNodeType) : 'concept';
    if (!VALID_NODE_TYPES.includes(rawType)) {
      rawType = 'concept';
    }

    if (rawType === 'topic' || rawId === 'n0') {
      rawType = 'topic';
      hasCentralTopic = true;
    }

    const description =
      typeof nodeObj.description === 'string' && nodeObj.description.trim()
        ? nodeObj.description.trim()
        : `${rawLabel} 相关论述`;

    let sourceCitations: number[] | undefined;
    if (Array.isArray(nodeObj.sourceCitations)) {
      const cids = nodeObj.sourceCitations
        .map(Number)
        .filter((cid) => Number.isInteger(cid) && validCitations.has(cid));
      if (cids.length > 0) {
        sourceCitations = [...new Set(cids)];
      }
    }

    nodeMap.set(rawId, {
      id: rawId,
      label: rawLabel.slice(0, 24),
      type: rawType,
      description,
      ...(sourceCitations ? { sourceCitations } : {}),
    });
  }

  // Ensure central topic node exists
  const centralId = 'n0';
  if (!hasCentralTopic || !nodeMap.has(centralId)) {
    nodeMap.set(centralId, {
      id: centralId,
      label: report.question.slice(0, 24) + (report.question.length > 24 ? '…' : ''),
      type: 'topic',
      description: `核心议题: ${report.question}`,
    });
  }

  const nodes: GraphNode[] = Array.from(nodeMap.values());
  // Sort so central topic 'n0' is always first
  nodes.sort((a, b) => {
    if (a.id === centralId) return -1;
    if (b.id === centralId) return 1;
    return a.id.localeCompare(b.id);
  });

  if (nodes.length < 3) return null;

  // 2. Process Edges
  const validNodeIds = new Set(nodes.map((n) => n.id));
  const edges: GraphEdge[] = [];
  let edgeCounter = 0;

  for (const item of raw.edges) {
    if (!item || typeof item !== 'object') continue;
    const edgeObj = item as Record<string, unknown>;

    const from = typeof edgeObj.from === 'string' ? edgeObj.from.trim() : '';
    const to = typeof edgeObj.to === 'string' ? edgeObj.to.trim() : '';
    if (!from || !to || from === to || !validNodeIds.has(from) || !validNodeIds.has(to)) {
      continue;
    }

    let predicate: ControlledPredicate = '相关';
    if (typeof edgeObj.predicate === 'string' && VALID_PREDICATES.includes(edgeObj.predicate as ControlledPredicate)) {
      predicate = edgeObj.predicate as ControlledPredicate;
    }

    let type: GraphEdgeType = 'inferred';
    if (typeof edgeObj.type === 'string' && VALID_EDGE_TYPES.includes(edgeObj.type as GraphEdgeType)) {
      type = edgeObj.type as GraphEdgeType;
    }

    let citationId: number | undefined;
    if (type === 'supported') {
      const rawCid = Number(edgeObj.citationId);
      if (Number.isInteger(rawCid) && validCitations.has(rawCid)) {
        citationId = rawCid;
      } else {
        // Degrade to inferred if citation doesn't exist
        type = 'inferred';
      }
    }

    const label =
      typeof edgeObj.label === 'string' && edgeObj.label.trim()
        ? edgeObj.label.trim().slice(0, 12)
        : predicate;

    const description =
      typeof edgeObj.description === 'string' && edgeObj.description.trim()
        ? edgeObj.description.trim()
        : `[${from}] 与 [${to}] 存在 ${predicate} 关联`;

    const edgeId =
      typeof edgeObj.id === 'string' && edgeObj.id.trim()
        ? edgeObj.id.trim()
        : `e${++edgeCounter}`;

    edges.push({
      id: edgeId,
      from,
      to,
      subject: from,
      predicate,
      object: to,
      label,
      type,
      ...(citationId !== undefined ? { citationId } : {}),
      description,
    });
  }

  // If LLM returned no valid edges, create minimum inferred edges from n0 to all nodes
  if (edges.length === 0) {
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
        description: `关联: ${nodes[i].label}`,
      });
    }
  }

  const graph: KnowledgeGraph = {
    nodes,
    edges,
    isFallback: false,
  };

  const validation = validateGraph(graph, report);
  if (!validation.valid) {
    return null;
  }

  return graph;
}
