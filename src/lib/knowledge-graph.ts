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
  associationProfile?: string; // Entity association overview / relational profile
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
  '详情',
  '更多',
  '如图',
  '如图所示',
  '据悉',
  '刚刚',
  '刚才',
  '日前',
  '近日',
  '今天',
  '明天',
  '昨天',
  '突发',
  '重磅',
  '最新',
]);

export type BlacklistCategory =
  | 'collective'
  | 'enumeration'
  | 'temporal'
  | 'editorial'
  | 'colloquial'
  | 'stopword';

export interface BlacklistFilterResult {
  isNoise: boolean;
  category?: BlacklistCategory;
  reason?: string;
}

// 1. Enumeration / Placeholder patterns (e.g. "观点 3", "观点3", "观点一", "论点 2", "知识点 1")
const ENUMERATION_NOISE_REGEX =
  /^(?:核心)?(?:观点|论点|分论点|知识点|要点|论据|证据|理由|要素|方案|维度|角度|方面|结论|假说|假设)\s*([0-9一二三四五六七八九十百千万a-zA-Z及和与、\-_\s]*)$/i;

const OUTLINE_NUMBERING_REGEX =
  /^(?:第\s*[0-9一二三四五六七八九十]+\s*(?:点|个|条|步|项|阶段|部分|章|篇|节)|(?:分论点|要点|论据|证据|理由|维度)\s*[:：#№\-]\s*\d+)$/i;

// 2. Collective / Composite grouping patterns (e.g. "邓煜等菲奖得主", "陶哲轩等学者", "张三等专家", "李四等3人")
// Real entities should be atomic (e.g. "邓煜" or "菲尔兹奖"), not composite lists/mentions with "等..."
const COLLECTIVE_MENTION_REGEX =
  /(?:^等(?:菲奖得主|诺奖得主|图灵奖得主|获奖者|得主|专家|学者|教授|院士|研究人员|团队|成员|群体|代表|人))|(?:\S+等(?:菲奖得主|图灵奖得主|诺奖得主|诺贝尔奖得主|沃尔夫奖得主|阿贝尔奖得主|获奖者|得主|专家|学者|教授|院士|研究员|研究人员|人员|成员|群体|代表|嘉宾|同行|老师|同学|团队|机构|组织|高校|大学|大咖|大佬|名家|队伍|人|者)$)|(?:\S+等\s*\d+\s*(?:人|位|名|家|个))/i;

// 3. Temporal adverbs and news recency clickbait noise (e.g. "刚刚", "刚才", "日前", "近日", "突发", "重磅")
const TEMPORAL_NOISE_REGEX =
  /^(?:刚刚|刚才|近日|日前|今天|昨天|前天|明天|现已|现在|目前|此前|据悉|据报道|据称|消息称|突发|重磅|最新|实时|速递|快讯|快报|热议|沸腾|曝光|深剖|速看|重磅消息|最新消息|刚刚发生|近期|今日|昨日|明日|今晨|昨夜|前不久|一段时间以来|近年来|时至今日)$/;

const TEMPORAL_PREFIX_REGEX =
  /^(?:刚刚|刚才|突发|重磅|热议|速递|快报|最新消息)[：:\s_—\-]+/;

// 4. Editorial / Web metadata / Boilerplate
const EDITORIAL_NOISE_REGEX =
  /^(?:全文完|未完待续|点击查看|参考资料|相关阅读|延伸阅读|版权所有|责任编辑|作者简介|导读|引言|结语|概述|前言|目录|编者按|免责声明|注意事项|总结一下|划重点|评论区|点赞|关注|收藏|转发|广告|推广|赞助内容|阅读原文|来源出处)$/;

// 5. Colloquial / Narrative fragments
const COLLOQUIAL_NOISE_REGEX =
  /^(?:写在最前边|家人们|真的|我觉得|说实话|一文读懂|速看|必读|盘点|综上所述|总而言之|显而易见|不难发现|众所周知|众说纷纭|毫无疑问|众所皆知|不得不说|可想而知|究其原因|众所认知|不言而喻|由此可见)/;

/**
 * Checks if a candidate label matches blacklist filters (noise, enumeration placeholders, collective mentions, temporal words).
 */
export function isBlacklistedEntityLabel(raw: string): BlacklistFilterResult {
  if (!raw || typeof raw !== 'string') {
    return { isNoise: true, reason: '标签为空' };
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return { isNoise: true, reason: '标签为空' };
  }
  if (ENUMERATION_NOISE_REGEX.test(trimmed) || OUTLINE_NUMBERING_REGEX.test(trimmed)) {
    return { isNoise: true, category: 'enumeration', reason: '属于占位或序号枚举，非实质语义实体' };
  }
  if (COLLECTIVE_MENTION_REGEX.test(trimmed)) {
    return { isNoise: true, category: 'collective', reason: '属于集合性修饰/列举代称，非原子语义实体' };
  }
  if (TEMPORAL_NOISE_REGEX.test(trimmed)) {
    return { isNoise: true, category: 'temporal', reason: '属于时效副词或新闻提示词，非知识实体' };
  }
  if (EDITORIAL_NOISE_REGEX.test(trimmed)) {
    return { isNoise: true, category: 'editorial', reason: '属于编务/出版占位词，非知识实体' };
  }
  if (COLLOQUIAL_NOISE_REGEX.test(trimmed)) {
    return { isNoise: true, category: 'colloquial', reason: '属于口语引入或修辞过渡语' };
  }
  if (STOP_WORDS.has(trimmed)) {
    return { isNoise: true, category: 'stopword', reason: '命中止用词词表' };
  }
  return { isNoise: false };
}

/** Helper predicate returning whether a label is recognized as entity noise. */
export function isEntityNoise(raw: string): boolean {
  return isBlacklistedEntityLabel(raw).isNoise;
}

const GRAMMAR_PARTICLES_PREFIX = /^(已|能|将|要|会|在|从|到|把|被|让|使|这|那|哪|什么|怎么|怎样|如何|为|给|对|于|是|有|做|与|和|及|为什么|如何看待|这是否意味着|到底什么是)+/;
const GRAMMAR_PARTICLES_SUFFIX = /(的|了|着|过|和|与|及|在|从|到|把|被|让|使|这|那|哪|什么|怎么|怎样|如何|为|给|对|于|是|有|等|吗|呢|吧|啊|呀)+$/;

/** Clean an entity string by stripping punctuation, question prefixes, and grammatical particles. */
export function cleanEntityLabel(raw: string): string {
  let text = raw.trim();
  // Strip temporal prefix if present (e.g. "刚刚：模型发布" -> "模型发布")
  text = text.replace(TEMPORAL_PREFIX_REGEX, '');
  // Strip outline enumeration prefix if present (e.g. "观点 3：人类拥有真正意识" -> "人类拥有真正意识")
  text = text.replace(/^(?:核心)?(?:观点|论点|分论点|知识点|要点|论据|证据)\s*[0-9一二三四五六七八九十a-zA-Z]*[:：\s_—\-]+/i, '');
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
  if (!raw || typeof raw !== 'string') return null;
  // Check blacklist noise filter on raw input first (catches "观点 3", "刚刚", "邓煜等菲奖得主")
  if (isEntityNoise(raw)) return null;

  const text = cleanEntityLabel(raw);
  if (text.length < 2 || text.length > 20 || STOP_WORDS.has(text)) return null;
  // Re-check cleaned text against blacklist noise filter
  if (isEntityNoise(text)) return null;

  // Personal nicknames or diminutive honorifics that are not official institutions
  if (
    /(学院|学长|老师|博士|同学|哥|姐|酱|君)$/.test(text) &&
    text.length <= 8 &&
    !/(大学|中国|国家|科学院|工程院|高等|教育|研究)/.test(text)
  ) {
    return null;
  }
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

  return enrichGraphWithAssociationProfiles({ nodes, edges }, report);
}

/**
 * Synthesizes an informative, structured entity association profile (实体关联简介)
 * explaining how the node connects to other entities, its semantic role in the logical network,
 * and citation backing.
 */
export function generateEntityAssociationProfile(
  node: GraphNode,
  edges: GraphEdge[],
  allNodes: GraphNode[],
  report?: Report
): string {
  const nodeMap = new Map(allNodes.map((n) => [n.id, n]));
  const outgoing = edges.filter((e) => e.from === node.id);
  const incoming = edges.filter((e) => e.to === node.id);

  // Citation tracking
  const citations = new Set<number>();
  if (node.sourceCitations) {
    node.sourceCitations.forEach((c) => citations.add(c));
  }
  for (const edge of [...outgoing, ...incoming]) {
    if (edge.type === 'supported' && typeof edge.citationId === 'number') {
      citations.add(edge.citationId);
    }
  }
  const citationList = Array.from(citations).sort((a, b) => a - b);
  const citationText =
    citationList.length > 0
      ? `文献 [${citationList.join(', ')}] 提供引证`
      : '研报多方论述综合推断';

  // 1. Topic Node (central hub)
  if (node.type === 'topic' || node.id === 'n0') {
    const concepts = outgoing.filter((e) => nodeMap.get(e.to)?.type === 'concept').length;
    const claims = outgoing.filter((e) => nodeMap.get(e.to)?.type === 'claim').length;
    const actors = outgoing.filter((e) => nodeMap.get(e.to)?.type === 'actor').length;
    const parts: string[] = [];
    if (concepts > 0) parts.push(`${concepts} 个核心概念机理`);
    if (claims > 0) parts.push(`${claims} 项主要论辩观点`);
    if (actors > 0) parts.push(`${actors} 位关键实证主体`);
    const breakdown = parts.length > 0 ? `贯穿 ${parts.join('、')}` : '汇聚多维专业要素';
    return `【核心议题枢纽】作为全图的研讨中心，${breakdown}，构建起完整的思辨论证网络；由${citationText}。`;
  }

  // Group outgoing relations by predicate
  const outgoingByPred = new Map<string, string[]>();
  for (const edge of outgoing) {
    const target = nodeMap.get(edge.to);
    if (!target) continue;
    const pred = (edge.predicate || edge.label || '相关').trim();
    if (!outgoingByPred.has(pred)) outgoingByPred.set(pred, []);
    outgoingByPred.get(pred)!.push(target.label);
  }

  // Group incoming relations by predicate
  const incomingByPred = new Map<string, string[]>();
  for (const edge of incoming) {
    const source = nodeMap.get(edge.from);
    if (!source) continue;
    const pred = (edge.predicate || edge.label || '相关').trim();
    if (!incomingByPred.has(pred)) incomingByPred.set(pred, []);
    incomingByPred.get(pred)!.push(source.label);
  }

  const relationClauses: string[] = [];

  // Outgoing predicates
  if (outgoingByPred.has('导致')) {
    relationClauses.push(`作为因果诱因直接导致「${outgoingByPred.get('导致')!.slice(0, 2).join('」、「')}」`);
  }
  if (outgoingByPred.has('支持')) {
    relationClauses.push(`为「${outgoingByPred.get('支持')!.slice(0, 2).join('」、「')}」提供正向理论或实证支撑`);
  }
  if (outgoingByPred.has('反驳')) {
    relationClauses.push(`对「${outgoingByPred.get('反驳')!.slice(0, 2).join('」、「')}」提出辩驳与批判反思`);
  }
  if (outgoingByPred.has('依赖')) {
    relationClauses.push(`论证与运作以前提依赖「${outgoingByPred.get('依赖')!.slice(0, 2).join('」、「')}」`);
  }
  if (outgoingByPred.has('影响')) {
    relationClauses.push(`对「${outgoingByPred.get('影响')!.slice(0, 2).join('」、「')}」的状态走向产生调制影响`);
  }
  if (outgoingByPred.has('对比')) {
    relationClauses.push(`与「${outgoingByPred.get('对比')!.slice(0, 2).join('」、「')}」形成辩证对比和张力考量`);
  }
  if (outgoingByPred.has('主张')) {
    relationClauses.push(`提出并主张核心观点「${outgoingByPred.get('主张')!.slice(0, 2).join('」、「')}」`);
  }
  if (outgoingByPred.has('构成')) {
    relationClauses.push(`构成「${outgoingByPred.get('构成')!.slice(0, 2).join('」、「')}」的关键组成部分`);
  }

  // Incoming predicates
  if (incomingByPred.has('主张') && !outgoingByPred.has('主张')) {
    relationClauses.push(`由关键主体「${incomingByPred.get('主张')!.slice(0, 2).join('」、「')}」提出并主张`);
  }
  if (incomingByPred.has('依赖') && !outgoingByPred.has('依赖')) {
    relationClauses.push(`作为核心前提被「${incomingByPred.get('依赖')!.slice(0, 2).join('」、「')}」所依据`);
  }
  if (incomingByPred.has('支持') && !outgoingByPred.has('支持')) {
    relationClauses.push(`受到「${incomingByPred.get('支持')!.slice(0, 2).join('」、「')}」的正向论证支持`);
  }

  // Fallback if no specific predicate clauses matched
  if (relationClauses.length === 0) {
    const connectedLabels = [
      ...outgoing.map((e) => nodeMap.get(e.to)?.label).filter(Boolean),
      ...incoming.map((e) => nodeMap.get(e.from)?.label).filter(Boolean),
    ].filter((l) => l !== node.label);
    const uniqueConnected = Array.from(new Set(connectedLabels)).slice(0, 2);
    if (uniqueConnected.length > 0) {
      relationClauses.push(`与「${uniqueConnected.join('」、「')}」保持紧密逻辑关联`);
    } else {
      relationClauses.push(`作为关键维度关联至核心研讨议题`);
    }
  }

  const typeName =
    node.type === 'actor'
      ? '关键实证主体'
      : node.type === 'claim'
      ? '研报核心观点'
      : '专业机理概念';

  return `【${typeName}】在议题拓扑中${relationClauses.join('；')}；由${citationText}。`;
}

/**
 * Enriches all graph nodes with entity association profiles (实体关联简介).
 */
export function enrichGraphWithAssociationProfiles(
  graph: KnowledgeGraph,
  report?: Report
): KnowledgeGraph {
  if (!graph || !Array.isArray(graph.nodes)) return graph;
  const nodes = graph.nodes.map((node) => {
    const profile = generateEntityAssociationProfile(node, graph.edges || [], graph.nodes, report);
    return {
      ...node,
      associationProfile: node.associationProfile || profile,
    };
  });
  return {
    ...graph,
    nodes,
  };
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

  return enrichGraphWithAssociationProfiles(
    {
      nodes,
      edges,
      isFallback: true,
      degradedReason: reason,
    },
    report
  );
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
