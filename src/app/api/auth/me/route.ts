import { NextResponse } from 'next/server';
import { requireAuth, createGuestSession, buildSessionCookieString } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const auth = await requireAuth(request);
    const response = NextResponse.json({
      user: {
        id: auth.userId,
        name: auth.name,
        email: auth.email,
        isGuest: auth.isGuest,
      },
    });

    // If request had no session cookie and we created a fresh guest, set the cookie header
    const cookieHeader = request.headers.get('cookie');
    if (!cookieHeader || (!cookieHeader.includes('zhiyan_session') && !cookieHeader.includes('__Host-session'))) {
      const guest = await createGuestSession();
      response.headers.set('Set-Cookie', buildSessionCookieString(guest.token));
      return NextResponse.json({
        user: {
          id: guest.user.id,
          name: guest.user.name,
          email: guest.user.email,
          isGuest: guest.user.isGuest,
        },
      }, { headers: { 'Set-Cookie': buildSessionCookieString(guest.token) } });
    }

    return response;
  } catch (err) {
    console.error('[auth/me] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
