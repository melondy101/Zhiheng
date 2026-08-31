// Report builder — assembles a Research Report from search sources.
// Deterministic: same inputs always produce the same output.
// No fabricated fields: missing author/title/url/excerpt stay null.

import type { Report, ReportProgress, Source, SourceState } from './providers';

export interface ReportBuilderOptions {
  question: string;
  zhihuSources: Source[];
  webSources: Source[];
  historySources?: Source[];
  zhihuSourceState?: SourceState;
  webSourceState?: SourceState;
  onProgress?: (progress: ReportProgress) => void;
}

export interface ReportBuildResult {
  report: Report;
  progress: ReportProgress[];
}

const emit =
  (cb?: (p: ReportProgress) => void, opts?: Pick<ReportBuilderOptions, 'zhihuSourceState' | 'webSourceState'>) =>
  (stage: ReportProgress['stage'], message: string): ReportProgress => {
    const evt: ReportProgress = {
      stage,
      message,
      timestamp: Date.now(),
      zhihuSourceState: opts?.zhihuSourceState,
      webSourceState: opts?.webSourceState,
    };
    cb?.(evt);
    return evt;
  };

/** Merge sources from multiple providers, deduplicate by id. */
function mergeSources(zhihu: Source[], web: Source[], history: Source[] = []): Source[] {
  const seen = new Set<string>();
  const merged: Source[] = [];
  for (const s of [...zhihu, ...web, ...history]) {
    if (!seen.has(s.id)) {
      seen.add(s.id);
      merged.push(s);
    }
  }
  return merged;
}

/** Produce a numbered list of references grouped by type. */
function groupReferences(allSources: Source[]): Source[] {
  // Preserve order: zhihu first, then web, then ai_synthesis, then personal_history
  const order: Record<string, number> = { zhihu: 0, web: 1, ai_synthesis: 2, personal_history: 3 };
  return [...allSources].sort((a, b) => {
    const diff = (order[a.type] ?? 9) - (order[b.type] ?? 9);
    return diff !== 0 ? diff : a.id.localeCompare(b.id);
  });
}

/** Build the numbered citations map: index (1-based) → source. */
function buildCitations(allSources: Source[]): Record<number, Source> {
  const map: Record<number, Source> = {};
  allSources.forEach((src, i) => {
    map[i + 1] = src;
  });
  return map;
}

/** Keep a source excerpt short enough to be readable without changing its meaning. */
function evidenceExcerpt(source: Source): string {
  const excerpt = source.excerpt?.trim();
  // Keep the established visible placeholder for missing provider text. The
  // accompanying limitation makes clear that it is not evidence.
  if (!excerpt) return '（无摘要）';
  return excerpt.length <= 320 ? excerpt : `${excerpt.slice(0, 317)}…`;
}

function sourceKindLabel(source: Source): string {
  switch (source.type) {
    case 'zhihu': return '知乎社区观点材料';
    case 'web': return '外部检索材料';
    case 'personal_history': return '个人历史材料';
    case 'ai_synthesis': return 'AI 综合材料';
  }
}

function confidenceFor(source: Source): '低' | '中' {
  // A retrieved excerpt can support discussion, but a single source cannot
  // establish a universal conclusion. Community material receives the more
  // conservative label; neither label is a claim about the author.
  return source.type === 'web' ? '中' : '低';
}

function limitationFor(source: Source): string {
  if (!source.excerpt?.trim()) return '该来源没有摘要，不能据此判断其完整论证或结论。';
  if (source.type === 'zhihu') return '这是单个社区来源的观点材料，不能据此推断群体共识或普遍事实。';
  if (source.type === 'personal_history') return '这是个人历史上下文，只适用于该历史情境，不能外推为一般结论。';
  return '当前仅保留检索摘要；需要阅读原文并与更多独立材料交叉核验。';
}

/** Build a claim–evidence–reasoning report without inventing unsupported facts. */
function buildContent(question: string, allSources: Source[]): string {
  if (allSources.length === 0) {
    return [
      '## 问题',
      question,
      '',
      '## 一句话结论',
      '当前没有可引用材料，不能形成可验证的结论。',
      '',
      '## 尚待验证',
      '- 需要补充至少一条可追溯的来源材料，再分析观点与证据之间的关系。',
    ].join('\n');
  }
  const lines: string[] = [];

  lines.push('## 问题');
  lines.push(question);
  lines.push('');
  lines.push('## 一句话结论');
  lines.push(`当前检索到 ${allSources.length} 条可追溯材料。它们可以支持讨论其中呈现的具体观点，但不足以单独证明关于“${question}”的普遍结论。`);
  lines.push('');
  lines.push('## 核心观点');

  allSources.slice(0, 3).forEach((source, index) => {
    const citation = allSources.indexOf(source) + 1;
    const title = source.title?.trim() || `来源 ${citation}`;
    const opposing = allSources.length > 1
      ? '其余材料可能提供不同角度；当前未将它们自动归为对该观点的直接反证。'
      : '当前仅有这一条材料，未检索到可直接比较的不同观点。';
    lines.push('');
    lines.push(`### 观点 ${index + 1}：${title}`);
    lines.push(`- 结论强度：${confidenceFor(source)}`);
    lines.push(`- 证明材料：[${citation}] ${sourceKindLabel(source)}${source.author ? `，作者：${source.author}` : ''}`);
    lines.push(`  - 摘录：“${evidenceExcerpt(source)}”`);
    lines.push(`- 推理：上述摘录是该来源对问题的直接相关表述，因此可作为讨论这一观点的材料；它不能单独推出超出摘录范围的事实或因果结论。`);
    lines.push(`- 反证或不同观点：${opposing}`);
    lines.push(`- 局限：${limitationFor(source)}`);
  });

  lines.push('');
  lines.push('## 尚待验证');
  lines.push('- 需要补充独立来源，并阅读原文上下文，才能判断各观点的代表性、适用边界与相互冲突。');
  lines.push('');
  lines.push('## 最终判断');
  lines.push('本报告将材料、推理和局限分开呈现；结论应以证据覆盖范围为限，而不是由来源数量或模型措辞决定。');

  return lines.join('\n');
}

/** Generate title from the question. */
function buildTitle(question: string): string {
  const q = question.trim();
  // Use the question directly as title, truncate if very long
  if (q.length <= 50) return q;
  return q.slice(0, 47) + '...';
}

/** Generate knowledge points from sources. */
function buildKnowledgePoints(allSources: Source[]): string[] {
  if (allSources.length === 0) {
    return [
      '暂无可引用材料，不能形成可验证的知识要点。',
    ];
  }
  return allSources.slice(0, 3).map((source, index) =>
    `材料 ${index + 1}：${source.title?.trim() || evidenceExcerpt(source)}`
  );
}

/** Generate viewpoints from sources. */
function buildViewpoints(allSources: Source[]): string[] {
  if (allSources.length === 0) {
    return [
      '暂无来源观点；需要先补充可追溯材料。',
    ];
  }
  return allSources.slice(0, 3).map((source, index) =>
    `观点 ${index + 1} [${index + 1}]：${evidenceExcerpt(source)}`
  );
}

/**
 * Generate three structurally distinct viewpoint suggestions (ticket #8).
 * These are NOT synonyms — they cover different positions, premises, or practical angles.
 * Each Viewpoint is marked with source='ai_authored' until the user selects one.
 */
export function buildStructuredViewpoints(
  question: string,
  allSources: Source[]
): import('./providers').Viewpoint[] {
  const q = question.trim();
  return [
    {
      id: 'vp_progress',
      text: `渐进视角：关于"${q.slice(0, 20)}${q.length > 20 ? '…' : ''}"，应优先考虑逐步演进和风险可控的路径。`,
      source: 'ai_authored',
    },
    {
      id: 'vp_reform',
      text: `变革视角：现状难以解决该问题，必须从结构上重新思考"${q.slice(0, 16)}${q.length > 16 ? '…' : ''}"的前提与边界。`,
      source: 'ai_authored',
    },
    {
      id: 'vp_evidence',
      text: `证据视角：在形成结论前，需要先收集更多具体数据和实例来验证关键假设，而非依赖直觉。`,
      source: 'ai_authored',
    },
  ];
}

/**
 * Build a research report with real citations.
 *
 * Progress stages:
 *   zhihu_search → web_search → history_search → synthesizing → complete
 */
export async function buildReport(options: ReportBuilderOptions): Promise<ReportBuildResult> {
  const progressLog: ReportProgress[] = [];
  const historySources = options.historySources ?? [];
  const progress = emit(
    (evt) => {
      progressLog.push(evt);
      options.onProgress?.(evt);
    },
    { zhihuSourceState: options.zhihuSourceState, webSourceState: options.webSourceState }
  );

  // Stage 1: Zhihu search (handled by caller — we receive pre-fetched sources)
  const p1 = progress('zhihu_search', `正在检索知乎内容（${options.zhihuSources.length} 条结果）`);

  // Stage 2: Web search (handled by caller)
  const p2 = progress('web_search', `正在检索全网资料（${options.webSources.length} 条结果）`);

  // Stage 2b: History search (handled by caller)
  const p2b = progress('history_search', `正在检索个人历史报告（${historySources.length} 条结果）`);

  // Simulate a small processing delay for visual feedback
  await new Promise<void>(resolve => setTimeout(resolve, 50));

  // Stage 3: Synthesizing
  const p3 = progress('synthesizing', '正在整理观点与争议');

  // Merge and deduplicate all sources
  const allSources = mergeSources(options.zhihuSources, options.webSources, historySources);

  // Group and number references
  const grouped = groupReferences(allSources);
  const citations = buildCitations(grouped);

  // Build the report body with citation markers
  const content = buildContent(options.question, grouped);
  const title = buildTitle(options.question);
  const knowledgePoints = buildKnowledgePoints(grouped);
  const viewpoints = buildViewpoints(grouped);
  const structuredViewpoints = buildStructuredViewpoints(options.question, grouped);

  // Stage 4: Complete
  const p4 = progress('complete', '报告生成完成');

  const report: Report = {
    question: options.question,
    title,
    knowledgePoints,
    content,
    viewpoints,
    structuredViewpoints,
    references: grouped,
    citations,
  };

  return { report, progress: progressLog };
}
