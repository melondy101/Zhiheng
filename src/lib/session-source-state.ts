// Session report-source-state helpers for ticket #24.
//
// This module encapsulates the logic for:
//   - Building the persisted source-state from a fresh report generation.
//   - Resolving the displayed source-state from session + side-key fallback.
//   - The "no legacy → demo auto-fill" honesty rule.
//
// The source-state schema:
//   reportSourceState: {
//     zhihu: SourceState,        // 'live' | 'cache' | 'demo'
//     web: SourceState,
//     zhihuUpdatedAt?: number,   // epoch ms from cache provider
//     webUpdatedAt?: number,
//     zhihuStale?: boolean,
//     webStale?: boolean,
//   }
//
// Honesty rules enforced here:
//   1. Missing source-state (legacy session) → null, never auto-filled to demo.
//   2. Side-key is ONLY a fallback when session.reportSourceState is absent.
//   3. Session.reportSourceState always wins when present.

import type { SourceState } from './providers';

/**
 * The full source-state block stored in a Session (#24).
 * Optional fields are omitted (not null) when the channel was never invoked.
 */
export interface PersistedReportSourceState {
  zhihu: SourceState;
  web: SourceState;
  zhihuUpdatedAt?: number;
  webUpdatedAt?: number;
  zhihuStale?: boolean;
  webStale?: boolean;
}

/**
 * The live source-state shape returned by /api/report (and the side-key).
 * Identical shape to PersistedReportSourceState but documented separately.
 */
export interface ReportSourceState extends PersistedReportSourceState {}

/** Side-key storage key pattern. */
export const reportStateKey = (sessionId: string): string => `zhiyan_report_state:${sessionId}`;

/**
 * Load source state from the side-key (localStorage).
 * Returns null when absent — callers must NOT treat null as 'demo'.
 */
export function loadReportSourceState(sessionId: string): ReportSourceState | null {
  try {
    const raw = localStorage.getItem(reportStateKey(sessionId));
    return raw ? (JSON.parse(raw) as ReportSourceState) : null;
  } catch {
    return null;
  }
}

/**
 * Persist source state to the side-key (localStorage).
 * Silently ignores quota errors — the side-key is best-effort.
 */
export function saveReportSourceState(sessionId: string, state: ReportSourceState): void {
  try {
    localStorage.setItem(reportStateKey(sessionId), JSON.stringify(state));
  } catch { /* quota exceeded — silent */ }
}

/**
 * Resolve the displayed source state for a session.
 *
 * Priority (#24 rule 7 — side-key transparent fallback):
 *   1. session.reportSourceState  → use it (authoritative, persisted)
 *   2. side-key source state      → use as fallback (legacy sessions)
 *   3. neither exists            → return null (UI shows "未披露/未知")
 *
 * The side-key is ONLY a fallback for legacy sessions predating #24.
 * A session that has reportSourceState ALWAYS uses that — never the side-key.
 */
export function resolveReportSourceState(
  session: { reportSourceState?: PersistedReportSourceState | null } | null,
  sessionId: string
): ReportSourceState | null {
  if (session?.reportSourceState) {
    return session.reportSourceState as ReportSourceState;
  }
  return loadReportSourceState(sessionId);
}

/**
 * Compute the effective displayed source state from session state + side-key fallback.
 * Exposes the resolved state for badge rendering in the UI.
 */
export function effectiveSourceState(
  session: { reportSourceState?: PersistedReportSourceState | null } | null,
  sessionId: string
): {
  zhihu: SourceState | null;
  web: SourceState | null;
  zhihuUpdatedAt?: number;
  webUpdatedAt?: number;
  zhihuStale?: boolean;
  webStale?: boolean;
} | null {
  const resolved = resolveReportSourceState(session, sessionId);
  if (!resolved) return null;
  return {
    zhihu: resolved.zhihu,
    web: resolved.web,
    zhihuUpdatedAt: resolved.zhihuUpdatedAt,
    webUpdatedAt: resolved.webUpdatedAt,
    zhihuStale: resolved.zhihuStale,
    webStale: resolved.webStale,
  };
}
