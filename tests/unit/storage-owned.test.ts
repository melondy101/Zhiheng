// Ownership-aware storage semantics on the in-memory backend (#21).
// Covers: owner isolation, the completed-session write guard, the profile
// tombstone rule, the per-owner scoped view, and the owner-id validation
// contract that API routes enforce.
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  MemoryOwnedStorageProvider,
  mayWriteSession,
  applyProfileTombstoneRule,
  scopeStorageByOwner,
} from '../../src/lib/owned-storage';
import { isValidOwnerId, OWNER_ID_HEADER } from '../../src/lib/owner-id';
import type { Session } from '../../src/lib/providers';
import type { UserProfile } from '../../src/lib/lifecycle';

const OWNER_A = 'owner-aaaaaaaa';
const OWNER_B = 'owner-bbbbbbbb';

let counter = 0;

function makeSession(overrides: Partial<Session> = {}): Session {
  counter += 1;
  return {
    id: `s_owned_${counter}`,
    question: '测试问题',
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

describe('MemoryOwnedStorageProvider: owner isolation (#21 acceptance 1)', () => {
  it('hides owner A sessions from owner B (load, list, delete)', async () => {
    const backend = new MemoryOwnedStorageProvider();
    const a1 = makeSession();
    await backend.saveSession(OWNER_A, a1);

    assert.ok(await backend.loadSession(OWNER_A, a1.id));
    assert.strictEqual(await backend.loadSession(OWNER_B, a1.id), null, 'B must not read A');
    assert.strictEqual((await backend.listSessions(OWNER_B)).length, 0);

    // B deleting the same session id must not touch A's record.
    await backend.deleteSession(OWNER_B, a1.id);
    assert.ok(await backend.loadSession(OWNER_A, a1.id), 'A record must survive');

    await backend.saveSession(OWNER_B, makeSession());
    assert.strictEqual((await backend.listSessions(OWNER_A)).length, 1);
    assert.strictEqual((await backend.listSessions(OWNER_B)).length, 1);
  });

  it('sorts listSessions by updatedAt descending within one owner', async () => {
    const backend = new MemoryOwnedStorageProvider();
    const older = makeSession({ updatedAt: 1000 });
    const newer = makeSession({ updatedAt: 2000 });
    await backend.saveSession(OWNER_A, older);
    await backend.saveSession(OWNER_A, newer);
    const listed = await backend.listSessions(OWNER_A);
    assert.deepStrictEqual(listed.map((s) => s.id), [newer.id, older.id]);
  });
});

describe('Completed sessions are read-only (#21 acceptance: completed never overwritten)', () => {
  it('refuses to overwrite an existing completed session', async () => {
    const backend = new MemoryOwnedStorageProvider();
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
    await backend.saveSession(OWNER_A, completed); // in-progress → completed: allowed
    const stored = await backend.loadSession(OWNER_A, session.id);
    assert.strictEqual(stored!.completed, true);
    assert.ok(stored!.resultCard);

    // Downgrade attempt: completed → in-progress must be a no-op.
    await backend.saveSession(OWNER_A, { ...session, completed: false, messages: [] });
    const afterDowngrade = await backend.loadSession(OWNER_A, session.id);
    assert.strictEqual(afterDowngrade!.completed, true, 'completed must never be downgraded');
    assert.ok(afterDowngrade!.resultCard, 'completed content must survive');

    // Any rewrite of a completed session must be a no-op.
    await backend.saveSession(OWNER_A, { ...completed, question: '篡改后的问题' });
    const afterRewrite = await backend.loadSession(OWNER_A, session.id);
    assert.strictEqual(afterRewrite!.question, completed.question);
  });

  it('mayWriteSession pins the guard as a pure rule', () => {
    const completed = makeSession({ completed: true });
    assert.strictEqual(mayWriteSession(null), true);
    assert.strictEqual(mayWriteSession(makeSession()), true);
    assert.strictEqual(mayWriteSession(completed), false);
  });
});

describe('Profile tombstone rule (#21 acceptance 2)', () => {
  const profile = (conclusions: number, deletedAt: number | null = null): UserProfile => ({
    conclusions: Array.from({ length: conclusions }, (_, i) => ({
      field: 'interest' as const,
      value: `c${i}`,
      confidence: 0.6,
      sourceSessionId: 's_src',
      sourceMessageId: 'm_src',
      updatedAt: 1,
    })),
    updatedAt: 1,
    deletedAt,
  });

  it('blocks rebuilding a deleted profile from old evidence', async () => {
    const backend = new MemoryOwnedStorageProvider();
    await backend.saveProfile(OWNER_A, profile(2));
    await backend.saveProfile(OWNER_A, profile(0, Date.now())); // deletion tombstone

    const { stored, blockedByTombstone } = await backend.saveProfile(OWNER_A, profile(3));
    assert.strictEqual(blockedByTombstone, true, 'active write after deletion must be blocked');
    assert.strictEqual(stored.deletedAt != null, true);
    assert.strictEqual(stored.conclusions.length, 0);
    assert.strictEqual((await backend.loadProfile(OWNER_A))!.conclusions.length, 0);
  });

  it('applies the rule as a pure function and scopes it per owner', async () => {
    const deleted = profile(0, 123);
    const active = profile(2);
    assert.strictEqual(applyProfileTombstoneRule(deleted, active).blockedByTombstone, true);
    assert.strictEqual(applyProfileTombstoneRule(null, active).blockedByTombstone, false);
    assert.strictEqual(applyProfileTombstoneRule(active, active).blockedByTombstone, false);
    // Tombstone refresh (deletedAt still set) is allowed.
    assert.strictEqual(
      applyProfileTombstoneRule(deleted, profile(0, 456)).blockedByTombstone,
      false
    );

    const backend = new MemoryOwnedStorageProvider();
    await backend.saveProfile(OWNER_A, profile(1));
    assert.ok((await backend.loadProfile(OWNER_A))!.conclusions.length === 1);
    assert.strictEqual(await backend.loadProfile(OWNER_B), null, 'B must not see A profile');
  });
});

describe('scopeStorageByOwner: the StorageProvider view pinned to one owner', () => {
  it('delegates every operation through the fixed owner id', async () => {
    const backend = new MemoryOwnedStorageProvider();
    const scopeA = scopeStorageByOwner(backend, OWNER_A);
    const scopeB = scopeStorageByOwner(backend, OWNER_B);

    const session = makeSession();
    await scopeA.sessions.saveSession(session);
    assert.ok(await scopeA.sessions.loadSession(session.id));
    assert.strictEqual(await scopeB.sessions.loadSession(session.id), null);

    await scopeA.saveProfile({ conclusions: [], updatedAt: 1, deletedAt: null });
    assert.ok(await scopeA.loadProfile());
    assert.strictEqual(await scopeB.loadProfile(), null);

    assert.strictEqual(scopeA.ownerId, OWNER_A);
    // The scoped view exposes no owner parameter — a caller cannot address
    // another owner's records through it.
    assert.strictEqual(typeof scopeA.sessions.saveSession, 'function');
    assert.strictEqual(OWNER_ID_HEADER, 'x-zhiyan-owner');
  });
});

describe('Owner id validation contract (#21)', () => {
  it('accepts UUID-shaped and simple token ids, rejects the rest', () => {
    assert.strictEqual(isValidOwnerId('0e2c1a1e-8c1d-4a5e-9f3b-2b6f7c8d9e0f'), true);
    assert.strictEqual(isValidOwnerId('test-owner-interrogate'), true);
    assert.strictEqual(isValidOwnerId('short'), false);
    assert.strictEqual(isValidOwnerId(''), false);
    assert.strictEqual(isValidOwnerId('bad id with spaces'), false);
    assert.strictEqual(isValidOwnerId(123), false);
    assert.strictEqual(isValidOwnerId(null), false);
    assert.strictEqual(isValidOwnerId(undefined), false);
  });
});
