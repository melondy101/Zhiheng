// Persistent hotlist snapshot store (PRD v4.2 §2, ticket T1).
//
// The hotlist is GLOBAL public data: a single row in
// `zhiyan_hotlist_snapshot`, never sharded by owner. Only a SUCCESSFUL live
// retrieval is ever persisted, so a stored snapshot always describes real
// Zhihu data — demo/fixture items and degraded results are never written
// (PRD §2.2: "mock 数据不得写入为成功的真实热榜缓存").
//
// Degradation contract (mirrors src/lib/server-storage.ts):
//   - no DATABASE_URL → null (in-memory / no-DB mode);
//   - driver load, connection or migration failure → console.warn the ORIGINAL
//     error and return null. The caller then runs live → demo and must never
//     report a cache hit it did not have.
//
// The Neon driver is loaded lazily (dynamic import inside the default
// executor factory), so tests and E2E runs without DATABASE_URL never load or
// bundle it.

import type { HotlistItem } from '../hotlist-providers';
import { HOTLIST_SNAPSHOT_MIGRATION } from './migrations';
import type { SqlExecutor } from './sql-executor';
import { normalizeJsonColumn, StorageUnavailableError } from './sql-executor';

/**
 * One persisted hotlist snapshot. `updatedAt` is the epoch ms at which the
 * items were ACTUALLY retrieved from the live API — never the read time.
 */
export interface HotlistSnapshot {
  items: HotlistItem[];
  updatedAt: number;
}

export interface HotlistSnapshotStore {
  read(): Promise<HotlistSnapshot | null>;
  write(snapshot: HotlistSnapshot): Promise<void>;
}

/** The global snapshot lives in one fixed row. */
const SNAPSHOT_ROW_ID = 1;

export class PostgresHotlistSnapshotStore implements HotlistSnapshotStore {
  constructor(private readonly executor: SqlExecutor) {}

  /**
   * Single choke point for driver failures (same pattern as
   * PostgresOwnedStorageProvider): every executor error surfaces as
   * StorageUnavailableError with the original error preserved as `cause`.
   */
  private async exec(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }> {
    try {
      return await this.executor.query(sql, params);
    } catch (err) {
      if (err instanceof StorageUnavailableError) throw err;
      throw new StorageUnavailableError('Database query failed', { cause: err });
    }
  }

  async read(): Promise<HotlistSnapshot | null> {
    const { rows } = await this.exec(
      `SELECT items, updated_at FROM zhiyan_hotlist_snapshot WHERE id = $1`,
      [SNAPSHOT_ROW_ID]
    );
    const row = rows[0] as { items?: unknown; updated_at?: unknown } | undefined;
    if (!row) return null;
    const items = normalizeJsonColumn<HotlistItem[]>(row.items ?? null);
    if (!Array.isArray(items) || items.length === 0) return null;
    const updatedAt = toEpochMs(row.updated_at);
    if (updatedAt === null) return null;
    return { items, updatedAt };
  }

  async write(snapshot: HotlistSnapshot): Promise<void> {
    await this.exec(
      `INSERT INTO zhiyan_hotlist_snapshot (id, items, updated_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET
         items = EXCLUDED.items,
         updated_at = EXCLUDED.updated_at`,
      [SNAPSHOT_ROW_ID, JSON.stringify(snapshot.items), new Date(snapshot.updatedAt).toISOString()]
    );
  }
}

/** Accept a Date (driver-parsed TIMESTAMPTZ) or an epoch string/number. */
function toEpochMs(value: unknown): number | null {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function createPostgresHotlistSnapshotStore(executor: SqlExecutor): HotlistSnapshotStore {
  return new PostgresHotlistSnapshotStore(executor);
}

/**
 * Injectable driver seam: tests pass a fake executor factory, never a real
 * DB. Same shape as the storage factory's ExecutorFactory (#21).
 */
export type HotlistExecutorFactory = (databaseUrl: string) => Promise<SqlExecutor>;

const defaultExecutorFactory: HotlistExecutorFactory = async (databaseUrl) => {
  // Lazy dynamic import: the Neon driver is only ever loaded when a
  // DATABASE_URL is actually configured.
  const { createNeonExecutor } = await import('./pg-executor');
  return createNeonExecutor(databaseUrl);
};

/**
 * Build the hotlist snapshot store from an environment. Returns null in
 * no-DB mode and on ANY failure — never throws, never fakes a cache.
 */
export async function createHotlistSnapshotStoreFromEnv(
  env: Record<string, string | undefined> = process.env,
  executorFactory: HotlistExecutorFactory = defaultExecutorFactory
): Promise<HotlistSnapshotStore | null> {
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) return null;
  try {
    const executor = await executorFactory(databaseUrl);
    // Only this table is migrated here: the hotlist path must not depend on
    // the session/profile schema.
    await executor.query(HOTLIST_SNAPSHOT_MIGRATION);
    return createPostgresHotlistSnapshotStore(executor);
  } catch (err) {
    console.warn(
      '[hotlist-snapshot-store] DATABASE_URL is configured but the snapshot store is unavailable:',
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}
