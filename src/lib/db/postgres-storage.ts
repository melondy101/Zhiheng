// Neon PostgreSQL implementation of the ownership-aware storage contract
// (#21). Every statement is parameterized and owner-scoped: a record is only
// ever reachable through (owner_id, id), so two different anonymous owners
// can never read each other's sessions or profiles.
//
// Completed-session read-only rule: enforced ATOMICALLY in the upsert —
// `ON CONFLICT … DO UPDATE … WHERE zhiyan_sessions.completed = FALSE` — so a
// completed row can never be overwritten, even under concurrent writers. New
// (non-conflicting) inserts always succeed; the transition
// in-progress → completed is therefore the only write a completed session
// ever receives, exactly matching the orchestrator's semantics.
//
// JSONB values are normalized through normalizeJsonColumn so the adapter
// behaves identically with drivers that return parsed objects (Neon) or raw
// JSON text (some test fakes).

import type { Session } from '../providers';
import type { UserProfile } from '../lifecycle';
import { applyProfileTombstoneRule, type OwnedStorageProvider } from '../owned-storage';
import type { SqlExecutor } from './sql-executor';
import { normalizeJsonColumn, StorageUnavailableError } from './sql-executor';

const SESSION_COLUMNS = `owner_id, session_id, data, completed, created_at, updated_at`;

export class PostgresOwnedStorageProvider implements OwnedStorageProvider {
  constructor(private readonly executor: SqlExecutor) {}

  /**
   * Single choke point for driver failures: ANY executor error (connection
   * loss, timeout, driver crash) surfaces as StorageUnavailableError so
   * routes can emit the honest degradation signal. The original error is
   * preserved as `cause` for server logs. This wrap lives in the ADAPTER —
   * not in a specific driver — so real drivers and test fakes behave
   * identically.
   */
  private async exec(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }> {
    try {
      return await this.executor.query(sql, params);
    } catch (err) {
      if (err instanceof StorageUnavailableError) throw err;
      throw new StorageUnavailableError('Database query failed', { cause: err });
    }
  }

  async saveSession(ownerId: string, session: Session): Promise<void> {
    await this.exec(
      `INSERT INTO zhiyan_sessions (${SESSION_COLUMNS})
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (owner_id, session_id) DO UPDATE SET
         data = EXCLUDED.data,
         completed = EXCLUDED.completed,
         updated_at = EXCLUDED.updated_at
       WHERE zhiyan_sessions.completed = FALSE`,
      [
        ownerId,
        session.id,
        JSON.stringify(session),
        session.completed,
        new Date(session.createdAt).toISOString(),
        new Date(session.updatedAt).toISOString(),
      ]
    );
  }

  async loadSession(ownerId: string, id: string): Promise<Session | null> {
    const { rows } = await this.exec(
      `SELECT data FROM zhiyan_sessions WHERE owner_id = $1 AND session_id = $2`,
      [ownerId, id]
    );
    return normalizeJsonColumn<Session>(
      (rows[0] as { data?: unknown } | undefined)?.data ?? null
    );
  }

  async listSessions(ownerId: string): Promise<Session[]> {
    const { rows } = await this.exec(
      `SELECT data FROM zhiyan_sessions WHERE owner_id = $1 ORDER BY updated_at DESC`,
      [ownerId]
    );
    return rows
      .map((row) => normalizeJsonColumn<Session>((row as { data?: unknown }).data ?? null))
      .filter((s): s is Session => s !== null)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async deleteSession(ownerId: string, id: string): Promise<void> {
    await this.exec(
      `DELETE FROM zhiyan_sessions WHERE owner_id = $1 AND session_id = $2`,
      [ownerId, id]
    );
  }

  async loadProfile(ownerId: string): Promise<UserProfile | null> {
    const { rows } = await this.exec(
      `SELECT data FROM zhiyan_profiles WHERE owner_id = $1`,
      [ownerId]
    );
    return normalizeJsonColumn<UserProfile>(
      (rows[0] as { data?: unknown } | undefined)?.data ?? null
    );
  }

  async saveProfile(
    ownerId: string,
    profile: UserProfile
  ): Promise<{ stored: UserProfile; blockedByTombstone: boolean }> {
    const existing = await this.loadProfile(ownerId);
    const { stored, blockedByTombstone } = applyProfileTombstoneRule(existing, profile);
    if (blockedByTombstone) return { stored, blockedByTombstone };
    await this.exec(
      `INSERT INTO zhiyan_profiles (owner_id, data, deleted_at, updated_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (owner_id) DO UPDATE SET
         data = EXCLUDED.data,
         deleted_at = EXCLUDED.deleted_at,
         updated_at = EXCLUDED.updated_at`,
      [
        ownerId,
        JSON.stringify(stored),
        stored.deletedAt != null ? new Date(stored.deletedAt).toISOString() : null,
        new Date(stored.updatedAt).toISOString(),
      ]
    );
    return { stored, blockedByTombstone };
  }
}
