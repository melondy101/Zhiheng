// Legacy session endpoint, minimally rewired for anonymous ownership (#21).
// It is NOT the interrogation seam (see /api/interrogate and the #15
// orchestrator); it serves the cross-session recovery path:
//   GET /api/session?id=… — fetch one of THIS owner's stored sessions
//                           (used when the local mirror is missing/stale).
//   POST /api/session     — mirror-style updates to a NON-completed session.
//
// Completed sessions are read-only here (409): the orchestration API is the
// only writer allowed to complete a session (it also builds the result
// card), and the storage adapter itself refuses to overwrite completed rows.
import { NextResponse } from 'next/server';
import { getServerStorage, StorageUnavailableError } from '@/lib/server-storage';
import { readOwnerId } from '@/lib/owner-id';

export const runtime = 'nodejs';

function storageUnavailableResponse() {
  return NextResponse.json(
    { error: 'Server storage unavailable', storage: 'unavailable' },
    { status: 503 }
  );
}

export async function GET(request: Request) {
  const ownerId = readOwnerId(request);
  if (!ownerId) {
    return NextResponse.json(
      { error: 'Missing or invalid x-zhiyan-owner header' },
      { status: 400 }
    );
  }
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'Missing id parameter' }, { status: 400 });
  }

  const serverStorage = await getServerStorage();
  try {
    const session = await serverStorage.forOwner(ownerId).sessions.loadSession(id);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
    return NextResponse.json({ session, storage: serverStorage.mode });
  } catch (err) {
    if (err instanceof StorageUnavailableError) return storageUnavailableResponse();
    throw err;
  }
}

export async function POST(request: Request) {
  const ownerId = readOwnerId(request);
  if (!ownerId) {
    return NextResponse.json(
      { error: 'Missing or invalid x-zhiyan-owner header' },
      { status: 400 }
    );
  }

  const data = await request.json();
  if (!data.id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }
  if (data.completed !== undefined) {
    return NextResponse.json(
      { error: 'completed is managed by the interrogation API only' },
      { status: 400 }
    );
  }

  const serverStorage = await getServerStorage();
  const scope = serverStorage.forOwner(ownerId);
  try {
    const existing = await scope.sessions.loadSession(data.id);
    if (!existing) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
    // Completed sessions are read-only (#21).
    if (existing.completed) {
      return NextResponse.json({ error: 'Session already completed' }, { status: 409 });
    }
    if (data.selectedViewpoint !== undefined) {
      existing.selectedViewpoint = data.selectedViewpoint;
    }
    if (data.resultCard) {
      existing.resultCard = data.resultCard;
    }
    existing.updatedAt = Date.now();

    await scope.sessions.saveSession(existing);
    return NextResponse.json({ ok: true, session: existing, storage: serverStorage.mode });
  } catch (err) {
    if (err instanceof StorageUnavailableError) return storageUnavailableResponse();
    throw err;
  }
}
