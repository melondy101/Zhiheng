// Idempotent schema migrations for the Neon PostgreSQL persistence (#21).
//
// Every statement is safe to run repeatedly on an empty OR an already
// migrated database: only `CREATE … IF NOT EXISTS` forms are used — no DROP,
// no DELETE, no TRUNCATE, no destructive ALTER. Running `runMigrations` twice
// in a row produces the exact same statements and leaves existing data
// untouched, which the integration tests pin at the fake-executor level.
//
// Honest limitation: execution against a REAL Neon empty database is not
// verified in this environment (no credentials available — BLOCKED, see the
// ticket #21 handoff). The SQL is plain PostgreSQL and `npm run db:migrate`
// is the operator path once credentials exist.

import type { SqlExecutor } from './sql-executor';

export const MIGRATION_STATEMENTS: readonly string[] = [
  // One row per (owner, session). The full Session (report, messages, result
  // card, interrogation state) is stored as JSONB so the adapter stays
  // schema-tolerant while `completed` is lifted into a column for the
  // read-only guard. Ownership is part of the primary key: a session is only
  // ever reachable through its owner id.
  `CREATE TABLE IF NOT EXISTS zhiyan_sessions (
    owner_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    data JSONB NOT NULL,
    completed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (owner_id, session_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_zhiyan_sessions_owner_updated
    ON zhiyan_sessions (owner_id, updated_at DESC)`,

  // One row per owner for the simplified profile. The row is kept after a
  // profile "deletion" as a tombstone (data.deletedAt set, conclusions
  // emptied) so old evidence can never auto-rebuild the profile (#21
  // acceptance criterion 2). Report and session rows are never touched by a
  // profile deletion.
  `CREATE TABLE IF NOT EXISTS zhiyan_profiles (
    owner_id TEXT NOT NULL PRIMARY KEY,
    data JSONB NOT NULL,
    deleted_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
];

/**
 * Run every migration statement. Safe to call any number of times, on any
 * number of process starts — the statement list is fully idempotent.
 */
export async function runMigrations(executor: SqlExecutor): Promise<void> {
  for (const statement of MIGRATION_STATEMENTS) {
    await executor.query(statement);
  }
}
