// Multiple-viewpoint report synthesis (PRD v4.2 §3, ticket T2).
//
// The report must answer "what positions exist, what supports each of them,
// and which is better supported / more feasible" — never by stacking
// materials or by truncating abstracts into fake viewpoints.
//
// The model path returns strict JSON and is validated field by field. Anything
// that is a source title, a lift from an excerpt, or points at a citation that
// does not exist is rejected, not relaxed. If a valid AI synthesis cannot be
// produced, the report has no core viewpoints; material text is never promoted
// into a viewpoint by a deterministic fallback.

import type {
  ReportEvidence,
  ReportSynthesis,
  ReportViewpoint,
  Source,
} from './providers';

export const MAX_SYNTHESIS_VIEWPOINTS = 3;
export const MAX_CONCLUSION_CHARS = 200;
export const MAX_EVIDENCE_SUMMARY_CHARS = 320;
/** Keep each first-pass model request small enough for predictable latency. */
export const MAX_SOURCES_PER_SYNTHESIS_BATCH = 5;

/** Prompt/serialization limits so one report cannot blow up the request. */
export const SOURCE_TITLE_MAX_CHARS = 60;
export const SOURCE_EXCERPT_MAX_CHARS = 400;

/** One cited material as it is handed to the model. */
export interface SynthesisSource {
  /** 1-based citation id — the only handle the model may reference. */
  citationId: number;
  title: string | null;
  excerpt: string | null;
  kindLabel: string;
}

export interface SynthesisRequest {
  question: string;
  sources: SynthesisSource[];
}

// ---------------------------------------------------------------------------
// Prompt construction (the request boundary)
// ---------------------------------------------------------------------------

const SYNTHESIS_SYSTEM_PROMPT =
  '你是"知研"报告综合器。阅读用户给出的问题与编号材料，输出围绕该问题存在的多个观点。' +
  '每个观点必须是一条可以被讨论、被质疑的判断，而不是材料标题的复述或原文摘录的截断。' +
  '只输出 JSON，不要任何解释、前后缀或 markdown 代码块。';

const SYNTHESIS_CONSTRAINTS = [
  '约束：',
  '1. 只输出一个 JSON 对象，形如 {"viewpoints":[{"conclusion":"...","evidence":[{"summary":"...","citationIds":[1]}]}]}。',
  `2. viewpoints 输出 1 到 ${MAX_SYNTHESIS_VIEWPOINTS} 条，每条 conclusion 不超过 ${MAX_CONCLUSION_CHARS} 字，必须是一条明确判断。`,
  '3. conclusion 不得等于任一材料标题，不得直接照抄或截断材料摘录，不得编造材料未表达的事实、数据或因果。',
  '4. 对每个观点，罗列所有直接支持该观点的材料；同一材料可支持多个观点，无关材料不要硬塞。',
  '5. evidence 只放直接支持该观点的短依据，每条 summary 不超过 ' +
    `${MAX_EVIDENCE_SUMMARY_CHARS} 字；citationIds 只能使用下面给出的材料编号。`,
  '6. 只依据所给材料；材料不足以支持某个观点时，就不要输出该观点。不要输出综合结论、最终判断或额外字段。',
].join('\n');

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Assemble the chat messages for a synthesis request. */
export function buildSynthesisMessages(request: SynthesisRequest): Array<{
  role: 'system' | 'user';
  content: string;
}> {
  const materialLines = request.sources.map((source) => {
    const title = source.title?.trim() || '（无标题）';
    const excerpt = source.excerpt?.trim() || '（无摘要）';
    return `[${source.citationId}] ${source.kindLabel}｜标题：${truncate(title, SOURCE_TITLE_MAX_CHARS)}\n` +
      `摘录：${truncate(excerpt, SOURCE_EXCERPT_MAX_CHARS)}`;
  });

  const user = [
    `问题：${request.question}`,
    '',
    '材料：',
    ...materialLines,
    '',
    SYNTHESIS_CONSTRAINTS,
  ].join('\n');

  return [
    { role: 'system', content: SYNTHESIS_SYSTEM_PROMPT },
    { role: 'user', content: user },
  ];
}

/** Split source material without rewriting its report-wide citation ids. */
export function partitionSynthesisSources(sources: SynthesisSource[]): SynthesisSource[][] {
  const batches: SynthesisSource[][] = [];
  for (let index = 0; index < sources.length; index += MAX_SOURCES_PER_SYNTHESIS_BATCH) {
    batches.push(sources.slice(index, index + MAX_SOURCES_PER_SYNTHESIS_BATCH));
  }
  return batches;
}

/**
 * Build the second-pass request from compact, cited first-pass findings.
 * The final model sees the candidate conclusions and their original citation
 * ids, never the complete raw material set again.
 */
export function buildFinalSynthesisMessages(
  question: string,
  candidates: ReportSynthesis[]
): Array<{ role: 'system' | 'user'; content: string }> {
  const candidateLines = candidates.flatMap((candidate, batchIndex) =>
    candidate.viewpoints.map((viewpoint, viewpointIndex) => [
      `分组 ${batchIndex + 1} / 候选 ${viewpointIndex + 1}：${viewpoint.conclusion}`,
      ...viewpoint.evidence.map(
        (evidence) => `依据：${evidence.summary} ${evidence.citationIds.map((id) => `[${id}]`).join('')}`
      ),
    ].join('\n'))
  );

  return [
    {
      role: 'system',
      content:
        '你是"知研"报告综合器。根据若干已引用的候选发现，归并、去重并产出最终核心观点。' +
        '每个观点必须是重新组织后的可讨论判断，不能照抄候选结论。只输出 JSON，不要解释或 markdown。',
    },
    {
      role: 'user',
      content: [
        `问题：${question}`,
        '',
        '分组候选发现：',
        ...candidateLines,
        '',
        SYNTHESIS_CONSTRAINTS,
      ].join('\n'),
    },
  ];
}

// ---------------------------------------------------------------------------
// Validation — strict, never relaxing
// ---------------------------------------------------------------------------

/** Compare text ignoring whitespace and punctuation. */
export function normalizeForComparison(text: string): string {
  return text.replace(/\s+/g, '').replace(/[，。！？；：、,.;:!?"'“”‘’（）()【】\[\]]/g, '');
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function asCitationIds(value: unknown, validIds: Set<number>): number[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<number>();
  const ids: number[] = [];
  for (const entry of value) {
    if (typeof entry !== 'number' || !Number.isInteger(entry)) continue;
    if (!validIds.has(entry) || seen.has(entry)) continue;
    seen.add(entry);
    ids.push(entry);
  }
  return ids;
}

/**
 * True when the candidate conclusion is merely lifted from the material:
 * it is a source title, or it appears verbatim inside an excerpt, or it
 * swallows an entire excerpt. Such text is a citation, not a viewpoint.
 */
export function isLiftedFromMaterial(conclusion: string, sources: SynthesisSource[]): boolean {
  const candidate = normalizeForComparison(conclusion);
  if (candidate.length === 0) return true;

  for (const source of sources) {
    const title = source.title?.trim();
    if (title && normalizeForComparison(title) === candidate) return true;

    const excerpt = source.excerpt?.trim();
    if (!excerpt) continue;
    const normalizedExcerpt = normalizeForComparison(excerpt);
    if (normalizedExcerpt.length === 0) continue;
    // A conclusion that is contained in the excerpt (or contains the whole
    // excerpt) has not added any judgement of its own.
    if (normalizedExcerpt.includes(candidate)) return true;
    if (candidate.includes(normalizedExcerpt)) return true;
  }
  return false;
}

function parseViewpoint(raw: unknown, sources: SynthesisSource[], index: number): ReportViewpoint | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;

  const conclusion = asString(record.conclusion);
  if (conclusion === null || conclusion.length > MAX_CONCLUSION_CHARS) return null;
  if (isLiftedFromMaterial(conclusion, sources)) return null;

  const validIds = new Set(sources.map((s) => s.citationId));
  const rawEvidence = Array.isArray(record.evidence) ? record.evidence : [];
  const evidence: ReportEvidence[] = [];
  for (const item of rawEvidence) {
    if (typeof item !== 'object' || item === null) continue;
    const evidenceRecord = item as Record<string, unknown>;
    const summary = asString(evidenceRecord.summary);
    if (summary === null || summary.length > MAX_EVIDENCE_SUMMARY_CHARS) continue;
    const citationIds = asCitationIds(evidenceRecord.citationIds, validIds);
    if (citationIds.length === 0) continue;
    evidence.push({ summary, citationIds });
  }

  // A viewpoint with nothing traceable behind it is not evidence-backed.
  if (evidence.length === 0) return null;

  return { id: `vp_${index + 1}`, conclusion, evidence };
}

/**
 * Parse and validate an untrusted model response. Returns null for anything
 * that does not survive validation — the caller then falls back, it never
 * coerces the model output into shape.
 */
export function parseSynthesisResponse(
  content: string,
  sources: SynthesisSource[]
): ReportSynthesis | null {
  const trimmed = content.trim();
  // Models love markdown fences; strip them before parsing, never after.
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(withoutFence);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== 'viewpoints')) return null;

  if (!Array.isArray(record.viewpoints)) return null;
  const viewpoints: ReportViewpoint[] = [];
  record.viewpoints
    .slice(0, MAX_SYNTHESIS_VIEWPOINTS)
    .forEach((raw, index) => {
      const viewpoint = parseViewpoint(raw, sources, index);
      if (viewpoint) viewpoints.push(viewpoint);
    });

  if (viewpoints.length === 0) return null;
  return { viewpoints };
}

/**
 * Re-check a provider-supplied synthesis against the material (defence in
 * depth): the builder must not publish a viewpoint that is a source title or
 * an excerpt lift, or one whose evidence points nowhere, no matter which
 * provider produced it.
 */
export function isSynthesisUsable(
  synthesis: ReportSynthesis,
  sources: SynthesisSource[]
): boolean {
  if (synthesis.viewpoints.length === 0) return false;

  const validIds = new Set(sources.map((s) => s.citationId));
  return synthesis.viewpoints.every((viewpoint) => {
    if (viewpoint.conclusion.trim().length === 0) return false;
    if (isLiftedFromMaterial(viewpoint.conclusion, sources)) return false;
    return viewpoint.evidence.some(
      (item) =>
        item.summary.trim().length > 0 && item.citationIds.some((id) => validIds.has(id))
    );
  });
}

export function sourceKindLabel(source: Source): string {
  switch (source.type) {
    case 'zhihu': return '知乎社区材料';
    case 'web': return '外部检索材料';
    case 'personal_history': return '个人历史材料';
    case 'ai_synthesis': return 'AI 综合材料';
  }
}

/** Turn grouped report sources into the numbered form both paths share. */
export function toSynthesisSources(grouped: Source[]): SynthesisSource[] {
  return grouped.map((source, index) => ({
    citationId: index + 1,
    title: source.title,
    excerpt: source.excerpt,
    kindLabel: sourceKindLabel(source),
  }));
}
