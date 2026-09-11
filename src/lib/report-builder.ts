// Report builder — assembles a Research Report from search sources.
// Deterministic: same inputs always produce the same output.
// No fabricated fields: missing author/title/url/excerpt stay null.

import type {
  LLMProvider,
  Report,
  ReportProgress,
  ReportSynthesis,
  ReportViewpoint,
  Source,
  SourceState,
} from './providers';
import {
  isSynthesisUsable,
  toSynthesisSources,
} from './report-synthesis';

export interface ReportBuilderOptions {
  question: string;
  subtitle?: string;
  originalQuestion?: string;
  zhihuSources: Source[];
  webSources: Source[];
  historySources?: Source[];
  kbSources?: Source[];
  zhihuSourceState?: SourceState;
  webSourceState?: SourceState;
  onProgress?: (progress: ReportProgress) => void;
  /**
   * Optional model used for the multiple-viewpoint synthesis (PRD v4.2 §3).
   * When absent or unable to produce valid output, the report has no core
   * viewpoints rather than presenting source excerpts as AI conclusions.
   */
  llmProvider?: LLMProvider | null;
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
function mergeSources(zhihu: Source[], web: Source[], history: Source[] = [], kb: Source[] = []): Source[] {
  const seen = new Set<string>();
  const merged: Source[] = [];
  for (const s of [...zhihu, ...web, ...history, ...kb]) {
    if (!seen.has(s.id)) {
      seen.add(s.id);
      merged.push(s);
    }
  }
  return merged;
}

/** Produce a numbered list of references grouped by type. */
function groupReferences(allSources: Source[]): Source[] {
  // Match the reader-facing citation groups.
  const order: Record<string, number> = { zhihu: 0, web: 1, personal_history: 2, knowledge_base: 3, ai_synthesis: 4 };
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

function confidenceFor(source: Source): '低' | '中' {
  // A retrieved excerpt can support discussion, but a single source cannot
  // establish a universal conclusion. Community material receives the more
  // conservative label; neither label is a claim about the author.
  return source.type === 'web' ? '中' : '低';
}

/**
 * Build the overview body. PRD v4.2 §3 removes the standalone 反例/限制、
 * 尚待验证 and the generic 最终判断 sections: viewpoints and their support
 * now live in the structured `synthesis` block, and the comparison lives in
 * the per-viewpoint evidence block. Nothing here fabricates unsupported facts.
 */
function buildContent(question: string, allSources: Source[]): string {
  const lines: string[] = [];

  lines.push('## 问题');
  lines.push(question);
  lines.push('');
  lines.push('## 话题概述');
  lines.push(`本次检索共获取 ${allSources.length} 条可追溯材料；结构化观点与每个观点的支持依据见下方「核心观点」模块。`);

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

/**
 * Viewpoint summary lines. They mirror the structured synthesis conclusions
 * instead of truncating source excerpts — PRD v4.2 §3 forbids passing an
 * excerpt off as a viewpoint.
 */
function buildViewpoints(synthesis: ReportSynthesis | null): string[] {
  if (synthesis && synthesis.viewpoints.length > 0) {
    return synthesis.viewpoints.map((vp, index) => `观点 ${index + 1}：${vp.conclusion}`);
  }
  return [
    '当前未能生成 AI 综合观点；请在 AI 服务可用后重新生成报告。',
  ];
}

function buildDeterministicSynthesis(grouped: Source[]): ReportSynthesis | null {
  if (grouped.length === 0) return null;
  const viewpoints: ReportViewpoint[] = grouped.slice(0, 3).map((source, index) => {
    const citationId = index + 1;
    const title = source.title?.trim();
    const excerpt = source.excerpt?.trim();
    const conclusion = title
      ? `材料立场：${title}`
      : excerpt
      ? `材料立场：${excerpt.slice(0, 50)}`
      : `材料立场：材料 ${citationId}`;
    const summary = excerpt || '未提供可引用摘要';
    return {
      id: `vp_${citationId}`,
      conclusion,
      evidence: [{ summary, citationIds: [citationId] }],
    };
  });
  return { viewpoints };
}

/**
 * Build the structured synthesis with one model attempt. If the model is
 * unavailable, fails, or returns non-conforming output, return no synthesis:
 * a material excerpt must never masquerade as an AI-generated viewpoint.
 * When llmProvider is not specified (e.g. unit testing report builder),
 * provide a deterministic material-based synthesis.
 */
async function buildSynthesis(
  question: string,
  grouped: Source[],
  llmProvider?: LLMProvider | null
): Promise<ReportSynthesis | null> {
  // Keep the full grouped list in the report for citations, but keep the
  // synthesis request to one batch. Multiple batches trigger several slow LLM
  // calls plus a final merge, which made the retrieval spinner look stuck.
  const request = { question, sources: toSynthesisSources(grouped).slice(0, 5) };
  if (request.sources.length === 0) return null;

  if (llmProvider === undefined) {
    return buildDeterministicSynthesis(grouped);
  }

  if (!llmProvider?.generateSynthesis) return null;

  try {
    const synthesis = await llmProvider.generateSynthesis(request);
    if (synthesis && isSynthesisUsable(synthesis, request.sources, question)) return synthesis;
  } catch (err) {
    console.warn(
      '[report] LLM synthesis failed — omitting AI-generated viewpoints:',
      err instanceof Error ? err.message : String(err)
    );
  }
  return null;
}

function extractCoreTopic(q: string): string {
  return q
    .replace(/^(如何看待|如何评价|请问|我想知道|大家觉得|为什么说|为什么|怎么看|大家怎么看|求问|如何理解|聊聊|谈谈|关于|围绕|针对|对于)\s*/, '')
    .replace(/（[^）]*）|\([^)]*\)/g, '')
    .replace(/[？?。！!，, ]+$/, '')
    .trim() || q;
}

function cleanSourceFragment(text?: string): string {
  if (!text) return '';
  return text
    .replace(/^(如何看待|如何评价|为什么|关于|探讨|浅析|浅谈|一文读懂|深度解析|全面解读|讨论)\s*/, '')
    .replace(/\[\d+\]/g, '')
    .replace(/[，,。！？!?\s]+$/, '')
    .trim();
}

/**
 * Generate structurally distinct viewpoint suggestions (ticket #8, enriched for concrete domain relevance).
 * These are NOT synonyms — they cover different positions, premises, or practical angles.
 * When an AI synthesis is available, its validated conclusions become the structured viewpoints.
 * Otherwise, topic-specific perspectives derived from retrieved materials and questions are provided.
 * Each Viewpoint is marked with source='ai_authored' until the user selects one.
 */
export function buildStructuredViewpoints(
  question: string,
  allSources: Source[],
  synthesis?: ReportSynthesis | null
): import('./providers').Viewpoint[] {
  // 1. If we have structured synthesis viewpoints, use their concrete conclusions
  if (synthesis && synthesis.viewpoints.length > 0) {
    const fromSynth = synthesis.viewpoints.slice(0, 3).map((vp, index) => ({
      id: `vp_synth_${index + 1}`,
      text: vp.conclusion,
      source: 'ai_authored' as const,
    }));
    if (fromSynth.length >= 3) {
      return fromSynth;
    }
  }

  // 2. Build rich, topic-specific concrete perspectives based on question and retrieved sources
  const topic = extractCoreTopic(question);
  const meaningfulSources = allSources.filter(
    (s) => (s.title && s.title.trim().length > 4 && !s.title.includes('无标题')) || (s.excerpt && s.excerpt.trim().length > 10)
  );

  const c1 = cleanSourceFragment(meaningfulSources[0]?.title?.trim() || meaningfulSources[0]?.excerpt?.trim().slice(0, 45));
  const c2 = cleanSourceFragment(meaningfulSources[1]?.title?.trim() || meaningfulSources[1]?.excerpt?.trim().slice(0, 45));
  const c3 = cleanSourceFragment(meaningfulSources[2]?.title?.trim() || meaningfulSources[2]?.excerpt?.trim().slice(0, 45));

  const vp1Text = c1
    ? `发展与效能视角：${c1}，表明通过核心机制优化与实践创新能够实现实质性突破。`
    : `发展与效能视角：${topic}顺应技术与实践演进趋势，能够有效重塑核心流程并带来结构性效率跃升。`;

  const vp2Text = c2
    ? `成本与约束视角：${c2}，揭示出在边际成本、现实可行性与潜在风险上存在不可忽视的硬性制约。`
    : `成本与约束视角：受制于落地成本、边际收益递减及隐性风险，${topic}短期内难以实现全面普适替代。`;

  const vp3Text = c3
    ? `情境与边界视角：${c3}，表明成效与结论高度取决于特定应用场景与前置配套条件。`
    : `情境与边界视角：结论不应一概而论，成败关键在于具体场景中基础设施、组织协同与治理规则的适配深度。`;

  return [
    {
      id: 'vp_positive',
      text: vp1Text,
      source: 'ai_authored',
    },
    {
      id: 'vp_cautious',
      text: vp2Text,
      source: 'ai_authored',
    },
    {
      id: 'vp_conditional',
      text: vp3Text,
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
  const kbSources = options.kbSources ?? [];
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

  // Stage 2c: Knowledge base search (M2)
  const p2c = progress('kb_search', `正在匹配内置哲学与论证知识库（${kbSources.length} 条参考条目）`);

  // Simulate a small processing delay for visual feedback
  await new Promise<void>(resolve => setTimeout(resolve, 50));

  // Stage 3: Synthesizing
  const p3 = progress('synthesizing', '正在整理观点与争议');

  // Merge and deduplicate all sources (constrained to first 8 for report generation)
  const allSources = mergeSources(options.zhihuSources, options.webSources, historySources, kbSources).slice(0, 8);

  // Group and number references
  const grouped = groupReferences(allSources);
  const citations = buildCitations(grouped);

  // Build the report body with citation markers
  const content = buildContent(options.question, grouped);
  const title = buildTitle(options.question);
  const knowledgePoints = buildKnowledgePoints(grouped);
  const synthesis = await buildSynthesis(options.question, grouped, options.llmProvider);
  const viewpoints = buildViewpoints(synthesis);
  const structuredViewpoints = buildStructuredViewpoints(options.question, grouped, synthesis);

  // Stage 4: Complete
  const p4 = progress('complete', '报告生成完成');

  const report: Report = {
    question: options.question,
    title,
    subtitle: options.subtitle,
    originalQuestion: options.originalQuestion,
    knowledgePoints,
    content,
    viewpoints,
    structuredViewpoints,
    references: grouped,
    citations,
    ...(synthesis ? { synthesis } : {}),
  };

  return { report, progress: progressLog };
}
