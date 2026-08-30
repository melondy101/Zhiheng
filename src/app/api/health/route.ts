import { NextResponse } from 'next/server';
import { AnonymousIdentityProvider } from '@/lib/fixture-providers';

const identityProvider = new AnonymousIdentityProvider();

export const runtime = 'nodejs';

export async function GET() {
  const identity = await identityProvider.getCurrentIdentity();
  return NextResponse.json({
    status: 'ok',
    identity,
    timestamp: new Date().toISOString(),
  });
}
