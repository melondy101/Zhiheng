// Simplified profile persistence endpoint (#21).
//
// Ownership: the profile is stored per anonymous owner (`x-zhiyan-owner`
// header, same as sessions). Deletion keeps a tombstone — conclusions are
// emptied and deletedAt is set — while report and session rows are never
// touched, and a tombstoned profile can never be auto-rebuilt from old
// evidence (server-side equivalent of the client's updateProfile rule).
//
//   GET    /api/profile → this owner's stored profile (or null)
//   PUT    /api/profile → persist a profile; a deleted profile is never
//                         resurrected (blockedByTombstone in the response)
//   DELETE /api/profile → write the deletion tombstone (conclusions emptied)
import { NextResponse } from 'next/server';
import { getServerStorage, StorageUnavailableError } from '@/lib/server-storage';
import { readOwnerId } from '@/lib/owner-id';
import type { UserProfile } from '@/lib/lifecycle';
import { deriveThinkingProfileFromHistory, collectDecisionTraces, generateThinkingReview } from '@/lib/thinking-personality';
import type { StoryRun } from '@/lib/story-run';
import { getLLMProvider } from '@/lib/server-providers';

export const runtime = 'nodejs';

function isUserProfile(value: unknown): value is UserProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const p = value as Partial<UserProfile>;
  return (
    Array.isArray(p.conclusions) &&
    typeof p.updatedAt === 'number' &&
    (p.deletedAt === null || typeof p.deletedAt === 'number')
  );
}

function storageUnavailableResponse() {
  return NextResponse.json(
    { error: 'Server storage unavailable', storage: 'unavailable' },
    { status: 503 }
  );
}

function missingOwnerResponse() {
  return NextResponse.json(
    { error: 'Missing or invalid x-zhiyan-owner header' },
    { status: 400 }
  );
}

const feedbackStore = new Map<string, { rating: 'accurate' | 'partial' | 'inaccurate'; note?: string; updatedAt: number }>();

export async function GET(request: Request) {
  const ownerId = readOwnerId(request);
  if (!ownerId) return missingOwnerResponse();
  const serverStorage = await getServerStorage();
  try {
    const scope = serverStorage.forOwner(ownerId);
    const profile = await scope.loadProfile();
    const sessions = await scope.sessions.listSessions();
    const stories = sessions.map((s) => s.storyRun).filter((s): s is StoryRun => Boolean(s));
    const thinkingProfile = stories.length ? deriveThinkingProfileFromHistory(stories) : null;
    const decisionTraces = collectDecisionTraces(stories);
    const aiReview = thinkingProfile ? await generateThinkingReview(getLLMProvider(), thinkingProfile, decisionTraces) : null;
    return NextResponse.json({ profile, thinkingProfile, decisionTraces, aiReview, storage: serverStorage.mode });
  } catch (err) {
    if (err instanceof StorageUnavailableError) return storageUnavailableResponse();
    throw err;
  }
}

export async function PUT(request: Request) {
  const ownerId = readOwnerId(request);
  if (!ownerId) return missingOwnerResponse();
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const incoming = (payload as { profile?: unknown } | null)?.profile;
  if (!isUserProfile(incoming)) {
    return NextResponse.json({ error: 'Invalid profile body' }, { status: 400 });
  }

  const serverStorage = await getServerStorage();
  try {
    const { stored, blockedByTombstone } = await serverStorage
      .forOwner(ownerId)
      .saveProfile(incoming);
    return NextResponse.json({
      profile: stored,
      blockedByTombstone,
      storage: serverStorage.mode,
    });
  } catch (err) {
    if (err instanceof StorageUnavailableError) return storageUnavailableResponse();
    throw err;
  }
}

export async function PATCH(request: Request) {
  const ownerId = readOwnerId(request);
  if (!ownerId) return missingOwnerResponse();
  const body = await request.json().catch(() => null) as { rating?: string; note?: string } | null;
  if (!body || !['accurate', 'partial', 'inaccurate'].includes(body.rating ?? '')) return NextResponse.json({ error: 'Invalid feedback' }, { status: 400 });
  feedbackStore.set(ownerId, { rating: body.rating as 'accurate' | 'partial' | 'inaccurate', note: typeof body.note === 'string' ? body.note.slice(0, 500) : undefined, updatedAt: Date.now() });
  return NextResponse.json({ ok: true, feedback: feedbackStore.get(ownerId) });
}

export async function DELETE(request: Request) {
  const ownerId = readOwnerId(request);
  if (!ownerId) return missingOwnerResponse();
  const serverStorage = await getServerStorage();
  try {
    // Deletion = tombstone, NOT row removal: conclusions are emptied and
    // deletedAt is set so old evidence can never auto-rebuild the profile.
    // Sessions and reports are separate rows and are not touched.
    const { stored } = await serverStorage.forOwner(ownerId).saveProfile({
      conclusions: [],
      updatedAt: Date.now(),
      deletedAt: Date.now(),
    });
    return NextResponse.json({ profile: stored, storage: serverStorage.mode });
  } catch (err) {
    if (err instanceof StorageUnavailableError) return storageUnavailableResponse();
    throw err;
  }
}
