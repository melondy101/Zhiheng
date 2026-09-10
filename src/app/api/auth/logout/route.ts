import { NextResponse } from 'next/server';
import { createGuestSession, buildSessionCookieString } from '@/lib/auth';

export const runtime = 'nodejs';

export async function POST() {
  try {
    // When logging out, immediately issue a fresh guest session
    const guest = await createGuestSession();
    const cookieHeader = buildSessionCookieString(guest.token);

    return NextResponse.json(
      {
        ok: true,
        user: guest.user,
        message: '已退出登录，已为您分配临时访客身份',
      },
      {
        headers: {
          'Set-Cookie': cookieHeader,
        },
      }
    );
  } catch (err) {
    console.error('[auth/logout] error:', err);
    return NextResponse.json({ error: '退出登录失败' }, { status: 500 });
  }
}
