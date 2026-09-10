import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  signSessionToken,
  verifySessionToken,
  SESSION_COOKIE_NAME,
} from '../../src/lib/auth/jwt';
import { MemoryUserStore } from '../../src/lib/auth/user-store';
import {
  generateGuestIdentity,
  extractSessionFromRequest,
  buildSessionCookieString,
} from '../../src/lib/auth';

describe('Auth & User Store Module', () => {
  it('signs and verifies session JWT correctly', async () => {
    const payload = {
      userId: 'test-user-1234',
      name: '测试用户',
      email: 'test@example.com',
      isGuest: false,
    };

    const token = await signSessionToken(payload);
    assert.strictEqual(typeof token, 'string');
    assert.ok(token.length > 20);

    const verified = await verifySessionToken(token);
    assert.ok(verified !== null);
    assert.strictEqual(verified.userId, 'test-user-1234');
    assert.strictEqual(verified.name, '测试用户');
    assert.strictEqual(verified.email, 'test@example.com');
    assert.strictEqual(verified.isGuest, false);
  });

  it('generates random guest identities', () => {
    const g1 = generateGuestIdentity();
    const g2 = generateGuestIdentity();
    assert.notStrictEqual(g1.id, g2.id);
    assert.ok(g1.name.startsWith('访客 '));
    assert.ok(g1.email.includes('@anon.local'));
  });

  it('stores and retrieves users in MemoryUserStore', async () => {
    const store = new MemoryUserStore();
    const now = Date.now();
    const user = {
      id: 'u-101',
      name: '辩论达人',
      email: 'Debater@Zhiyan.app',
      emailLower: 'debater@zhiyan.app',
      passwordHash: '$2a$10$xyz',
      isGuest: false,
      createdAt: now,
      updatedAt: now,
    };

    await store.createUser(user);

    const byId = await store.findUserById('u-101');
    assert.ok(byId);
    assert.strictEqual(byId.name, '辩论达人');

    // Case-insensitive email lookup
    const byEmail = await store.findUserByEmail('DEBATER@zhiyan.app');
    assert.ok(byEmail);
    assert.strictEqual(byEmail.id, 'u-101');
  });

  it('manages verification codes and attempt expiration', async () => {
    const store = new MemoryUserStore();
    const email = 'verify@example.com';
    const expiresAt = Date.now() + 60_000;

    await store.saveVerificationCode(email, '888666', expiresAt);
    const rec = await store.getVerificationCode(email);
    assert.ok(rec);
    assert.strictEqual(rec.code, '888666');
    assert.strictEqual(rec.attempts, 0);

    // Increment attempts
    await store.incrementVerificationAttempt(email);
    const rec2 = await store.getVerificationCode(email);
    assert.ok(rec2);
    assert.strictEqual(rec2.attempts, 1);

    // Delete
    await store.deleteVerificationCode(email);
    const rec3 = await store.getVerificationCode(email);
    assert.strictEqual(rec3, null);
  });

  it('rate limits action attempts by IP', async () => {
    const store = new MemoryUserStore();
    const ip = '192.168.1.100';

    // 3 allowed attempts
    for (let i = 0; i < 3; i++) {
      const allowed = await store.checkRateLimit(ip, 'send_code', 60, 3);
      assert.strictEqual(allowed, true);
      await store.recordAuthAttempt(ip, 'send_code');
    }

    // 4th attempt should be blocked
    const allowedAfter = await store.checkRateLimit(ip, 'send_code', 60, 3);
    assert.strictEqual(allowedAfter, false);
  });

  it('extracts session correctly from cookie header', async () => {
    const token = await signSessionToken({
      userId: 'cookie-user-id',
      name: 'Cookie User',
      email: 'cookie@example.com',
      isGuest: false,
    });

    const request = new Request('https://zhiyan.app/api/profile', {
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${token}; other=123`,
      },
    });

    const session = await extractSessionFromRequest(request);
    assert.ok(session);
    assert.strictEqual(session.userId, 'cookie-user-id');
    assert.strictEqual(session.name, 'Cookie User');
  });

  it('extracts fallback session from x-zhiyan-owner header for backward compatibility', async () => {
    const request = new Request('https://zhiyan.app/api/session', {
      headers: {
        'x-zhiyan-owner': 'owner-test-12345',
      },
    });

    const session = await extractSessionFromRequest(request);
    assert.ok(session);
    assert.strictEqual(session.userId, 'owner-test-12345');
    assert.strictEqual(session.isGuest, true);
  });
});
