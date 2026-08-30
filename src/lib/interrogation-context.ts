// Structured interrogation context for ticket #16.
//
// Pure, deterministic construction of everything a question generator needs:
// the selected stance, the user's most recent answer, the report's numbered
// citations, and the round/strategy being planned. No randomness, no I/O, no
// network: identical sessions always yield identical contexts, which keeps
// the fixture provider and the fallback templates testable.
//
// Guardrails enforced here (issue #16):
// - Claim fragments are quoted verbatim from the user's input or the selected
//   stance — never invented, never answered on the user's behalf.
// - Sources are pass-through references to real Report.citations entries;
//   a source without a usable URL is never selected for rendering as a link,
//   so no URL can ever be fabricated downstream.

import type { CitedSource, Session, Viewpoint } from './providers';
import { isRoundAnswer } from './providers';
import type { StrategyId } from './strategy-engine';

export interface InterrogationContext {
  /** The round whose question is being planned (1-based). */
  round: number;
  strategy: StrategyId;
  /** The session topic question. */
  question: string;
  /** The selected stance text and its provenance, when one is selected. */
  stance: { text: string; source: Viewpoint['source'] } | null;
  /** The user's most recent answer text; null before the first answer. */
  lastAnswer: string | null;
  /** All report citations in ascending citation-number order. */
  citations: CitedSource[];
}

/** Maximum characters of a claim fragment embedded into a question. */
const CLAIM_MAX_CHARS = 50;

/**
 * Deterministically extract a claim fragment from free text: split into
 * sentence-like segments on 。！？!?；;\n, keep the longest (ties → earliest),
 * truncate beyond `maxChars` with an ellipsis. Returns null for empty text.
 */
export function extractClaimFragment(text: string, maxChars = CLAIM_MAX_CHARS): string | null {
  const segments = text
    .split(/[。！？!?；;\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const truncate = (s: string): string =>
    s.length > maxChars ? `${s.slice(0, maxChars)}…` : s;
  if (segments.length === 0) {
    const trimmed = text.trim();
    return trimmed.length === 0 ? null : truncate(trimmed);
  }
  let best = segments[0]!;
  for (const s of segments) {
    if (s.length > best.length) best = s;
  }
  return truncate(best);
}

/**
 * The most recent round-advancing user answer text, or null when the user has
 * not answered yet (#17: uncertain inputs are not claims — they are skipped
 * so questions never quote an "I don't know" as the user's claim).
 */
function lastUserAnswer(session: Session): string | null {
  for (let i = session.messages.length - 1; i >= 0; i--) {
    const m = session.messages[i]!;
    if (isRoundAnswer(m)) return m.text;
  }
  return null;
}

/** All citations of the session report, ascending by citation number. */
export function allCitations(session: Session): CitedSource[] {
  const citations = session.report?.citations;
  if (!citations) return [];
  return Object.keys(citations)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 1)
    .sort((a, b) => a - b)
    .flatMap((index) => {
      const source = citations[index];
      return source ? [{ index, source }] : [];
    });
}

/**
 * Deterministically select the sources to render next to a question: the
 * first `limit` citations (by ascending citation number) that carry a usable
 * URL. Sources are passed through verbatim — never re-created — so a rendered
 * link can only ever point at a URL that exists in the report.
 */
export function selectRoundSources(session: Session, limit = 3): CitedSource[] {
  const selected: CitedSource[] = [];
  for (const entry of allCitations(session)) {
    const url = entry.source.url;
    if (typeof url !== 'string' || url.trim().length === 0) continue;
    selected.push(entry);
    if (selected.length >= limit) break;
  }
  return selected;
}

/**
 * Build the structured interrogation context from the session. Pure: the
 * caller supplies the strategy being planned; everything else derives from
 * the session state alone.
 */
export function buildInterrogationContext(
  session: Session,
  strategy: StrategyId
): InterrogationContext {
  // #17: only round-advancing answers count toward the round number.
  const answered = session.messages.filter(isRoundAnswer).length;
  const stance = session.selectedViewpoint
    ? { text: session.selectedViewpoint.text, source: session.selectedViewpoint.source }
    : null;
  return {
    round: answered + 1,
    strategy,
    question: session.question,
    stance,
    lastAnswer: lastUserAnswer(session),
    citations: allCitations(session),
  };
}

/**
 * The claim fragment a question should quote: from the user's latest answer
 * when present, otherwise the selected stance (e.g. round 1). Deterministic;
 * null when neither exists.
 */
export function contextClaimFragment(context: InterrogationContext): string | null {
  if (context.lastAnswer !== null) {
    const fromAnswer = extractClaimFragment(context.lastAnswer);
    if (fromAnswer) return fromAnswer;
  }
  if (context.stance) return extractClaimFragment(context.stance.text);
  return null;
}

/**
 * The narrowed rewrite of the current question after the user's first
 * uncertain answer (#17). Deterministic and context-driven: it quotes a claim
 * fragment of the question the user could not answer (falling back to the
 * user's stance claim), so the narrowing always stays anchored to the real
 * conversation — never fixed text.
 */
export function buildNarrowedQuestion(
  session: Session,
  currentQuestion: string | null
): string {
  // contextClaimFragment only reads lastAnswer/stance; the strategy id is
  // required by buildInterrogationContext but unused for claim selection.
  const focus =
    (currentQuestion ? extractClaimFragment(currentQuestion) : null) ??
    contextClaimFragment(buildInterrogationContext(session, 'M1_evidence'));
  return focus
    ? `让我们把问题缩小一些：先聚焦"${focus}"——你能否举一个具体的小例子或熟悉的场景来说明？`
    : '让我们把问题缩小一些：你能否举一个具体的小例子或熟悉的场景来说明？';
}
