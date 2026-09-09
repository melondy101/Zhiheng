import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { SignJWT, jwtVerify } from 'jose';

const SESSION_COOKIE_NAME = 'zhiyan_session';
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days

function getSecretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET || 'zhiyan-secure-auth-secret-key-min-32-chars!';
  return new TextEncoder().encode(secret);
}

export async function middleware(request: NextRequest) {
  const response = NextResponse.next();
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value || request.cookies.get('__Host-session')?.value;
  const secretKey = getSecretKey();

  let userId: string | null = null;
  let isGuest = true;
  let userName = '访客';
  let userEmail = '';

  if (sessionCookie) {
    try {
      const { payload } = await jwtVerify(sessionCookie, secretKey, {
        algorithms: ['HS256'],
      });
      if (typeof payload.userId === 'string') {
        userId = payload.userId;
        isGuest = Boolean(payload.isGuest);
        userName = typeof payload.name === 'string' ? payload.name : '访客';
        userEmail = typeof payload.email === 'string' ? payload.email : '';
      }
    } catch {
      // Invalid/expired token, will regenerate guest
    }
  }

  // If no valid session, generate guest session
  if (!userId) {
    const hex = Math.random().toString(16).slice(2, 6);
    userId = `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    userName = `访客 ${hex}`;
    userEmail = `temp-${userId.slice(0, 8)}@anon.local`;
    isGuest = true;

    const token = await new SignJWT({
      userId,
      name: userName,
      email: userEmail,
      isGuest: true,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
      .sign(secretKey);

    response.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: token,
      path: '/',
      maxAge: SESSION_MAX_AGE_SECONDS,
      sameSite: 'lax',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
    });
  }

  // Forward user information in request headers for fast SSR access
  response.headers.set('x-zhiyan-owner', userId);

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - feedback (public assets)
     */
    '/((?!_next/static|_next/image|favicon.ico|feedback).*)',
  ],
};
