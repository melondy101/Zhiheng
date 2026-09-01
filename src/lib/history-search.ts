// History search provider — filters browser-supplied historical context on the
// server. Browser storage must never be imported here: localStorage is not
// available in the Node.js route that generates reports.

import type { Session, Source } from './providers';

export interface HistorySearchResult {
  sources: Source[];
}

/**
 * The minimum browser-owned data the report API needs to identify relevant
 * personal history. Deliberately excludes reports, graphs, and other session
 * state so the client/server boundary stays small and explicit.
 */
export interface HistorySessionSnapshot {
  id: string;
  question: string;
  initialOpinion: string | null;
  messages: { role: string; text: string }[];
  completed: boolean;
  updatedAt: number;
}

/** Create transport-safe history snapshots from the browser's local sessions. */
export function toHistorySessionSnapshots(sessions: readonly Session[]): HistorySessionSnapshot[] {
  return sessions.map(session => ({
    id: session.id,
    question: session.question,
    initialOpinion: session.initialOpinion,
    messages: session.messages.map(message => ({ role: message.role, text: message.text })),
    completed: session.completed,
    updatedAt: session.updatedAt,
  }));
}

/** Normalize text for keyword matching: lowercase, trim. */
function normalize(text: string): string {
  return text.trim().toLowerCase();
}

/** Check if keywords from `question` appear in `text`. */
function matchesKeywords(question: string, text: string): boolean {
  // CJK questions are commonly written without spaces. Keep contiguous Han
  // text as a phrase, while also extracting Latin/digit terms such as "AI"
  // that can match across otherwise different Chinese phrasings.
  const qWords = normalize(question).match(/[\p{Script=Han}]{2,}|[a-z0-9]{2,}/gu) ?? [];
  if (qWords.length === 0) return false;
  const t = normalize(text);
  return qWords.some(w => t.includes(w));
}

/**
 * Extract excerpt from a session: initialOpinion or first user message text.
 */
function extractExcerpt(session: { initialOpinion: string | null; messages: { role: string; text: string }[] }): string | null {
  if (session.initialOpinion) return session.initialOpinion;
  const firstUser = session.messages.find(m => m.role === 'user');
  return firstUser?.text ?? null;
}

/**
 * HistorySearchProvider searches browser-supplied completed sessions that match
 * the question via keyword overlap.
 *
 * Results are capped at 3, sorted by updatedAt desc, and include only
 * completed sessions (completed === true).
 */
export class HistorySearchProvider {
  /**
   * Search past sessions for context relevant to `question`.
   * @param question The question to match against
   * @param sessions Browser-owned history snapshots submitted with this report request
   * @param excludedIds Session IDs to exclude from results (e.g. the current session)
   */
  async search(
    question: string,
    sessions: readonly HistorySessionSnapshot[] = [],
    excludedIds: string[] = []
  ): Promise<HistorySearchResult> {
    const excluded = new Set(excludedIds);

    // Filter: completed sessions, not excluded, and keyword match
    const matched = sessions
      .filter(s => {
        if (!s.completed) return false;
        if (excluded.has(s.id)) return false;
        if (!matchesKeywords(question, s.question)) return false;
        return true;
      })
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 3);

    const sources: Source[] = matched.map(session => {
      const excerpt = extractExcerpt(session);
      return {
        id: `history_${session.id}`,
        type: 'personal_history' as const,
        author: null,
        title: session.question,
        url: null,
        excerpt,
        sourceSessionId: session.id,
        provenance: '个人上下文',
      };
    });

    return { sources };
  }
}
