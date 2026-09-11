// Route wiring for /api/hotlist (PRD v4.2 §2, ticket T1).
//
// A Next.js route module may only export HTTP handlers, so the composition
// (env → snapshot store → provider) lives here where both the route and the
// integration tests can reach it. The dependency pair is injectable purely so
// tests can observe the wiring without touching a real database or network.

import { createHotlistSnapshotStoreFromEnv, type HotlistSnapshotStore } from './db/hotlist-snapshot-store';
import {
  createHotlistProvider,
  type LiveHotlistProvider,
  type LiveHotlistProviderOptions,
  type RetrievalHotlistResult,
} from './zhihu-retrieval';

// Re-exported so tests can pin the production wiring by object identity: a
// default that merely *wraps* the real factory would let someone swap in
// `async () => null` and leave production with no cache at all while every
// test still passed.
export { createHotlistSnapshotStoreFromEnv };

export interface HotlistRouteDependencies {
  createSnapshotStore: (
    env: Record<string, string | undefined>
  ) => Promise<HotlistSnapshotStore | null>;
  createProvider: (overrides: Partial<LiveHotlistProviderOptions>) => LiveHotlistProvider;
}

/** Production wiring: the real env factory and the real route provider. */
export const defaultHotlistRouteDependencies: HotlistRouteDependencies = {
  createSnapshotStore: createHotlistSnapshotStoreFromEnv,
  createProvider: (overrides) => createHotlistProvider(overrides),
};

let activeDependencies: HotlistRouteDependencies | null = null;

/** Override the wiring for a test; pass null to restore the defaults. */
export function setHotlistRouteDependencies(deps: HotlistRouteDependencies | null): void {
  activeDependencies = deps;
}

export function getHotlistRouteDependencies(): HotlistRouteDependencies {
  return activeDependencies ?? defaultHotlistRouteDependencies;
}

/**
 * env → snapshot store → provider → result. The store may legitimately be
 * null (no DATABASE_URL, or an unavailable database) — the provider then runs
 * its live/demo chain without a persistent cache, which is the honest
 * degradation instead of a fabricated cache hit.
 */
export async function loadHotlistForRoute(
  env: Record<string, string | undefined> = process.env,
  deps: HotlistRouteDependencies = getHotlistRouteDependencies(),
  options?: { force?: boolean }
): Promise<RetrievalHotlistResult> {
  const snapshotStore = await deps.createSnapshotStore(env);
  const provider = deps.createProvider({ snapshotStore: snapshotStore ?? undefined });
  return provider.fetchHotlist(options);
}
