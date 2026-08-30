// History search provider — searches past sessions for relevant context.
// Runs only in the browser via BrowserStorageProvider.

import type { Source } from './providers';
import { clientStorage } from './demo-providers';

export interface HistorySearchResult {
  sources: Source[];
}

/** Normalize text for keyword matching: lowercase, trim. */
function normalize(text: string): string {
  return text.trim().toLowerCase();
}

/** Check if keywords from `question` appear in `text`. */
function matchesKeywords(question: string, text: string): boolean {
  const qWords = normalize(question).split(/\s+/).filter(w => w.length >= 2);
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
 * HistorySearchProvider searches completed sessions from BrowserStorageProvider
 * that match the question via keyword overlap.
 *
 * Results are capped at 3, sorted by updatedAt desc, and include only
 * completed sessions (completed === true).
 */
export class HistorySearchProvider {
  /**
   * Search past sessions for context relevant to `question`.
   * @param question The question to match against
   * @param excludedIds Session IDs to exclude from results (e.g. the current session)
   */
  async search(question: string, excludedIds: string[] = []): Promise<HistorySearchResult> {
    const allSessions = await clientStorage.listSessions();

    const excluded = new Set(excludedIds);

    // Filter: completed sessions, not excluded, and keyword match
    const matched = allSessions
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
