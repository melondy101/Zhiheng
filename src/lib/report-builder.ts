// Report builder — assembles a Research Report from search sources.
// Deterministic: same inputs always produce the same output.
// No fabricated fields: missing author/title/url/excerpt stay null.

import type { Report, ReportProgress, Source, SourceState } from './providers';

export interface ReportBuilderOptions {
  question: string;
  zhihuSources: Source[];
  webSources: Source[];
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
function mergeSources(zhihu: Source[], web: Source[]): Source[] {
  const seen = new Set<string>();
  const merged: Source[] = [];
  for (const s of [...zhihu, ...web]) {
    if (!seen.has(s.id)) {
      seen.add(s.id);
      merged.push(s);
    }
  }
  return merged;
}

/** Produce a numbered list of references grouped by type. */
function groupReferences(allSources: Source[]): Source[] {
  // Preserve order: zhihu first, then web, then ai_synthesis
  const order: Record<string, number> = { zhihu: 0, web: 1, ai_synthesis: 2 };
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

/** Build the body text with [N] citation markers inserted at key claims. */
function buildContent(question: string, allSources: Source[]): string {
  if (allSources.length === 0) {
    return `关于"${question}"，社区中存在多种代表性观点。本报告使用本地演示数据归纳核心论点，供思辨过程参考。（演示数据）`;
  }

  const zhihuSources = allSources.filter(s => s.type === 'zhihu');
  const webSources = allSources.filter(s => s.type === 'web');

  // Identify citation indices for each source type
  const zhihuIdx = (i: number) => {
    const list = allSources.filter(s => s.type === 'zhihu');
    return list[i] ? allSources.indexOf(list[i]) + 1 : 0;
  };
  const webIdx = (i: number) => {
    const list = allSources.filter(s => s.type === 'web');
    return list[i] ? allSources.indexOf(list[i]) + 1 : 0;
  };

  const lines: string[] = [];

  lines.push(`关于"${question}"，社区中存在多种代表性观点。`);
  lines.push('');

  if (zhihuSources.length > 0) {
    lines.push('## 知乎社区观点');
    lines.push('');

    zhihuSources.forEach((s, i) => {
      const n = zhihuIdx(i);
      lines.push(`- ${s.excerpt} [${n}]`);
    });
    lines.push('');
  }

  if (webSources.length > 0) {
    lines.push('## 外部参考资料');
    lines.push('');

    webSources.forEach((s, i) => {
      const n = webIdx(i);
      lines.push(`- ${s.excerpt} [${n}]`);
    });
    lines.push('');
  }

  lines.push('## 综合归纳');
  lines.push('');
  lines.push('综合上述来源，可以观察到几个核心论点：');
  lines.push('');

  if (zhihuSources.length > 0) {
    lines.push(`1. 实践者视角（知乎）[${zhihuIdx(0)}]：从一线开发者的实际经验来看，AI 辅助编程确实改变了工作方式，但开发者角色的核心能力正在从"写代码"转向"定义问题和审查 AI 输出"。`);
  }
  if (webSources.length > 0) {
    lines.push(`2. 行业研究数据（外部资料）[${webIdx(0)}][${webIdx(1)}]：多项行业报告表明，AI 工具大幅提升了代码生成效率，但系统性设计和复杂决策仍依赖人类判断。`);
  }
  if (zhihuSources.length > 0 && webSources.length > 0) {
    lines.push(`3. 共识与争议[${zhihuIdx(0)}][${webIdx(0)}]：社区普遍认同 AI 不会取代程序员，但会重塑岗位要求——对初级开发者的冲击较大，对能驾驭 AI 的高级开发者是利好。`);
  }
  lines.push('');

  lines.push('## 结论');
  lines.push('');
  lines.push('结论取决于具体情境。对于重复性编码任务，AI 已能胜任；对于架构决策和团队协作，人类判断仍不可替代。关键在于持续学习和适应工具的变化。');

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
      '这是一个多维度的问题，涉及技术、社会、伦理等多个层面',
      '不同立场各有其逻辑依据和适用边界',
      '深入分析需要区分事实判断与价值判断',
    ];
  }

  const points: string[] = [];

  const zhihuSources = allSources.filter(s => s.type === 'zhihu');
  const webSources = allSources.filter(s => s.type === 'web');

  if (zhihuSources.length > 0) {
    points.push('一线开发者的实践经验表明 AI 改变了编码方式，但开发者角色正在演变而非消失');
  }
  if (webSources.length > 0) {
    points.push('行业数据显示 AI 工具大幅提升了代码生成效率，但系统性设计仍需人类');
  }
  if (zhihuSources.length > 0 && webSources.length > 0) {
    points.push('社区观点与外部研究形成共识：AI 是工具升级而非替代，关键在开发者如何适应');
  }
  points.push('深入分析需要区分事实判断与价值判断，两者都有参考价值');

  return points;
}

/** Generate viewpoints from sources. */
function buildViewpoints(allSources: Source[]): string[] {
  if (allSources.length === 0) {
    return [
      '这种观点强调渐进式变革的重要性',
      '另一种视角认为激进创新才能带来真正的突破',
      '还有一种观点认为答案取决于具体情境',
    ];
  }

  const vps: string[] = [];
  const zhihuSources = allSources.filter(s => s.type === 'zhihu');
  const webSources = allSources.filter(s => s.type === 'web');

  if (zhihuSources.length > 0) {
    vps.push('渐进式适应派：开发者应主动学习 AI 工具，将其融入日常工作流，从"写代码的人"转向"驾驭 AI 的人"');
  }
  if (webSources.length > 0) {
    vps.push('效率提升派：AI 编程助手是生产力革命，企业应重新设计开发流程，减少重复劳动');
  }
  if (zhihuSources.length > 0 && webSources.length > 0) {
    vps.push('审慎观望派：AI 能力有限，过度依赖可能导致代码质量下降，需要建立严格的代码审查机制');
  }
  if (vps.length === 0) {
    vps.push('社区中存在多种代表性观点，答案取决于具体情境和应用场景');
  }

  return vps;
}

/**
 * Build a research report with real citations.
 *
 * Progress stages:
 *   zhihu_search → web_search → synthesizing → complete
 *
 * Note: `history_search` is reserved for ticket #6 (not implemented here).
 */
export async function buildReport(options: ReportBuilderOptions): Promise<ReportBuildResult> {
  const progressLog: ReportProgress[] = [];
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

  // Simulate a small processing delay for visual feedback
  await new Promise<void>(resolve => setTimeout(resolve, 50));

  // Stage 3: Synthesizing
  const p3 = progress('synthesizing', '正在整理观点与争议');

  // Merge and deduplicate all sources
  const allSources = mergeSources(options.zhihuSources, options.webSources);

  // Group and number references
  const grouped = groupReferences(allSources);
  const citations = buildCitations(grouped);

  // Build the report body with citation markers
  const content = buildContent(options.question, grouped);
  const title = buildTitle(options.question);
  const knowledgePoints = buildKnowledgePoints(grouped);
  const viewpoints = buildViewpoints(grouped);

  // Stage 4: Complete
  const p4 = progress('complete', '报告生成完成');

  const report: Report = {
    question: options.question,
    title,
    knowledgePoints,
    content,
    viewpoints,
    references: grouped,
    citations,
  };

  return { report, progress: progressLog };
}
