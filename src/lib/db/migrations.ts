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

// The hotlist snapshot is GLOBAL public data: a single row, never sharded by
// owner (#T1). It is declared as its own exported constant so the hotlist
// route wiring can migrate only this table, while `MIGRATION_STATEMENTS`
// below still carries it (so `npm run db:migrate` and the storage bootstrap
// create it as well).
export const HOTLIST_SNAPSHOT_MIGRATION = `CREATE TABLE IF NOT EXISTS zhiyan_hotlist_snapshot (
  id SMALLINT NOT NULL PRIMARY KEY,
  items JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
)`;

export const KNOWLEDGE_BASE_MIGRATION = `CREATE TABLE IF NOT EXISTS zhiyan_knowledge_base (
  id TEXT NOT NULL PRIMARY KEY,
  category TEXT NOT NULL,
  topic TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  content TEXT NOT NULL,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  suggested_questions JSONB NOT NULL DEFAULT '[]'::jsonb,
  fallacies_identified JSONB,
  argument_patterns JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`;

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

  // The hotlist snapshot (#T1).
  HOTLIST_SNAPSHOT_MIGRATION,

  // Knowledge base table and index (M2).
  KNOWLEDGE_BASE_MIGRATION,
  `CREATE INDEX IF NOT EXISTS idx_zhiyan_kb_category_topic
    ON zhiyan_knowledge_base (category, topic)`,

  // User accounts and authentication.
  `CREATE TABLE IF NOT EXISTS zhiyan_users (
    id TEXT NOT NULL PRIMARY KEY,
    name VARCHAR(64) NOT NULL,
    email VARCHAR(255) NOT NULL,
    email_lower VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL DEFAULT '',
    is_guest BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_zhiyan_users_email_lower
    ON zhiyan_users (email_lower)`,

  // Email verification codes.
  `CREATE TABLE IF NOT EXISTS zhiyan_email_verifications (
    id TEXT NOT NULL PRIMARY KEY,
    email_lower VARCHAR(255) NOT NULL,
    code CHAR(6) NOT NULL,
    attempts SMALLINT NOT NULL DEFAULT 0,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_zhiyan_email_verifications_email
    ON zhiyan_email_verifications (email_lower)`,

  // Rate limiting and security audit log.
  `CREATE TABLE IF NOT EXISTS zhiyan_auth_attempts (
    id TEXT NOT NULL PRIMARY KEY,
    ip_address VARCHAR(45) NOT NULL,
    action_type VARCHAR(32) NOT NULL,
    attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_zhiyan_auth_attempts_ip_action
    ON zhiyan_auth_attempts (ip_address, action_type, attempted_at)`,
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
