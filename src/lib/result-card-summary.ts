// AI-authored initial/final position summary for the result card.
//
// This module never touches the message text shown elsewhere in the card —
// it only builds the model prompt and validates the model's summary output.
// The summary is prose the model writes, so it is always displayed labeled
// as an AI summary (never attributed to the user), and it must trace back to
// real messages: `sourceMessageIds` is validated against the exact set of
// message ids handed to the model, and an empty or out-of-range reference
// discards that half of the summary rather than being coerced into shape —
// same non-fabrication discipline as report-synthesis.ts.

import type { AISummaryItem, ResultCardAISummary } from './providers';
import { extractJsonObject } from './question-rewriter';

/** Placeholder id for the session's freeform initial opinion (mirrors result-card-builder.ts). */
export const INITIAL_OPINION_ID = 'initial_opinion';

/** Hard cap on one summary sentence — a summary, not a restatement of the whole conversation. */
export const MAX_SUMMARY_TEXT_CHARS = 200;

export interface SummaryAnswerInput {
  id: string;
  text: string;
}

export interface LLMChatMessageInput {
  role: 'system' | 'user';
  content: string;
}

const SUMMARY_SYSTEM_PROMPT =
  '你是"知研"思辨记录总结助手。阅读用户在一次思辨会话中的初始观点与后续回答，' +
  '分别用一句话总结用户的"初始观点"与"最终观点"。' +
  '只能概括已给内容，禁止引入用户未表达过的事实、立场或细节，禁止替用户下结论或评判对错。' +
  '如果没有足够内容支撑某一项总结，该项返回 null，不要编造。' +
  '只输出合法 JSON，不要任何解释、前后缀或 markdown 代码块。';

function buildSummaryConstraints(validIds: string[]): string {
  return [
    '约束：',
    `1. 只输出一个 JSON 对象，形如 {"initial":{"text":"...","sourceMessageIds":["..."]}` +
      `,"final":{"text":"...","sourceMessageIds":["..."]}}。`,
    `2. text 是对该项内容的一句话总结（不超过 ${MAX_SUMMARY_TEXT_CHARS} 字），必须是你自己的概括性表述，不要逐字照抄原文。`,
    '3. sourceMessageIds 是支撑该总结的消息 id 列表，且只能使用下面给出的合法 id，不能编造不存在的 id，不能为空数组。',
    `4. 合法 id 集合：${validIds.join('、') || '（无）'}。`,
    '5. 如果没有足够信息支撑 initial 或 final 中的某一项，该项的值输出 null，不要编造内容。',
    '6. 不输出除 initial、final 之外的任何字段。',
  ].join('\n');
}

/**
 * Build the system + user messages for the initial/final position summary.
 * Only the initial opinion text and the round-answer id+text pairs are sent
 * — no other session data (report, strategy history, urls) ever leaves the
 * server for this request.
 */
export function buildSummaryMessages(
  initialOpinion: string | null,
  answers: SummaryAnswerInput[]
): LLMChatMessageInput[] {
  const validIds: string[] = [
    ...(initialOpinion && initialOpinion.trim() ? [INITIAL_OPINION_ID] : []),
    ...answers.map((a) => a.id),
  ];

  const lines: string[] = [];
  if (initialOpinion && initialOpinion.trim()) {
    lines.push(`[${INITIAL_OPINION_ID}] 用户最初的观点：${initialOpinion.trim()}`);
  }
  answers.forEach((a) => {
    lines.push(`[${a.id}] ${a.text}`);
  });

  const user = [
    '以下是用户在本次思辨会话中的发言，按时间顺序排列：',
    lines.length > 0 ? lines.join('\n') : '（无内容）',
    '',
    buildSummaryConstraints(validIds),
  ].join('\n');

  return [
    { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
    { role: 'user', content: user },
  ];
}

function parseSummaryItem(raw: unknown, validIds: Set<string>): AISummaryItem | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;

  const text = typeof record.text === 'string' ? record.text.trim() : '';
  if (text.length === 0 || text.length > MAX_SUMMARY_TEXT_CHARS) return null;

  const rawIds = record.sourceMessageIds;
  if (!Array.isArray(rawIds) || rawIds.length === 0) return null;

  const seen = new Set<string>();
  const sourceMessageIds: string[] = [];
  for (const entry of rawIds) {
    if (typeof entry !== 'string') continue;
    if (!validIds.has(entry) || seen.has(entry)) continue;
    seen.add(entry);
    sourceMessageIds.push(entry);
  }
  // Every remaining id must have been valid — any unresolvable reference
  // means the model pointed at content that doesn't exist, so the whole
  // item is untrustworthy rather than partially trusted.
  if (sourceMessageIds.length !== rawIds.filter((e) => typeof e === 'string').length) return null;
  if (sourceMessageIds.length === 0) return null;

  return { text, sourceMessageIds };
}

/**
 * Parse and validate an untrusted model response into a ResultCardAISummary.
 * `initial` and `final` are validated independently: a malformed or
 * ungrounded half becomes null without discarding a valid other half.
 * Returns null only when the response is not parseable JSON at all — an
 * all-null summary is a legitimate (if uninformative) result, kept so the
 * caller can distinguish "model said nothing to summarize" from "call
 * failed", though both currently render no section in the UI.
 */
export function parseSummaryResponse(
  rawText: string,
  initialOpinion: string | null,
  answers: SummaryAnswerInput[]
): ResultCardAISummary | null {
  const cleanJson = extractJsonObject(rawText);
  if (cleanJson === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleanJson);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as Record<string, unknown>;

  const validIds = new Set<string>([
    ...(initialOpinion && initialOpinion.trim() ? [INITIAL_OPINION_ID] : []),
    ...answers.map((a) => a.id),
  ]);

  return {
    initial: parseSummaryItem(record.initial, validIds),
    final: parseSummaryItem(record.final, validIds),
  };
}
