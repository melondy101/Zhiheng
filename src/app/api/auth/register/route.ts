import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import {
  getUserStore,
  extractSessionFromRequest,
  signSessionToken,
  buildSessionCookieString,
} from '@/lib/auth';
import type { User } from '@/lib/auth/types';

export const runtime = 'nodejs';

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function POST(request: Request) {
  try {
    let body: { email?: unknown; password?: unknown; code?: unknown; name?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: '无效的 JSON 请求体' }, { status: 400 });
    }

    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : email.split('@')[0];

    if (!email || !isValidEmail(email)) {
      return NextResponse.json({ error: '请输入有效的邮箱地址' }, { status: 400 });
    }
    if (!password || password.length < 6) {
      return NextResponse.json({ error: '密码长度至少为 6 位' }, { status: 400 });
    }
    if (!code || code.length !== 6) {
      return NextResponse.json({ error: '请输入 6 位数字验证码' }, { status: 400 });
    }

    const store = await getUserStore();

    // 1. Check if email already registered
    const existingUser = await store.findUserByEmail(email);
    if (existingUser && !existingUser.isGuest) {
      return NextResponse.json({ error: '该邮箱已被注册，请直接登录' }, { status: 409 });
    }

    // 2. Verify verification code
    const verificationRecord = await store.getVerificationCode(email);
    if (!verificationRecord) {
      return NextResponse.json({ error: '验证码已失效或未获取，请重新获取' }, { status: 400 });
    }
    if (verificationRecord.code !== code) {
      await store.incrementVerificationAttempt(email);
      return NextResponse.json({ error: '验证码错误，请重新核对' }, { status: 400 });
    }

    // 3. Hash password
    const passwordHash = await bcrypt.hash(password, 10);
    const newUserId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `u_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();

    const newUser: User = {
      id: newUserId,
      name,
      email,
      emailLower: email,
      passwordHash,
      isGuest: false,
      createdAt: now,
      updatedAt: now,
    };

    await store.createUser(newUser);

    // 4. Data migration: check if current caller has a guest session to migrate
    const currentSession = await extractSessionFromRequest(request);
    if (currentSession && currentSession.isGuest && currentSession.userId !== newUserId) {
      console.log(`[auth/register] Migrating guest data from ${currentSession.userId} to ${newUserId}`);
      await store.migrateGuestToUser(currentSession.userId, newUserId);
    }

    // 5. Delete used verification code
    await store.deleteVerificationCode(email);

    // 6. Sign new JWT token and return session cookie
    const token = await signSessionToken({
      userId: newUser.id,
      name: newUser.name,
      email: newUser.email,
      isGuest: false,
    });

    const cookieHeader = buildSessionCookieString(token);
    return NextResponse.json(
      {
        ok: true,
        user: {
          id: newUser.id,
          name: newUser.name,
          email: newUser.email,
          isGuest: false,
        },
        message: '注册成功，历史访客记录已成功绑定到您的账号',
      },
      {
        headers: {
          'Set-Cookie': cookieHeader,
        },
      }
    );
  } catch (err) {
    console.error('[auth/register] error:', err);
    return NextResponse.json({ error: '注册失败，请稍后重试' }, { status: 500 });
  }
}
