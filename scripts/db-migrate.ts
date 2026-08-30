// Operator migration runner for the Neon persistence (#21).
//
// Usage (credentials come from the SERVER environment only, never committed):
//   DATABASE_URL="postgresql://…neon.tech/neondb?sslmode=require" npm run db:migrate
//
// Runs the idempotent migration statements (CREATE TABLE/INDEX IF NOT
// EXISTS) against the configured database. Safe to repeat on an empty or an
// already-migrated database. This script never runs in tests and is not
// referenced by the app — the app runs the same statements once per process
// at storage initialization (src/lib/server-storage.ts).
//
// Honest limitation: execution against a real Neon empty database has NOT
// been verified in the ticket #21 environment (no credentials — BLOCKED in
// the handoff). The statements are plain PostgreSQL validated at the
// fake-executor level.

import { createNeonExecutor } from '../src/lib/db/pg-executor';
import { MIGRATION_STATEMENTS, runMigrations } from '../src/lib/db/migrations';

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    console.error('DATABASE_URL is not set. Usage:');
    console.error('  DATABASE_URL="postgresql://…" npm run db:migrate');
    process.exit(1);
  }
  const executor = createNeonExecutor(databaseUrl);
  await runMigrations(executor);
  console.log(`Applied ${MIGRATION_STATEMENTS.length} idempotent migration statements.`);
}

main().catch((err) => {
  console.error('Migration failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
