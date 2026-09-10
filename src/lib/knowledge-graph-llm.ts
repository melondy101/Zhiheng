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
import { sanitizeGraphLabel, validateGraph } from './knowledge-graph';

export const VALID_PREDICATES: ControlledPredicate[] = [
  '支持',
  '反驳',
  '导致',
  '依赖',
  '影响',
  '对比',
  '构成',
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

export const GRAPH_EXTRACTION_SYSTEM_PROMPT = `你是「知研」专业知识图谱结构化抽取引擎。请深度研读用户提供的核心议题、研报核心观点、知识点以及编号参考材料，精准提取议题的关键实体（核心概念、核心论断、关键主体），并构建实体之间的严谨逻辑思辨关系网络。

【一、实体识别标准与规范】
1. 实体准入标准：
   - 必须是具有独立研报学术/思辨语义的完整短语、专业机制、客观指标或论点判断（长度通常为 2-18 字，核心议题可至 24 字）。
   - 严禁提取口语化短语、残缺动宾搭配、过渡词、提问句式或截断片段（如“已无法避免”、“能做的只有”、“这是否意味着”、“一文读懂”、“做空”、“大家怎么看”等一律禁止）。
2. 实体分类规范（type）：
   - 'topic': 核心研讨议题（固定且唯一，id 必须为 'n0'）。
   - 'concept': 核心专业概念、机理/模型、客观指标或技术路径（如“1.5℃温控阈值”、“超额升温机制 (Overshoot)”、“碳配额定价机制”）。
   - 'claim': 报告与材料中的核心论断、理论假说或对立观点（如“短时超温存在滞后恢复窗口”、“过度依赖将造成认知外包风险”）。
   - 'actor': 提出观点、进行实证研究或制定规则的关键组织/学术机构/代表性主体（如“联合国气候组织 (UNFCCC)”、“清华大学教育团队”）。
3. 实体解释质量（description 必须实质详实）：
   - 每个节点的 description 必须提供 15-60 字的具体解释，清晰阐述该实体在本次议题中的具体定义、运作机理、论断依据或争议焦点。
   - 严禁输出毫无信息增量的敷衍模板（严禁输出如“某某相关论述”、“这是关键概念”等空洞套话）。

【二、关系类型与逻辑受控规范】
1. 谓词严格受控：关系谓词（predicate）仅限使用以下 9 种思辨关系之一：
   - '支持': 证据/事实/机制为某一论点提供正向证明或理论支撑。
   - '反驳': 反例/质疑/对立机制削弱或推翻某一论点。
   - '导致': 前者作为直接原因或机制诱因引发后者的发生或演化。
   - '依赖': 某一观点的成立或机制的运作必须以前提条件或基础概念为依据。
   - '影响': 前者变量、政策或因素对后者的状态或走向产生显著调制。
   - '对比': 两个相互对照、权衡取舍或存在辩证张力的概念/方案/论断。
   - '构成': 要素、子机制或关键维度属于母系统的结构组成部分。
   - '主张': 主体（研究机构/学者团队）提出或坚持特定的论断/假说。
   - '相关': 明确存在紧密语义关联但尚未确立具体因果/逻辑关系时的兜底谓词。
2. 关系说明规范（description）：
   - 每条边的 description 必须具体解释两节点之间的实质逻辑链条（如：“文献[1]实证表明自适应学习算法能动态调节习题难度，从而在因果上导致个性化掌握度提升”）。
3. 真实引用约束：
   - 所有 type 为 'supported' 的边和节点的 sourceCitations 只能填写所给参考材料中真实存在的编号 [1, 2, ...]，严禁捏造编号。无直接文献标引的逻辑推断，type 标为 'inferred' 且不填 citationId。

【三、数量与动态生成原则】
- 节点与边的数量无需固定凑数，请根据所给材料的实际信息量与思辨深度自然决定（通常在 4-12 个实体节点与相应逻辑边）。
- 坚持宁缺毋滥，严禁为了凑数生成虚构或无信息量的冗余节点。

【输出格式】
必须直接输出符合如下规范的合法 JSON 对象，严禁包含任何前缀、额外解释说明或 markdown 代码块标记：
{
  "nodes": [
    {
      "id": "n0",
      "label": "核心议题精炼概述",
      "type": "topic",
      "description": "本次研讨探讨的核心议题与背景边界",
      "sourceCitations": []
    },
    {
      "id": "n1",
      "label": "专业概念或机理名称",
      "type": "concept",
      "description": "该概念在议题中的具体定义与在论证链条中所起的作用",
      "sourceCitations": [1]
    }
  ],
  "edges": [
    {
      "id": "e1",
      "from": "n0",
      "to": "n1",
      "predicate": "依赖",
      "label": "核心前提",
      "type": "supported",
      "citationId": 1,
      "description": "议题论证依赖该核心概念所界定的前提条件，由文献[1]论述"
    }
  ]
}`;

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
  // Strip <think>...</think> tags emitted by reasoning models
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  // Extract from markdown code fences if present
  const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch) {
    cleaned = codeBlockMatch[1].trim();
  } else {
    // Locate the outermost JSON object boundaries
    const nodesStart = cleaned.indexOf('{"nodes"');
    const altStart = nodesStart !== -1 ? nodesStart : cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (altStart !== -1 && end !== -1 && end > altStart) {
      cleaned = cleaned.slice(altStart, end + 1);
    }
  }

  // Sanitize trailing commas in JSON arrays/objects
  cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');

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
    const cleanedLabel = rawId === 'n0' ? rawLabel.slice(0, 24) : sanitizeGraphLabel(rawLabel);
    if (!cleanedLabel) continue;

    let rawType = typeof nodeObj.type === 'string' ? (nodeObj.type.toLowerCase() as GraphNodeType) : 'concept';
    if (!VALID_NODE_TYPES.includes(rawType)) {
      rawType = 'concept';
    }

    if (rawType === 'topic' || rawId === 'n0') {
      rawType = 'topic';
      hasCentralTopic = true;
    }

    let description =
      typeof nodeObj.description === 'string' && nodeObj.description.trim()
        ? nodeObj.description.trim()
        : '';

    if (!description || description.endsWith('相关论述') || description.length < 4) {
      if (rawType === 'topic') {
        description = `核心研讨议题：${report.question}`;
      } else if (rawType === 'claim') {
        description = `研报核心论点：围绕「${cleanedLabel}」展开的立场判断与论据支撑。`;
      } else if (rawType === 'actor') {
        description = `关键主体「${cleanedLabel}」在议题讨论中提出的专业见解或实证研究。`;
      } else {
        description = `专业概念「${cleanedLabel}」是本次研报分析的基础机理与关键要素。`;
      }
    }

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
      label: cleanedLabel.slice(0, 24),
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

    const fromNode = nodeMap.get(from);
    const toNode = nodeMap.get(to);
    const fromLabel = fromNode ? fromNode.label : from;
    const toLabel = toNode ? toNode.label : to;

    const description =
      typeof edgeObj.description === 'string' && edgeObj.description.trim()
        ? edgeObj.description.trim()
        : `[${fromLabel}] 与 [${toLabel}] 存在 ${predicate} 逻辑关联`;

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
