// Session recovery priority and conflict rules (#21).
// Rules under test (see src/lib/session-recovery.ts):
//   1. one copy → use it; 2. newer updatedAt wins; 3. completed never
//   downgraded; 4. timestamp tie → durable server copy wins.
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { pickRecoverySession, storageNoticeFor } from '../../src/lib/session-recovery';
import type { Session } from '../../src/lib/providers';

let counter = 0;

function makeSession(overrides: Partial<Session> = {}): Session {
  counter += 1;
  return {
    id: 's_recover',
    question: '测试问题',
    initialOpinion: null,
    report: null,
    selectedViewpoint: null,
    messages: [],
    resultCard: null,
    completed: false,
    createdAt: 1,
    updatedAt: 100,
    ...overrides,
  };
}

describe('pickRecoverySession: recovery priority and conflict rules', () => {
  it('uses whichever copy exists when only one does', () => {
    const local = makeSession();
    const remote = makeSession({ updatedAt: 200 });
    assert.strictEqual(pickRecoverySession(local, null), local);
    assert.strictEqual(pickRecoverySession(null, remote), remote);
    assert.strictEqual(pickRecoverySession(null, null), null);
  });

  it('prefers the newer updatedAt when both exist ("newer wins")', () => {
    const local = makeSession({ updatedAt: 300 });
    const remote = makeSession({ updatedAt: 200 });
    assert.strictEqual(pickRecoverySession(local, remote), local);
    const olderLocal = makeSession({ updatedAt: 200 });
    const newerRemote = makeSession({ updatedAt: 300 });
    assert.strictEqual(pickRecoverySession(olderLocal, newerRemote), newerRemote);
  });

  it('never downgrades a completed session to in-progress', () => {
    const localCompleted = makeSession({ completed: true, updatedAt: 100 });
    const remoteProgress = makeSession({ completed: false, updatedAt: 999 });
    assert.strictEqual(
      pickRecoverySession(localCompleted, remoteProgress),
      localCompleted,
      'older completed copy must win over a newer in-progress copy'
    );
    const localProgress = makeSession({ completed: false, updatedAt: 999 });
    const remoteCompleted = makeSession({ completed: true, updatedAt: 100 });
    assert.strictEqual(pickRecoverySession(localProgress, remoteCompleted), remoteCompleted);
  });

  it('prefers the durable server copy on a timestamp tie', () => {
    const local = makeSession({ updatedAt: 100 });
    const remote = makeSession({ updatedAt: 100 });
    assert.strictEqual(pickRecoverySession(local, remote), remote);
  });
});

describe('storageNoticeFor: honest storage disclosure (#21 acceptance 3)', () => {
  it('discloses local-only on degradation and memory mode, silence on postgres', () => {
    assert.strictEqual(storageNoticeFor('postgres'), null);
    assert.match(storageNoticeFor('memory')!, /服务器内存/);
    assert.match(storageNoticeFor('unavailable')!, /服务端存储不可用/);
    assert.match(storageNoticeFor('unavailable')!, /本机浏览器/);
    assert.strictEqual(storageNoticeFor(undefined), null);
  });
});
