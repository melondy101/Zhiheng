import { NextResponse } from 'next/server';
import { AnonymousIdentityProvider } from '@/lib/fixture-providers';
import { getServerStorage } from '@/lib/server-storage';

const identityProvider = new AnonymousIdentityProvider();

export const runtime = 'nodejs';

export async function GET() {
  const identity = await identityProvider.getCurrentIdentity();
  // #21/#24: honest remotePersistence disclosure. mode === 'postgres' means
  // a DATABASE_URL was configured and the system ATTEMPTED remote persistence
  // (it may be degraded/unavailable at runtime, but the attempt was made).
  // mode === 'memory' means no remote database was configured at all.
  const serverStorage = await getServerStorage();
  return NextResponse.json({
    status: 'ok',
    identity,
    timestamp: new Date().toISOString(),
    // remotePersistence: true when a DATABASE_URL was configured (even if
    // currently unreachable — the system tried). False when running purely
    // in-memory with no remote configured.
    remotePersistence: serverStorage.mode === 'postgres',
  });
}
