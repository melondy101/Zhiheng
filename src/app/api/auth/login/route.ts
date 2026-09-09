import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import {
  getUserStore,
  extractSessionFromRequest,
  signSessionToken,
  buildSessionCookieString,
} from '@/lib/auth';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    let body: { email?: unknown; password?: unknown; migrateCurrentGuest?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: '无效的 JSON 请求体' }, { status: 400 });
    }

    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const migrateCurrentGuest = body.migrateCurrentGuest === true;

    if (!email || !password) {
      return NextResponse.json({ error: '请输入邮箱和密码' }, { status: 400 });
    }

    const store = await getUserStore();
    const user = await store.findUserByEmail(email);

    if (!user || user.isGuest) {
      return NextResponse.json({ error: '邮箱或密码错误' }, { status: 401 });
    }

    const passwordMatch = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatch) {
      return NextResponse.json({ error: '邮箱或密码错误' }, { status: 401 });
    }

    // Optional migration if user requested to merge current guest session
    if (migrateCurrentGuest) {
      const currentSession = await extractSessionFromRequest(request);
      if (currentSession && currentSession.isGuest && currentSession.userId !== user.id) {
        console.log(`[auth/login] Merging guest session ${currentSession.userId} into ${user.id}`);
        await store.migrateGuestToUser(currentSession.userId, user.id);
      }
    }

    const token = await signSessionToken({
      userId: user.id,
      name: user.name,
      email: user.email,
      isGuest: false,
    });

    const cookieHeader = buildSessionCookieString(token);
    return NextResponse.json(
      {
        ok: true,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          isGuest: false,
        },
        message: '登录成功',
      },
      {
        headers: {
          'Set-Cookie': cookieHeader,
        },
      }
    );
  } catch (err) {
    console.error('[auth/login] error:', err);
    return NextResponse.json({ error: '登录失败，请稍后重试' }, { status: 500 });
  }
}
