import { NextResponse } from 'next/server';
import { requireAuth, createGuestSession, buildSessionCookieString, generateGuestIdentity } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const auth = await requireAuth(request);
    const cookieHeader = request.headers.get('cookie');
    const hasSessionCookie = cookieHeader && (cookieHeader.includes('zhiyan_session') || cookieHeader.includes('__Host-session'));

    const response = NextResponse.json({
      user: {
        id: auth.userId,
        name: auth.name,
        email: auth.email,
        isGuest: auth.isGuest,
      },
    });

    // If request had no session cookie and we created a fresh guest, set the cookie header
    if (!hasSessionCookie) {
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
    console.warn('[auth/me] error during session resolution, returning fallback guest:', err);
    const guestIdentity = generateGuestIdentity();
    return NextResponse.json({
      user: {
        id: guestIdentity.id,
        name: guestIdentity.name,
        email: guestIdentity.email,
        isGuest: true,
      },
    });
  }
}
