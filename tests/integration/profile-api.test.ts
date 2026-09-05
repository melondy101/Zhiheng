// /api/profile integration tests (#21): the simplified profile is persisted
// per anonymous owner with tombstone deletion semantics. Route handlers are
// exercised directly with real Request objects against the real server
// storage singleton (memory mode — no DATABASE_URL in the test environment).
import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { GET, PUT, DELETE } from '../../src/app/api/profile/route';
import { getServerStorage, type OwnerStorageScope } from '../../src/lib/server-storage';
import type { UserProfile } from '../../src/lib/lifecycle';

const RUN_ID = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
const OWNER_A = `owner-profile-a-${RUN_ID}`;
const OWNER_B = `owner-profile-b-${RUN_ID}`;
let scope: OwnerStorageScope;
let scopeB: OwnerStorageScope;

before(async () => {
  const manager = await getServerStorage();
  scope = manager.forOwner(OWNER_A);
  scopeB = manager.forOwner(OWNER_B);
});

const activeProfile = (): UserProfile => ({
  conclusions: [
    {
      field: 'interest',
      value: 'AI 与创造力',
      confidence: 0.6,
      sourceSessionId: 's_profile_src',
      sourceMessageId: 'm_profile_src',
      updatedAt: 1,
    },
  ],
  updatedAt: 1,
  deletedAt: null,
});

async function call(
  handler: (request: Request) => Promise<Response>,
  method: string,
  owner: string | null,
  body?: unknown
): Promise<{ status: number; body: Record<string, unknown> }> {
  const request = new Request('http://localhost:3000/api/profile', {
    method,
    headers: {
      'content-type': 'application/json',
      ...(owner ? { 'x-zhiyan-owner': owner } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const response = await handler(request);
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe('GET /api/profile', () => {
  it('returns 400 without a valid x-zhiyan-owner header', async () => {
    const result = await call(GET, 'GET', null);
    assert.strictEqual(result.status, 400);
    const bad = await call(GET, 'GET', 'short');
    assert.strictEqual(bad.status, 400, 'malformed owner ids must be rejected');
  });

  it('returns null before the first save and the stored profile after', async () => {
    const empty = await call(GET, 'GET', OWNER_A);
    assert.strictEqual(empty.status, 200);
    assert.strictEqual(empty.body.profile, null);
    assert.ok(empty.body.storage === 'memory' || empty.body.storage === 'postgres');

    await scope.saveProfile(activeProfile());
    const saved = await call(GET, 'GET', OWNER_A);
    const profile = saved.body.profile as UserProfile;
    assert.strictEqual(profile.conclusions[0]!.value, 'AI 与创造力');
    // Provenance survived the round-trip (#21 scope: conclusions carry their
    // source message/session ids).
    assert.strictEqual(profile.conclusions[0]!.sourceSessionId, 's_profile_src');
    assert.strictEqual(profile.conclusions[0]!.sourceMessageId, 'm_profile_src');
  });

  it('never exposes one owner profile to another owner', async () => {
    const other = await call(GET, 'GET', OWNER_B);
    assert.strictEqual(other.body.profile, null, 'B must not see A profile');
  });
});

describe('PUT /api/profile', () => {
  it('persists the profile and rejects malformed bodies', async () => {
    const ok = await call(PUT, 'PUT', OWNER_A, { profile: activeProfile() });
    assert.strictEqual(ok.status, 200);
    assert.strictEqual(ok.body.blockedByTombstone, false);
    assert.strictEqual((ok.body.profile as UserProfile).conclusions.length, 1);

    const invalid = await call(PUT, 'PUT', OWNER_A, { profile: { conclusions: 'nope' } });
    assert.strictEqual(invalid.status, 400);
  });
});

describe('DELETE /api/profile: tombstone semantics (#21 acceptance 2)', () => {
  it('empties the conclusions, keeps the deletedAt marker, and preserves sessions', async () => {
    // Seed a report/session for owner A to prove a profile deletion never
    // touches reports or sessions.
    const session = {
      id: 's_profile_keep',
      question: '测试问题',
      initialOpinion: null,
      report: { question: '测试问题', title: 't', knowledgePoints: [], content: 'c', viewpoints: [], references: [], citations: {} },
      selectedViewpoint: null,
      messages: [],
      resultCard: null,
      completed: false,
      createdAt: 1,
      updatedAt: 1,
    };
    await scope.sessions.saveSession(session);

    await scope.saveProfile(activeProfile());
    const deleted = await call(DELETE, 'DELETE', OWNER_A);
    assert.strictEqual(deleted.status, 200);
    const tombstone = deleted.body.profile as UserProfile;
    assert.strictEqual(tombstone.conclusions.length, 0, 'only the conclusions are deleted');
    assert.strictEqual(typeof tombstone.deletedAt, 'number');
    assert.strictEqual(tombstone.deletedAt != null, true);

    // Sessions/reports are untouched.
    const kept = await scope.sessions.loadSession('s_profile_keep');
    assert.ok(kept, 'session must survive profile deletion');
    assert.ok(kept!.report, 'report must survive profile deletion');

    // Old evidence must not auto-rebuild the profile.
    const rebuild = await call(PUT, 'PUT', OWNER_A, { profile: activeProfile() });
    assert.strictEqual(rebuild.body.blockedByTombstone, true);
    assert.strictEqual(((rebuild.body.profile as UserProfile).conclusions.length), 0);
  });
});
