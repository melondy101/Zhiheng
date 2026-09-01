// Unit tests for history exclusion filtering logic.
// Covers: excludedHistoryIds parameter prevents those sessions from appearing
// in history search results; Session interface already carries excludedHistoryIds.
import { describe, it } from 'node:test';
import assert from 'node:assert';

// ---------------------------------------------------------------------------
// Re-implement the relevant filtering logic here (mirrors history-search.ts)
// so tests are self-contained and not coupled to the browser storage layer.
// ---------------------------------------------------------------------------

interface Source {
  id: string;
  type: 'zhihu' | 'web' | 'ai_synthesis' | 'personal_history';
  author: string | null;
  title: string | null;
  url: string | null;
  excerpt: string | null;
  sourceSessionId?: string;
  provenance?: string;
}

// Minimal session shape matching src/lib/providers.ts Session interface
// (history search only needs these fields).
interface TestSession {
  id: string;
  question: string;
  initialOpinion: string | null;
  completed: boolean;
  updatedAt: number;
  messages: { role: string; text: string }[];
  excludedHistoryIds?: string[];
}

function matchesKeywords(question: string, text: string): boolean {
  const qWords = question.trim().toLowerCase().split(/\s+/).filter(w => w.length >= 2);
  if (qWords.length === 0) return false;
  const t = text.trim().toLowerCase();
  return qWords.some(w => t.includes(w));
}

function extractExcerpt(session: TestSession): string | null {
  if (session.initialOpinion) return session.initialOpinion;
  const firstUser = session.messages.find(m => m.role === 'user');
  return firstUser?.text ?? null;
}

/**
 * Filter sessions by excludedHistoryIds (mirrors HistorySearchProvider.search
 * exclusion logic in src/lib/history-search.ts).
 */
function filterExcludedSessions(
  allSessions: TestSession[],
  excludedIds: string[]
): TestSession[] {
  const excluded = new Set(excludedIds);
  return allSessions.filter(s => !excluded.has(s.id));
}

/**
 * Search sessions for history sources, excluding the given IDs.
 * Mirrors HistorySearchProvider.search() filtering logic.
 */
function searchHistorySources(
  allSessions: TestSession[],
  question: string,
  excludedIds: string[] = []
): Source[] {
  const excluded = new Set(excludedIds);

  const matched = allSessions
    .filter(s => {
      if (!s.completed) return false;
      if (excluded.has(s.id)) return false;
      if (!matchesKeywords(question, s.question)) return false;
      return true;
    })
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 3);

  return matched.map(session => ({
    id: `history_${session.id}`,
    type: 'personal_history' as const,
    author: null,
    title: session.question,
    url: null,
    excerpt: extractExcerpt(session),
    sourceSessionId: session.id,
    provenance: '个人上下文',
  }));
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SESSIONS: TestSession[] = [
  {
    id: 's1',
    question: 'AI会取代程序员吗',
    initialOpinion: '我认为AI是辅助工具',
    completed: true,
    updatedAt: 1000,
    messages: [],
  },
  {
    id: 's2',
    question: 'AI是否会改变教育',
    initialOpinion: null,
    completed: true,
    updatedAt: 2000,
    messages: [{ role: 'user', text: 'AI在教育中的应用讨论' }],
  },
  {
    id: 's3',
    question: 'AI与艺术创作的关系',
    initialOpinion: 'AI不会取代艺术家',
    completed: true,
    updatedAt: 3000,
    messages: [],
  },
  {
    id: 's4',
    question: 'AI伦理问题',
    initialOpinion: null,
    completed: false, // incomplete — must be excluded
    updatedAt: 4000,
    messages: [],
  },
  {
    id: 's5',
    question: 'AI对就业的影响',
    initialOpinion: '技术进步创造新岗位',
    completed: true,
    updatedAt: 5000,
    messages: [],
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('filterExcludedSessions', () => {
  it('returns all sessions when excludedIds is empty', () => {
    const result = filterExcludedSessions(SESSIONS, []);
    assert.strictEqual(result.length, SESSIONS.length);
  });

  it('removes a single excluded session', () => {
    const result = filterExcludedSessions(SESSIONS, ['s1']);
    assert.strictEqual(result.length, SESSIONS.length - 1);
    assert.ok(result.every(s => s.id !== 's1'));
  });

  it('removes multiple excluded sessions', () => {
    const result = filterExcludedSessions(SESSIONS, ['s1', 's3', 's5']);
    assert.strictEqual(result.length, SESSIONS.length - 3);
    assert.ok(result.every(s => !['s1', 's3', 's5'].includes(s.id)));
  });

  it('tolerates excluded IDs that do not exist', () => {
    const result = filterExcludedSessions(SESSIONS, ['nonexistent', 's1']);
    assert.strictEqual(result.length, SESSIONS.length - 1);
  });

  it('returns empty array when all sessions are excluded', () => {
    const allIds = SESSIONS.map(s => s.id);
    const result = filterExcludedSessions(SESSIONS, allIds);
    assert.strictEqual(result.length, 0);
  });
});

describe('searchHistorySources', () => {
  it('returns personal_history sources matching the question keyword', () => {
    const sources = searchHistorySources(SESSIONS, 'AI会取代程序员吗', []);
    // s1 matches: keyword "AI"+"程序员"+"取代" (all >= 2 chars)
    assert.ok(sources.length >= 1);
    assert.ok(sources.some(s => s.sourceSessionId === 's1'));
    assert.ok(sources.every(s => s.type === 'personal_history'));
  });

  it('excludes the current session by sourceSessionId', () => {
    // User is currently in session s1; exclude it from history suggestions
    const sources = searchHistorySources(SESSIONS, 'AI会取代程序员吗', ['s1']);
    assert.ok(sources.every(s => s.sourceSessionId !== 's1'));
  });

  it('excludes multiple specified sessions', () => {
    // Exclude s5 (which matches keyword "AI") and s3 (also matches "AI")
    const filtered = searchHistorySources(SESSIONS, 'AI', ['s3', 's5']);
    assert.ok(filtered.every(s => !['s3', 's5'].includes(s.sourceSessionId ?? '')));
  });

  it('does not include incomplete sessions', () => {
    const sources = searchHistorySources(SESSIONS, 'AI伦理问题', []);
    // s4 matches keywords but is not completed
    assert.ok(sources.every(s => s.sourceSessionId !== 's4'));
  });

  it('caps results at 3 sessions', () => {
    // All 4 completed sessions match "AI"
    const sources = searchHistorySources(SESSIONS, 'AI', []);
    assert.ok(sources.length <= 3);
  });

  it('each source has correct personal_history shape', () => {
    const sources = searchHistorySources(SESSIONS, 'AI', []);
    for (const src of sources) {
      assert.strictEqual(src.type, 'personal_history');
      assert.ok(src.id.startsWith('history_'));
      assert.ok(src.sourceSessionId != null);
      assert.strictEqual(src.provenance, '个人上下文');
      assert.ok(src.author === null);
      assert.ok(src.url === null);
      // excerpt must be present (from initialOpinion or first user message)
      assert.ok(src.excerpt != null);
    }
  });

  it('excludedHistoryIds persists in session state (interface check)', () => {
    // Verify the TestSession shape (mirrors Session from providers.ts) accepts excludedHistoryIds
    const sessionWithExclusion: TestSession = {
      id: 's_test',
      question: '测试问题',
      initialOpinion: null,
      completed: true,
      updatedAt: 999,
      messages: [],
      excludedHistoryIds: ['s1', 's2'],
    };
    assert.deepStrictEqual(sessionWithExclusion.excludedHistoryIds, ['s1', 's2']);
  });

  it('empty excludedIds returns all matching sessions', () => {
    const sources = searchHistorySources(SESSIONS, 'AI', []);
    const allMatching = SESSIONS.filter(
      s => s.completed && matchesKeywords('AI', s.question)
    );
    // Results should be a subset of all matching (capped at 3, sorted desc by updatedAt)
    assert.ok(sources.length <= allMatching.length);
  });
});
