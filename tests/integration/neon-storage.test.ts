// Neon PostgreSQL storage adapter integration tests (#21).
//
// ALL tests run against a fake SqlExecutor (the replaceable-driver seam) —
// no test in this file ever connects to a real database. The fake mimics the
// exact statement shapes the adapter emits, including the atomic
// `ON CONFLICT … DO UPDATE … WHERE completed = FALSE` completed-session
// guard. JSONB values round-trip as parsed objects like the real Neon
// driver returns them.
//
// Honest limitation: execution against a REAL Neon database is NOT verified
// in this environment (no credentials — BLOCKED, recorded in the handoff).
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  PostgresOwnedStorageProvider,
} from '../../src/lib/db/postgres-storage';
import { MIGRATION_STATEMENTS, runMigrations } from '../../src/lib/db/migrations';
import { normalizeJsonColumn, StorageUnavailableError } from '../../src/lib/db/sql-executor';
import {
  createServerStorageFromEnv,
  type ExecutorFactory,
} from '../../src/lib/server-storage';
import { MemoryOwnedStorageProvider } from '../../src/lib/owned-storage';
import type { OwnedStorageProvider } from '../../src/lib/owned-storage';
import type { SqlExecutor } from '../../src/lib/db/sql-executor';
import type { Session } from '../../src/lib/providers';

const OWNER_A = 'owner-aaaaaaaa';
const OWNER_B = 'owner-bbbbbbbb';

// ---------------------------------------------------------------------------
// Fake executor — the replaceable driver
// ---------------------------------------------------------------------------

interface FakeSessionRow {
  data: Record<string, unknown>;
  completed: boolean;
  updatedAt: string;
}

interface FakeProfileRow {
  data: Record<string, unknown>;
  deletedAt: string | null;
}

class FakeSqlExecutor implements SqlExecutor {
  executed: string[] = [];
  sessions = new Map<string, FakeSessionRow>();
  profiles = new Map<string, FakeProfileRow>();
  failAll = false;

  async query(sql: string, params: unknown[] = []): Promise<{ rows: unknown[] }> {
    this.executed.push(sql);
    if (this.failAll) throw new Error('simulated connection failure');
    const verb = sql.trim().toUpperCase();

    if (verb.startsWith('CREATE TABLE') || verb.startsWith('CREATE INDEX')) {
      return { rows: [] };
    }
    if (verb.startsWith('INSERT INTO ZHIYAN_SESSIONS')) {
      const [owner, id, data, completed, , updatedAt] = params as [
        string, string, string, boolean, string, string
      ];
      const key = `${owner}|${id}`;
      const existing = this.sessions.get(key);
      // Emulates: ON CONFLICT … DO UPDATE … WHERE zhiyan_sessions.completed = FALSE
      if (existing && existing.completed) return { rows: [] };
      this.sessions.set(key, {
        data: JSON.parse(data as string) as Record<string, unknown>,
        completed: completed as boolean,
        updatedAt: updatedAt as string,
      });
      return { rows: [] };
    }
    if (verb.startsWith('SELECT DATA FROM ZHIYAN_SESSIONS')) {
      if (sql.includes('ORDER BY')) {
        const owner = params[0] as string;
        const rows = [...this.sessions.entries()]
          .filter(([key]) => key.startsWith(`${owner}|`))
          .sort((a, b) => (a[1].updatedAt < b[1].updatedAt ? 1 : -1))
          .map(([, row]) => ({ data: row.data }));
        return { rows };
      }
      const row = this.sessions.get(`${params[0]}|${params[1]}`);
      return { rows: row ? [{ data: row.data }] : [] };
    }
    if (verb.startsWith('DELETE FROM ZHIYAN_SESSIONS')) {
      this.sessions.delete(`${params[0]}|${params[1]}`);
      return { rows: [] };
    }
    if (verb.startsWith('INSERT INTO ZHIYAN_PROFILES')) {
      const [owner, data, deletedAt] = params as [string, string, string | null];
      this.profiles.set(owner, {
        data: JSON.parse(data as string) as Record<string, unknown>,
        deletedAt,
      });
      return { rows: [] };
    }
    if (verb.startsWith('SELECT DATA FROM ZHIYAN_PROFILES')) {
      const row = this.profiles.get(params[0] as string);
      return { rows: row ? [{ data: row.data }] : [] };
    }
    throw new Error(`FakeSqlExecutor: unexpected statement: ${sql.slice(0, 60)}`);
  }
}

function makeExecutor(): FakeSqlExecutor {
  return new FakeSqlExecutor();
}

function postgresBackend(executor: SqlExecutor): OwnedStorageProvider {
  return new PostgresOwnedStorageProvider(executor);
}

let counter = 0;

function makeSession(overrides: Partial<Session> = {}): Session {
  counter += 1;
  return {
    id: `s_neon_${counter}`,
    question: '测试问题：Neon 适配器行为',
    initialOpinion: null,
    report: null,
    selectedViewpoint: null,
    messages: [],
    resultCard: null,
    completed: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

const profileOf = (values: string[], deletedAt: number | null = null) => ({
  conclusions: values.map((v) => ({
    field: 'interest' as const,
    value: v,
    confidence: 0.6,
    sourceSessionId: 's_src',
    sourceMessageId: 'm_src',
    updatedAt: 1,
  })),
  updatedAt: 1,
  deletedAt,
});

// ---------------------------------------------------------------------------
// Migration idempotency (fake-executor level)
// ---------------------------------------------------------------------------

describe('Migrations: repeatable on an empty database (fake executor level)', () => {
  it('uses only idempotent CREATE … IF NOT EXISTS statements, never destructive SQL', () => {
    assert.ok(MIGRATION_STATEMENTS.length >= 3, 'sessions + index + profiles expected');
    for (const statement of MIGRATION_STATEMENTS) {
      assert.match(statement, /CREATE (TABLE|INDEX) IF NOT EXISTS/);
      assert.doesNotMatch(statement, /DROP\s/i);
      assert.doesNotMatch(statement, /DELETE\s/i);
      assert.doesNotMatch(statement, /TRUNCATE/i);
      assert.doesNotMatch(statement, /ALTER\s/i);
    }
  });

  it('runs twice in a row with identical statements and no error', async () => {
    const executor = makeExecutor();
    await runMigrations(executor);
    const firstPass = [...executor.executed];
    executor.executed = [];
    await runMigrations(executor);
    assert.deepStrictEqual(executor.executed, firstPass, 'second run must be identical');
    assert.strictEqual(executor.executed.length, MIGRATION_STATEMENTS.length);
    // Existing data is untouched by re-running migrations.
    const backend = postgresBackend(executor);
    const session = makeSession();
    await backend.saveSession(OWNER_A, session);
    await runMigrations(executor);
    assert.ok(await backend.loadSession(OWNER_A, session.id), 'data must survive re-migration');
  });
});

// ---------------------------------------------------------------------------
// Adapter CRUD + owner isolation (acceptance 1)
// ---------------------------------------------------------------------------

describe('PostgresOwnedStorageProvider: CRUD with owner isolation', () => {
  it('owner A records are invisible to owner B (load/list/delete)', async () => {
    const backend = postgresBackend(makeExecutor());
    const a1 = makeSession();
    await backend.saveSession(OWNER_A, a1);

    assert.deepStrictEqual(await backend.loadSession(OWNER_A, a1.id), a1);
    assert.strictEqual(await backend.loadSession(OWNER_B, a1.id), null);
    assert.deepStrictEqual(await backend.listSessions(OWNER_B), []);

    await backend.deleteSession(OWNER_B, a1.id);
    assert.ok(await backend.loadSession(OWNER_A, a1.id), 'B delete must not touch A');

    await backend.saveSession(OWNER_B, makeSession());
    assert.strictEqual((await backend.listSessions(OWNER_A)).length, 1);
    assert.strictEqual((await backend.listSessions(OWNER_B)).length, 1);
  });

  it('updates an existing in-progress session and lists newest first', async () => {
    const backend = postgresBackend(makeExecutor());
    const s1 = makeSession({ updatedAt: 1000 });
    const s2 = makeSession({ updatedAt: 2000 });
    await backend.saveSession(OWNER_A, s1);
    await backend.saveSession(OWNER_A, s2);

    const updated: Session = { ...s1, messages: [{ id: 'm1', role: 'user', text: '回答', timestamp: 5 }], updatedAt: 3000 };
    await backend.saveSession(OWNER_A, updated);

    const listed = await backend.listSessions(OWNER_A);
    assert.deepStrictEqual(listed.map((s) => s.id), [s1.id, s2.id], 's1 has the newest updatedAt now');
    assert.strictEqual((await backend.loadSession(OWNER_A, s1.id))!.messages.length, 1);
  });

  it('deletes only the addressed owner/session pair', async () => {
    const backend = postgresBackend(makeExecutor());
    const keep = makeSession();
    const drop = makeSession();
    await backend.saveSession(OWNER_A, keep);
    await backend.saveSession(OWNER_A, drop);
    await backend.deleteSession(OWNER_A, drop.id);
    assert.ok(await backend.loadSession(OWNER_A, keep.id));
    assert.strictEqual(await backend.loadSession(OWNER_A, drop.id), null);
  });
});

// ---------------------------------------------------------------------------
// Completed sessions are read-only at the storage layer
// ---------------------------------------------------------------------------

describe('PostgresOwnedStorageProvider: completed sessions are never overwritten', () => {
  it('allows in-progress → completed, then refuses downgrade and rewrite', async () => {
    const backend = postgresBackend(makeExecutor());
    const session = makeSession();
    await backend.saveSession(OWNER_A, session);

    const completed: Session = {
      ...session,
      completed: true,
      resultCard: {
        sessionId: session.id,
        initialStance: { text: '初始', source: 'user_authored' },
        selectedStartingStance: null,
        finalPosition: '最终',
        messageIds: [],
      },
      updatedAt: session.updatedAt + 10,
    };
    await backend.saveSession(OWNER_A, completed);
    const stored = await backend.loadSession(OWNER_A, session.id);
    assert.strictEqual(stored!.completed, true);
    assert.ok(stored!.resultCard, 'the result card must be persisted with completion');

    // Downgrade attempt must not overwrite the completed row.
    await backend.saveSession(OWNER_A, { ...session, completed: false, messages: [] });
    const afterDowngrade = await backend.loadSession(OWNER_A, session.id);
    assert.strictEqual(afterDowngrade!.completed, true);
    assert.ok(afterDowngrade!.resultCard);

    // Rewrite attempt must not overwrite the completed row either.
    await backend.saveSession(OWNER_A, { ...completed, question: '篡改' });
    const afterRewrite = await backend.loadSession(OWNER_A, session.id);
    assert.strictEqual(afterRewrite!.question, completed.question);
  });

  it('pins the completed-readonly guard in the upsert SQL text itself', async () => {
    // The fake executor emulates the guard BEHAVIORALLY (hardcoded in its
    // INSERT branch), so the tests above would stay green even if the clause
    // were dropped from the adapter. This test pins the STATEMENT TEXT: the
    // atomic guard must be part of the emitted SQL, exactly as documented in
    // postgres-storage.ts.
    const executor = makeExecutor();
    const backend = postgresBackend(executor);
    const session = makeSession();
    await backend.saveSession(OWNER_A, session);
    await backend.saveSession(OWNER_A, { ...session, updatedAt: session.updatedAt + 1 });

    const upserts = executor.executed.filter((sql) =>
      sql.trim().toUpperCase().startsWith('INSERT INTO ZHIYAN_SESSIONS')
    );
    assert.ok(upserts.length >= 2, 'both writes must have executed the upsert statement');
    for (const sql of upserts) {
      assert.match(sql, /ON CONFLICT\s*\(owner_id,\s*session_id\)\s*DO UPDATE/i);
      assert.match(
        sql,
        /WHERE\s+zhiyan_sessions\.completed\s*=\s*FALSE/i,
        'the upsert must carry the atomic completed-readonly guard clause'
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Profile persistence + tombstone on the adapter
// ---------------------------------------------------------------------------

describe('PostgresOwnedStorageProvider: profile rows and tombstone semantics', () => {
  it('stores and loads profiles per owner, isolated across owners', async () => {
    const backend = postgresBackend(makeExecutor());
    await backend.saveProfile(OWNER_A, profileOf(['兴趣A']));
    assert.strictEqual((await backend.loadProfile(OWNER_A))!.conclusions[0]!.value, '兴趣A');
    assert.strictEqual(await backend.loadProfile(OWNER_B), null);
  });

  it('keeps the deletion tombstone and blocks auto-rebuild from old evidence', async () => {
    const backend = postgresBackend(makeExecutor());
    await backend.saveProfile(OWNER_A, profileOf(['兴趣A', '兴趣B']));
    const { stored: tombstone } = await backend.saveProfile(OWNER_A, profileOf([], Date.now()));
    assert.strictEqual(tombstone.deletedAt != null, true);
    assert.strictEqual(tombstone.conclusions.length, 0);

    const rebuild = await backend.saveProfile(OWNER_A, profileOf(['旧证据结论']));
    assert.strictEqual(rebuild.blockedByTombstone, true, 'active write must be blocked');
    const reloaded = await backend.loadProfile(OWNER_A);
    assert.strictEqual(reloaded!.deletedAt != null, true);
    assert.strictEqual(reloaded!.conclusions.length, 0, 'no conclusions may reappear');
  });
});

// ---------------------------------------------------------------------------
// Database failure → explicit, typed degradation signal
// ---------------------------------------------------------------------------

describe('PostgresOwnedStorageProvider: database failure surfaces StorageUnavailableError', () => {
  it('wraps executor failures so routes can emit the degradation signal', async () => {
    const executor = makeExecutor();
    executor.failAll = true;
    const backend = postgresBackend(executor);

    await assert.rejects(
      () => backend.saveSession(OWNER_A, makeSession()),
      StorageUnavailableError
    );
    await assert.rejects(() => backend.loadSession(OWNER_A, 's_x'), StorageUnavailableError);
    await assert.rejects(() => backend.listSessions(OWNER_A), StorageUnavailableError);
    await assert.rejects(() => backend.loadProfile(OWNER_A), StorageUnavailableError);
  });
});

// ---------------------------------------------------------------------------
// Behavior equivalence: Postgres adapter (fake driver) vs Memory backend
// ---------------------------------------------------------------------------

describe('Behavior equivalence: Postgres adapter vs MemoryOwnedStorageProvider', () => {
  it('produces identical observable outcomes for the same scenario', async () => {
    const scenario = async (backend: OwnedStorageProvider) => {
      // Fixed ids AND timestamps: both runs must observe identical results.
      const mk = (id: string, overrides: Partial<Session> = {}): Session =>
        makeSession({ id, createdAt: 0, ...overrides });
      const a1 = mk('s_eq_a1', { updatedAt: 1000 });
      const a2 = mk('s_eq_a2', { updatedAt: 2000 });
      await backend.saveSession(OWNER_A, a1);
      await backend.saveSession(OWNER_A, a2);
      await backend.saveSession(OWNER_B, mk('s_eq_b1', { updatedAt: 500 }));

      await backend.saveSession(OWNER_A, {
        ...a1,
        completed: true,
        resultCard: {
          sessionId: a1.id,
          initialStance: null,
          selectedStartingStance: null,
          finalPosition: '最终',
          messageIds: [],
        },
        updatedAt: 3000,
      });
      // Both backends must refuse to overwrite the completed session.
      await backend.saveSession(OWNER_A, { ...a1, completed: false, updatedAt: 4000 });

      await backend.deleteSession(OWNER_B, 'nonexistent');
      const profile = await backend.saveProfile(OWNER_A, profileOf(['v1']));
      await backend.saveProfile(OWNER_A, profileOf([], 123));
      const blocked = await backend.saveProfile(OWNER_A, profileOf(['v2']));

      return {
        a1: await backend.loadSession(OWNER_A, a1.id),
        bSeesA1: await backend.loadSession(OWNER_B, a1.id),
        listA: (await backend.listSessions(OWNER_A)).map((s) => [s.id, s.completed, s.updatedAt]),
        listBCount: (await backend.listSessions(OWNER_B)).length,
        profileStored: profile.stored.conclusions.length,
        blocked: blocked.blockedByTombstone,
        profileAfterDelete: await backend.loadProfile(OWNER_A),
      };
    };

    const memory = await scenario(new MemoryOwnedStorageProvider());
    const postgres = await scenario(postgresBackend(makeExecutor()));
    assert.deepStrictEqual(postgres, memory);
  });
});

// ---------------------------------------------------------------------------
// Factory: env-driven mode selection + degradation (no real DB anywhere)
// ---------------------------------------------------------------------------

describe('createServerStorageFromEnv: mode selection and degradation', () => {
  it('uses in-memory mode and never touches a driver without DATABASE_URL', async () => {
    let factoryCalls = 0;
    const factory: ExecutorFactory = async () => {
      factoryCalls += 1;
      return makeExecutor();
    };
    const storage = await createServerStorageFromEnv({}, factory);
    assert.strictEqual(storage.mode, 'memory');
    assert.strictEqual(factoryCalls, 0, 'no executor may be created without DATABASE_URL');
    const scope = storage.forOwner(OWNER_A);
    const session = makeSession();
    await scope.sessions.saveSession(session);
    assert.ok(await scope.sessions.loadSession(session.id));
  });

  it('runs migrations and persists through the fake executor in postgres mode', async () => {
    const executor = makeExecutor();
    const factory: ExecutorFactory = async () => executor;
    const storage = await createServerStorageFromEnv(
      { DATABASE_URL: 'postgresql://user:pass@example.invalid/db' },
      factory
    );
    assert.strictEqual(storage.mode, 'postgres');
    assert.strictEqual(executor.executed.length, MIGRATION_STATEMENTS.length, 'migrations ran once at startup');

    const session = makeSession();
    await storage.forOwner(OWNER_A).sessions.saveSession(session);
    const other = storage.forOwner(OWNER_B);
    assert.ok(await storage.forOwner(OWNER_A).sessions.loadSession(session.id));
    assert.strictEqual(await other.sessions.loadSession(session.id), null, 'owner isolation holds in postgres mode');
  });

  it('degrades to an always-unavailable backend when the database cannot be reached', async () => {
    const factory: ExecutorFactory = async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    };
    const storage = await createServerStorageFromEnv(
      { DATABASE_URL: 'postgresql://user:pass@example.invalid/db' },
      factory
    );
    assert.strictEqual(storage.mode, 'postgres', 'mode stays postgres — no pretending');
    const scope = storage.forOwner(OWNER_A);
    await assert.rejects(() => scope.sessions.saveSession(makeSession()), StorageUnavailableError);
    await assert.rejects(() => scope.sessions.loadSession('s_x'), StorageUnavailableError);
    await assert.rejects(() => scope.loadProfile(), StorageUnavailableError);
  });
});

// ---------------------------------------------------------------------------
// JSONB normalization helper
// ---------------------------------------------------------------------------

describe('normalizeJsonColumn', () => {
  it('accepts parsed objects (Neon driver shape) and raw JSON text, null stays null', () => {
    const obj = { id: 's1', completed: false };
    assert.deepStrictEqual(normalizeJsonColumn(obj), obj);
    assert.deepStrictEqual(normalizeJsonColumn(JSON.stringify(obj)), obj);
    assert.strictEqual(normalizeJsonColumn(null), null);
    assert.strictEqual(normalizeJsonColumn(undefined), null);
    assert.strictEqual(normalizeJsonColumn('not-json'), null);
  });
});
