import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { GET as getMe } from '../../src/app/api/auth/me/route';
import { POST as postSendCode } from '../../src/app/api/auth/send-code/route';
import { POST as postRegister } from '../../src/app/api/auth/register/route';
import { POST as postLogin } from '../../src/app/api/auth/login/route';
import { POST as postLogout } from '../../src/app/api/auth/logout/route';
import { getUserStore, resetUserStore } from '../../src/lib/auth';
import { SESSION_COOKIE_NAME } from '../../src/lib/auth/jwt';

describe('Auth API Routes Integration', () => {
  beforeEach(async () => {
    resetUserStore();
  });

  it('GET /api/auth/me returns guest when no cookie or header is provided', async () => {
    const req = new Request('http://localhost:3000/api/auth/me', {
      method: 'GET',
    });
    const res = await getMe(req);
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as { user: { id: string; isGuest: boolean; name: string } };
    assert.ok(body.user);
    assert.strictEqual(body.user.isGuest, true);
    assert.ok(body.user.name.startsWith('访客 '));

    const setCookie = res.headers.get('set-cookie');
    assert.ok(setCookie, 'Should issue Set-Cookie for guest session');
    assert.ok(setCookie.includes(SESSION_COOKIE_NAME));
  });

  it('POST /api/auth/send-code sends verification code and respects cooldown', async () => {
    const email = `tester_${Date.now()}@example.com`;

    // 1. Invalid email
    const badReq = new Request('http://localhost:3000/api/auth/send-code', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'invalid-email' }),
    });
    const badRes = await postSendCode(badReq);
    assert.strictEqual(badRes.status, 400);

    // 2. Valid email
    const validReq = new Request('http://localhost:3000/api/auth/send-code', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const validRes = await postSendCode(validReq);
    assert.strictEqual(validRes.status, 200);
    const body = (await validRes.json()) as { ok: boolean; message: string };
    assert.strictEqual(body.ok, true);

    // Verify code exists in user store
    const store = await getUserStore();
    const record = await store.getVerificationCode(email);
    assert.ok(record !== null);
    assert.strictEqual(record.code.length, 6);

    // 3. Immediate resend within 60s is throttled
    const throttledReq = new Request('http://localhost:3000/api/auth/send-code', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const throttledRes = await postSendCode(throttledReq);
    assert.strictEqual(throttledRes.status, 429);
  });

  it('complete register -> login -> me -> logout lifecycle', async () => {
    const email = `user_${Date.now()}@example.com`;
    const password = 'securePassword123';
    const name = '思辨青年';

    // 1. Send code
    const codeReq = new Request('http://localhost:3000/api/auth/send-code', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const codeRes = await postSendCode(codeReq);
    assert.strictEqual(codeRes.status, 200);

    const store = await getUserStore();
    const record = await store.getVerificationCode(email);
    assert.ok(record !== null);
    const code = record.code;

    // 2. Register with wrong code
    const wrongCodeReq = new Request('http://localhost:3000/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, code: '000000', name }),
    });
    const wrongCodeRes = await postRegister(wrongCodeReq);
    assert.strictEqual(wrongCodeRes.status, 400);

    // 3. Register with correct code
    const regReq = new Request('http://localhost:3000/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, code, name }),
    });
    const regRes = await postRegister(regReq);
    assert.strictEqual(regRes.status, 200);
    const regBody = (await regRes.json()) as { user: { id: string; name: string; email: string; isGuest: boolean } };
    assert.strictEqual(regBody.user.name, name);
    assert.strictEqual(regBody.user.email, email);
    assert.strictEqual(regBody.user.isGuest, false);

    const setCookie = regRes.headers.get('set-cookie');
    assert.ok(setCookie);
    const cookieToken = setCookie.split(';')[0];

    // 4. GET /api/auth/me with registered session cookie
    const meReq = new Request('http://localhost:3000/api/auth/me', {
      method: 'GET',
      headers: {
        cookie: cookieToken,
      },
    });
    const meRes = await getMe(meReq);
    assert.strictEqual(meRes.status, 200);
    const meBody = (await meRes.json()) as { user: { id: string; name: string; email: string; isGuest: boolean } };
    assert.strictEqual(meBody.user.id, regBody.user.id);
    assert.strictEqual(meBody.user.isGuest, false);
    assert.strictEqual(meBody.user.name, name);

    // 5. Login with invalid password
    const badLoginReq = new Request('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'wrongPassword' }),
    });
    const badLoginRes = await postLogin(badLoginReq);
    assert.strictEqual(badLoginRes.status, 401);

    // 6. Login with correct password
    const loginReq = new Request('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const loginRes = await postLogin(loginReq);
    assert.strictEqual(loginRes.status, 200);
    const loginBody = (await loginRes.json()) as { user: { id: string; name: string; email: string; isGuest: boolean } };
    assert.strictEqual(loginBody.user.id, regBody.user.id);
    assert.strictEqual(loginBody.user.isGuest, false);

    // 7. Logout issues a fresh guest session
    const logoutRes = await postLogout();
    assert.strictEqual(logoutRes.status, 200);
    const logoutBody = (await logoutRes.json()) as { user: { id: string; isGuest: boolean } };
    assert.strictEqual(logoutBody.user.isGuest, true);
    assert.notStrictEqual(logoutBody.user.id, regBody.user.id);
  });
});
