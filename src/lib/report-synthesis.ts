// Multiple-viewpoint report synthesis (PRD v4.2 §3, ticket T2).
//
// The report must answer "what positions exist, what supports each of them,
// and which is better supported / more feasible" — never by stacking
// materials or by truncating abstracts into fake viewpoints.
//
// Two paths, one contract:
//
//   1. LLM path — an OpenAI-compatible model returns strict JSON which is
//      validated field by field. Anything that is a source title, a lift from
//      an excerpt, or points at a citation that does not exist is REJECTED,
//      not relaxed.
//   2. Deterministic fallback — used when no model is configured, the call
//      fails, or the model output does not survive validation. It states each
//      material's position and attributes it; it never invents a second
//      viewpoint when only one material exists.
//
// Honesty red lines: the fallback is not dressed up as a model synthesis,
// evidence always carries real citation ids, and a viewpoint with no valid
// evidence is dropped rather than padded.

import type {
  ReportEvidence,
  ReportSynthesis,
  ReportViewpoint,
  Source,
} from './providers';

export const MAX_SYNTHESIS_VIEWPOINTS = 3;
export const MAX_CONCLUSION_CHARS = 200;
export const MAX_EVIDENCE_SUMMARY_CHARS = 320;
export const MAX_SYNTHESIS_SUMMARY_CHARS = 600;

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
  '1. 只输出一个 JSON 对象，形如 {"viewpoints":[{"conclusion":"...","evidence":[{"summary":"...","citationIds":[1]}]}],"summary":"..."}。',
  `2. viewpoints 最多 ${MAX_SYNTHESIS_VIEWPOINTS} 条，每条 conclusion 不超过 ${MAX_CONCLUSION_CHARS} 字，必须是一条明确判断。`,
  '3. conclusion 不得等于任一材料标题，不得直接照抄或截断材料摘录，不得编造材料未表达的事实、数据或因果。',
  '4. evidence 只放直接支持该观点的短依据，每条 summary 不超过 ' +
    `${MAX_EVIDENCE_SUMMARY_CHARS} 字；citationIds 只能使用下面给出的材料编号。`,
  '5. 只依据所给材料；材料不足以支持某个观点时，就不要输出该观点。',
  `6. summary 不超过 ${MAX_SYNTHESIS_SUMMARY_CHARS} 字，比较各观点的支撑多少、各自更适用的情境、以及现实可行性或证据局限；不要宣布唯一正确答案。`,
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

  const summary = asString(record.summary);
  if (summary === null || summary.length > MAX_SYNTHESIS_SUMMARY_CHARS) return null;

  if (!Array.isArray(record.viewpoints)) return null;
  const viewpoints: ReportViewpoint[] = [];
  record.viewpoints
    .slice(0, MAX_SYNTHESIS_VIEWPOINTS)
    .forEach((raw, index) => {
      const viewpoint = parseViewpoint(raw, sources, index);
      if (viewpoint) viewpoints.push(viewpoint);
    });

  if (viewpoints.length === 0) return null;
  return { summary, viewpoints };
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
  if (synthesis.summary.trim().length === 0) return false;
  if (synthesis.viewpoints.length === 0) return false;

  const validIds = new Set(sources.map((s) => s.citationId));
  return synthesis.viewpoints.some((viewpoint) => {
    if (viewpoint.conclusion.trim().length === 0) return false;
    if (isLiftedFromMaterial(viewpoint.conclusion, sources)) return false;
    return viewpoint.evidence.some(
      (item) =>
        item.summary.trim().length > 0 && item.citationIds.some((id) => validIds.has(id))
    );
  });
}

// ---------------------------------------------------------------------------
// Deterministic fallback — honest, attributed, never fabricating
// ---------------------------------------------------------------------------

export function sourceKindLabel(source: Source): string {
  switch (source.type) {
    case 'zhihu': return '知乎社区材料';
    case 'web': return '外部检索材料';
    case 'personal_history': return '个人历史材料';
    case 'ai_synthesis': return 'AI 综合材料';
  }
}

/** The first complete sentence of a text, or the whole text when unbreakable. */
export function firstSentence(text: string): string {
  const match = text.match(/^[^。！？!?.；;\n]+[。！？!?]?/);
  const sentence = (match ? match[0] : text).trim();
  return sentence.length > 0 ? sentence : text.trim();
}

/**
 * Build the synthesis without a model: each material's own position, stated
 * as a claim and attributed to its citation. The raw excerpt stays in the
 * evidence, never in the conclusion. One material yields exactly one
 * viewpoint — a second one is never invented.
 */
export function buildFallbackSynthesis(
  question: string,
  sources: SynthesisSource[]
): ReportSynthesis | null {
  if (sources.length === 0) return null;

  const viewpoints: ReportViewpoint[] = sources
    .slice(0, MAX_SYNTHESIS_VIEWPOINTS)
    .map((source, index) => {
      const excerpt = source.excerpt?.trim();
      const claim = excerpt
        ? truncate(firstSentence(excerpt), 120)
        : '该材料没有可引用的摘要，暂不能归纳其具体立场';
      const conclusion = `材料[${source.citationId}]的立场：${claim}`;
      return {
        id: `vp_${index + 1}`,
        conclusion,
        evidence: [
          {
            summary: excerpt
              ? truncate(excerpt, MAX_EVIDENCE_SUMMARY_CHARS)
              : `${source.kindLabel}未提供可引用摘要，不能作为判断依据。`,
            citationIds: [source.citationId],
          },
        ],
      };
    });

  return { summary: buildFallbackSummary(question, sources, viewpoints), viewpoints };
}

/**
 * A summary that actually compares: how much support each position has, what
 * each is more applicable to, and where the evidence is thin.
 */
function buildFallbackSummary(
  _question: string,
  sources: SynthesisSource[],
  viewpoints: ReportViewpoint[]
): string {
  if (viewpoints.length === 1) {
    return (
      `当前只有 1 条可追溯材料，因此只呈现这一种立场；系统不会据此推断它代表普遍共识，` +
      `也不会虚构第二种观点。该立场仅由材料[${sources[0]!.citationId}]支持，` +
      `且只依据检索摘要、未阅读原文，现实可行性有待核验。`
    );
  }

  const supportCounts = viewpoints.map((vp) => {
    const ids = new Set<number>();
    for (const item of vp.evidence) for (const id of item.citationIds) ids.add(id);
    return ids.size;
  });
  const allEqual = supportCounts.every((c) => c === supportCounts[0]);
  const kinds = new Set(sources.map((s) => s.kindLabel));
  const situational =
    kinds.size > 1
      ? '来自不同类型材料的立场适用情境不同：社区材料更贴近具体经验，外部检索材料更适合作为背景参照，个人历史材料只适用于其原本情境。'
      : '这些立场来自同一类材料，适用场景相近，相互之间的可替代性较高。';

  if (allEqual) {
    return (
      `材料呈现 ${viewpoints.length} 种立场，各立场均有独立依据支撑，不能断言某观点显著多于另一观点。` +
      `${situational}共同局限：这里只依据检索摘要、未阅读原文也未经模型交叉综合，` +
      `因此各立场的现实可行性均有待进一步核验。`
    );
  }

  const strongest = supportCounts.indexOf(Math.max(...supportCounts));
  return (
    `材料呈现 ${viewpoints.length} 种立场，其中材料[${sources[strongest]!.citationId}]所代表的立场` +
    `拥有相对更多的独立依据，支撑度更高；其余立场各有 ${supportCounts.filter((c) => c === 1).length} 条依据支持，更适合作为补充或反面对照。` +
    `${situational}共同局限：这里只依据检索摘要，未阅读原文也未经模型交叉综合，` +
    `因此各立场的现实可行性均有待进一步核验。`
  );
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
