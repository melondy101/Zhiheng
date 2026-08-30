// Narrow SQL execution seam for the Neon PostgreSQL adapter (#21).
//
// The whole persistence layer depends on THIS interface only — never on a
// concrete driver. The production executor wraps @neondatabase/serverless
// (see pg-executor.ts); tests replace it with an in-memory fake executor, so
// no test in this repository ever connects to a real database.
//
// Secrets note: the connection string lives only in the server environment
// (DATABASE_URL). Nothing in this module is imported by client code and no
// NEXT_PUBLIC_ variable is used, so credentials can never reach the browser.

/**
 * The only driver surface the storage adapter is allowed to see.
 * `sql` is a parameterized statement ($1, $2, …) and `params` the bound
 * values — callers never interpolate user data into SQL text.
 */
export interface SqlExecutor {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

/**
 * Thrown when the configured database cannot be reached or a query fails.
 * Routes translate this into an explicit "server storage unavailable"
 * degradation signal (503 / body flag) — the system never pretends a write
 * was persisted remotely when it was not.
 *
 * The original driver error is preserved as `cause` for server-side logs
 * only; it is never returned to the browser.
 */
export class StorageUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'StorageUnavailableError';
  }
}

/**
 * JSONB columns come back as parsed objects from the Neon driver, but a
 * driver (or test fake) may legitimately return the raw JSON text. The
 * adapter normalizes both shapes so behavior does not depend on the driver.
 */
export function normalizeJsonColumn<T>(value: unknown): T | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }
  return value as T;
}
