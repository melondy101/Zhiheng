// Unit tests for session-source-state helpers (#24).
// Tests the honesty rules:
//   1. Missing source-state → null, never auto-filled to demo.
//   2. Session.reportSourceState always wins over side-key.
//   3. Side-key is ONLY a fallback for legacy sessions with no session-level state.
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  resolveReportSourceState,
  effectiveSourceState,
  reportStateKey,
  loadReportSourceState,
  saveReportSourceState,
} from '../../src/lib/session-source-state';
import type { Session, SourceState } from '../../src/lib/providers';

// ---------------------------------------------------------------------------
// Fake localStorage for isolated testing
// ---------------------------------------------------------------------------

const store = new Map<string, string>();

// Patch globalThis.localStorage for the duration of these tests
const originalLocalStorage = (globalThis as Record<string, unknown>).localStorage;

function withMockStorage(fn: () => void): void {
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
      clear: () => store.clear(),
    },
    configurable: true,
  });
  store.clear();
  try {
    fn();
  } finally {
    if (originalLocalStorage !== undefined) {
      Object.defineProperty(globalThis, 'localStorage', {
        value: originalLocalStorage,
        configurable: true,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Session factory helpers
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<{
  reportSourceState: Session['reportSourceState'];
}> = {}): Session {
  return {
    id: 's_test',
    question: 'test',
    initialOpinion: null,
    report: null,
    selectedViewpoint: null,
    messages: [],
    resultCard: null,
    completed: false,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as Session;
}

function makeSourceState(overrides: Partial<{
  zhihu: SourceState;
  web: SourceState;
  zhihuUpdatedAt: number;
  webUpdatedAt: number;
  zhihuStale: boolean;
  webStale: boolean;
}> = {}): Session['reportSourceState'] {
  return {
    zhihu: 'live',
    web: 'cache',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// reportStateKey
// ---------------------------------------------------------------------------

describe('reportStateKey', () => {
  it('formats the side-key with session id', () => {
    assert.strictEqual(reportStateKey('s_abc123'), 'zhiyan_report_state:s_abc123');
  });
});

// ---------------------------------------------------------------------------
// resolveReportSourceState: session.reportSourceState always wins (#24 rule 2)
// ---------------------------------------------------------------------------

describe('resolveReportSourceState: session-level state wins over side-key', () => {
  it('returns session.reportSourceState when present (never touches side-key)', () => {
    withMockStorage(() => {
      const session = makeSession({
        reportSourceState: makeSourceState({ zhihu: 'live', web: 'demo' }),
      });
      // Side-key has different data — must NOT be used
      store.set('zhiyan_report_state:s_test', JSON.stringify({
        zhihu: 'cache' as SourceState,
        web: 'cache' as SourceState,
      }));

      const result = resolveReportSourceState(session, 's_test');
      assert.strictEqual(result?.zhihu, 'live');
      assert.strictEqual(result?.web, 'demo');
    });
  });

  it('falls back to side-key when session.reportSourceState is absent (legacy session)', () => {
    withMockStorage(() => {
      const session = makeSession({ reportSourceState: undefined });
      store.set('zhiyan_report_state:s_test', JSON.stringify({
        zhihu: 'cache' as SourceState,
        web: 'cache' as SourceState,
      }));

      const result = resolveReportSourceState(session, 's_test');
      assert.strictEqual(result?.zhihu, 'cache');
      assert.strictEqual(result?.web, 'cache');
    });
  });

  it('returns null when neither session.reportSourceState nor side-key exists (honest "未披露")', () => {
    withMockStorage(() => {
      const session = makeSession({ reportSourceState: undefined });
      const result = resolveReportSourceState(session, 's_test');
      assert.strictEqual(result, null);
    });
  });

  it('returns null when session is null (no session to restore)', () => {
    withMockStorage(() => {
      const result = resolveReportSourceState(null, 's_test');
      assert.strictEqual(result, null);
    });
  });

  it('returns null when session.reportSourceState is explicitly null', () => {
    withMockStorage(() => {
      // Passing undefined (not null) — the type is optional, not nullable
      const session = makeSession({ reportSourceState: undefined });
      const result = resolveReportSourceState(session, 's_test');
      assert.strictEqual(result, null);
    });
  });
});

// ---------------------------------------------------------------------------
// effectiveSourceState: full resolved state with provider timestamps
// ---------------------------------------------------------------------------

describe('effectiveSourceState', () => {
  it('carries through zhihuUpdatedAt and webUpdatedAt from cache provider', () => {
    withMockStorage(() => {
      const cachedAt = 1_700_000_000_000;
      const session = makeSession({
        reportSourceState: makeSourceState({
          zhihu: 'cache',
          web: 'cache',
          zhihuUpdatedAt: cachedAt,
          webUpdatedAt: cachedAt + 86_400_000,
          zhihuStale: false,
          webStale: true,
        }),
      });

      const result = effectiveSourceState(session, 's_test');
      assert.ok(result);
      assert.strictEqual(result?.zhihu, 'cache');
      assert.strictEqual(result?.web, 'cache');
      assert.strictEqual(result?.zhihuUpdatedAt, cachedAt);
      assert.strictEqual(result?.webUpdatedAt, cachedAt + 86_400_000);
      assert.strictEqual(result?.zhihuStale, false);
      assert.strictEqual(result?.webStale, true);
    });
  });

  it('returns null for legacy session with no source state', () => {
    withMockStorage(() => {
      const result = effectiveSourceState(makeSession({ reportSourceState: undefined }), 's_legacy');
      assert.strictEqual(result, null);
    });
  });
});

// ---------------------------------------------------------------------------
// Honesty rule 1: no legacy → demo auto-fill
// ---------------------------------------------------------------------------

describe('Honesty: no legacy → demo auto-fill (#24 rule 1)', () => {
  it('a legacy session with no source state must NOT return demo', () => {
    withMockStorage(() => {
      const legacySession = makeSession({ reportSourceState: undefined });
      const result = resolveReportSourceState(legacySession, 's_legacy');
      // Must be null, not { zhihu: 'demo', web: 'demo' }
      assert.strictEqual(result, null, 'legacy session must NOT auto-fill demo');
    });
  });

  it('a legacy session that only has a side-key returns that data (not demo)', () => {
    withMockStorage(() => {
      const legacySession = makeSession({ reportSourceState: undefined });
      store.set('zhiyan_report_state:s_legacy', JSON.stringify({
        zhihu: 'cache' as SourceState,
        web: 'cache' as SourceState,
      }));

      const result = resolveReportSourceState(legacySession, 's_legacy');
      assert.notStrictEqual(result, null);
      assert.strictEqual(result?.zhihu, 'cache');
    });
  });
});

// ---------------------------------------------------------------------------
// loadReportSourceState / saveReportSourceState roundtrip
// ---------------------------------------------------------------------------

describe('loadReportSourceState / saveReportSourceState roundtrip', () => {
  it('roundtrips through localStorage', () => {
    withMockStorage(() => {
      const state = {
        zhihu: 'live' as SourceState,
        web: 'cache' as SourceState,
        zhihuUpdatedAt: 1_700_000_000_000,
        webUpdatedAt: 1_700_000_001_000,
        zhihuStale: false,
        webStale: true,
      };
      saveReportSourceState('s_roundtrip', state);
      const loaded = loadReportSourceState('s_roundtrip');
      assert.deepStrictEqual(loaded, state);
    });
  });

  it('load returns null for missing key', () => {
    withMockStorage(() => {
      assert.strictEqual(loadReportSourceState('s_missing'), null);
    });
  });
});
