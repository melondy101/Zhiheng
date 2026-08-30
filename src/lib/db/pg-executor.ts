// Production SqlExecutor backed by the official Neon serverless driver
// (#21). The driver performs parameterized HTTP queries against Neon
// PostgreSQL — no WebSocket infrastructure needed for this MVP's request
// pattern, and no connection pooling to manage.
//
// Driver choice rationale: @neondatabase/serverless is Neon's official,
// mature, pure-JS driver (no native bindings). It is loaded lazily via
// dynamic import from the storage factory, so tests and E2E runs without a
// configured DATABASE_URL never load it at all.
//
// Any driver failure is normalized into StorageUnavailableError so routes can
// emit the honest degradation signal. The cause is preserved for server logs.

import { neon } from '@neondatabase/serverless';
import type { SqlExecutor } from './sql-executor';

export function createNeonExecutor(connectionString: string): SqlExecutor {
  const sql = neon(connectionString);
  return {
    // `sql.query(text, params)` is the parameterized string form of the Neon
    // HTTP driver (the bare call form is template-tag only). Driver failures
    // propagate raw — the STORAGE ADAPTER wraps every executor error into
    // StorageUnavailableError (single choke point, driver-agnostic).
    async query(text: string, params: unknown[] = []): Promise<{ rows: unknown[] }> {
      const rows = await sql.query(text, params);
      return { rows: rows as unknown[] };
    },
  };
}
