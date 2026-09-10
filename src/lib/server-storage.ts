// Server storage selection and degradation (#21).
//
// Configuration (read from the SERVER environment only — never exposed to
// the browser, never NEXT_PUBLIC_):
//   - DATABASE_URL empty/absent → in-memory mode (baseline pre-#21
//     behavior: process-lifetime storage, lost on restart);
//   - DATABASE_URL configured → Neon PostgreSQL mode; migrations run once at
//     startup; if the database cannot be reached, the process keeps postgres
//     mode but every operation fails with an explicit
//     StorageUnavailableError, which routes translate into a 503 / body
//     degradation flag. The system never pretends a failed write was
//     persisted remotely.
//
// The Neon driver itself is loaded lazily (dynamic import inside the default
// executor factory), so tests and E2E runs without DATABASE_URL never load
// or bundle it. The adapter and migration modules have no driver dependency.

import {
  MemoryOwnedStorageProvider,
  UnavailableOwnedStorageProvider,
  scopeStorageByOwner,
  type OwnedStorageProvider,
  type OwnerStorageScope,
} from './owned-storage';
import { PostgresOwnedStorageProvider } from './db/postgres-storage';
import { runMigrations } from './db/migrations';
import type { SqlExecutor } from './db/sql-executor';
import { StorageUnavailableError } from './db/sql-executor';

export type ServerStorageMode = 'memory' | 'postgres';

/** Injectable driver seam: tests pass a fake executor factory, never a real DB. */
export type ExecutorFactory = (databaseUrl: string) => Promise<SqlExecutor>;

const defaultExecutorFactory: ExecutorFactory = async (databaseUrl) => {
  // Lazy dynamic import: the Neon driver is only ever loaded when a
  // DATABASE_URL is actually configured.
  const { createNeonExecutor } = await import('./db/pg-executor');
  return createNeonExecutor(databaseUrl);
};

export interface ServerStorageConfig {
  databaseUrl: string;
}

/** Read the storage config from the server environment. Null = memory mode. */
export function readServerStorageConfig(
  env: Record<string, string | undefined> = process.env
): ServerStorageConfig | null {
  const databaseUrl = env.DATABASE_URL?.trim();
  return databaseUrl ? { databaseUrl } : null;
}

/**
 * Per-request handle handed to API routes: a stable owner-scoped view plus
 * the manager's mode for honest response labeling.
 */
export class ServerStorage {
  private constructor(
    readonly mode: ServerStorageMode,
    private readonly backend: OwnedStorageProvider,
    private readonly scopes = new Map<string, OwnerStorageScope>()
  ) {}

  static create(mode: ServerStorageMode, backend: OwnedStorageProvider): ServerStorage {
    return new ServerStorage(mode, backend);
  }

  /**
   * The scoped view for one anonymous owner. Views are cached per owner so
   * the returned object identity is stable within the process.
   */
  forOwner(ownerId: string): OwnerStorageScope {
    let scope = this.scopes.get(ownerId);
    if (!scope) {
      scope = scopeStorageByOwner(this.backend, ownerId);
      this.scopes.set(ownerId, scope);
    }
    return scope;
  }

  async savePublicShare(id: string, markdown: string, createdAt: number): Promise<void> {
    return this.backend.savePublicShare(id, markdown, createdAt);
  }

  async loadPublicShare(id: string): Promise<{ markdown: string; createdAt: number } | null> {
    return this.backend.loadPublicShare(id);
  }
}

/**
 * Build the server storage from an environment. Never throws: when the
 * configured database is unreachable (driver load, connection or migration
 * failure) it degrades to a postgres-mode backend whose every operation
 * fails with StorageUnavailableError — the honest degradation signal.
 */
export async function createServerStorageFromEnv(
  env: Record<string, string | undefined> = process.env,
  executorFactory: ExecutorFactory = defaultExecutorFactory
): Promise<ServerStorage> {
  const config = readServerStorageConfig(env);
  if (!config) {
    return ServerStorage.create('memory', new MemoryOwnedStorageProvider());
  }
  try {
    const executor = await executorFactory(config.databaseUrl);
    await runMigrations(executor);
    return ServerStorage.create('postgres', new PostgresOwnedStorageProvider(executor));
  } catch (err) {
    // The database is configured but unavailable. Keep the explicit
    // degradation signal instead of silently pretending memory mode is
    // durable remote storage.
    console.warn(
      '[server-storage] DATABASE_URL is configured but the database is unavailable:',
      err instanceof Error ? err.message : String(err)
    );
    return ServerStorage.create('postgres', new UnavailableOwnedStorageProvider(err));
  }
}

/**
 * Process-level singleton. Initialized lazily on first use; the Neon driver
 * is only loaded when DATABASE_URL is configured.
 */
let cached: Promise<ServerStorage> | null = null;

export function getServerStorage(): Promise<ServerStorage> {
  if (!cached) {
    cached = createServerStorageFromEnv().catch((err) => {
      cached = null;
      throw err;
    });
  }
  return cached;
}

// Re-exports used by routes and tests for degradation handling and typing.
export { StorageUnavailableError };
export type { OwnerStorageScope };
