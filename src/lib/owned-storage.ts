// Ownership-aware storage contract and shared write semantics (#21).
//
// Every server-side record belongs to an anonymous owner id. All queries are
// scoped by that id, so two different anonymous devices can never read each
// other's sessions or profiles. There is no registration, no login and no
// OAuth — the owner id is a random UUID the client generates once and
// persists locally (see owner-id.ts).
//
// Completed sessions are read-only at the STORAGE layer: `saveSession` never
// overwrites an existing completed row, regardless of what the caller sends.
// This is defense in depth behind the orchestrator's 409 guard, and it pins
// the conflict rule "a completed session is never overwritten".
//
// Profile deletion keeps a tombstone (conclusions emptied, deletedAt set) so
// old evidence can never auto-rebuild the profile, while reports and sessions
// are untouched.

import type { Session, StorageProvider } from './providers';
import type { UserProfile } from './lifecycle';
import { StorageUnavailableError } from './db/sql-executor';

/** Server-side storage contract, scoped by anonymous owner id (#21). */
export interface OwnedStorageProvider {
  saveSession(ownerId: string, session: Session): Promise<void>;
  loadSession(ownerId: string, id: string): Promise<Session | null>;
  listSessions(ownerId: string): Promise<Session[]>;
  deleteSession(ownerId: string, id: string): Promise<void>;
  /** The stored profile for this owner, or null when none was ever saved. */
  loadProfile(ownerId: string): Promise<UserProfile | null>;
  /**
   * Persist a profile. Returns the profile that is ACTUALLY stored after the
   * tombstone rule is applied, plus whether the write was blocked because a
   * deleted profile must not be auto-rebuilt.
   */
  saveProfile(
    ownerId: string,
    profile: UserProfile
  ): Promise<{ stored: UserProfile; blockedByTombstone: boolean }>;
}

/**
 * Shared completed-session write guard. Returns true when a session may be
 * written: a completed row is never overwritten (neither downgraded to
 * in-progress nor rewritten). Backends must apply this before (or atomically
 * during) every save.
 */
export function mayWriteSession(existing: Session | null): boolean {
  return !(existing !== null && existing.completed);
}

/**
 * Shared profile tombstone rule. A deleted profile (deletedAt != null) can
 * never be resurrected by an incoming active profile — old evidence must not
 * auto-rebuild it. Tombstone updates (deletedAt still set) and the deletion
 * write itself are allowed.
 */
export function applyProfileTombstoneRule(
  existing: UserProfile | null,
  incoming: UserProfile
): { stored: UserProfile; blockedByTombstone: boolean } {
  if (existing?.deletedAt != null && incoming.deletedAt == null) {
    return { stored: existing, blockedByTombstone: true };
  }
  return { stored: incoming, blockedByTombstone: false };
}

/**
 * In-memory owned storage. Process-lifetime only (baseline behavior of the
 * pre-#21 MemoryStorageProvider), but scoped per anonymous owner.
 */
export class MemoryOwnedStorageProvider implements OwnedStorageProvider {
  private sessions = new Map<string, Map<string, Session>>();
  private profiles = new Map<string, UserProfile>();

  async saveSession(ownerId: string, session: Session): Promise<void> {
    let ownerStore = this.sessions.get(ownerId);
    if (!ownerStore) {
      ownerStore = new Map<string, Session>();
      this.sessions.set(ownerId, ownerStore);
    }
    if (!mayWriteSession(ownerStore.get(session.id) ?? null)) return;
    ownerStore.set(session.id, { ...session });
  }

  async loadSession(ownerId: string, id: string): Promise<Session | null> {
    return this.sessions.get(ownerId)?.get(id) ?? null;
  }

  async listSessions(ownerId: string): Promise<Session[]> {
    return Array.from(this.sessions.get(ownerId)?.values() ?? []).sort(
      (a, b) => b.updatedAt - a.updatedAt
    );
  }

  async deleteSession(ownerId: string, id: string): Promise<void> {
    this.sessions.get(ownerId)?.delete(id);
  }

  async loadProfile(ownerId: string): Promise<UserProfile | null> {
    return this.profiles.get(ownerId) ?? null;
  }

  async saveProfile(
    ownerId: string,
    profile: UserProfile
  ): Promise<{ stored: UserProfile; blockedByTombstone: boolean }> {
    const result = applyProfileTombstoneRule(this.profiles.get(ownerId) ?? null, profile);
    this.profiles.set(ownerId, result.stored);
    return result;
  }
}

/**
 * A backend used when DATABASE_URL is configured but the database cannot be
 * reached (connection/migration failure). Every operation fails with an
 * explicit StorageUnavailableError so routes emit the honest degradation
 * signal — the system never silently pretends to have persisted anything.
 */
export class UnavailableOwnedStorageProvider implements OwnedStorageProvider {
  constructor(private readonly cause: unknown) {}

  private fail(): never {
    throw new StorageUnavailableError('Server storage unavailable', { cause: this.cause });
  }

  async saveSession(): Promise<void> {
    this.fail();
  }
  async loadSession(): Promise<Session | null> {
    this.fail();
  }
  async listSessions(): Promise<Session[]> {
    this.fail();
  }
  async deleteSession(): Promise<void> {
    this.fail();
  }
  async loadProfile(): Promise<UserProfile | null> {
    this.fail();
  }
  async saveProfile(): Promise<{ stored: UserProfile; blockedByTombstone: boolean }> {
    this.fail();
  }
}

/**
 * The per-owner view the API routes hand to callers (e.g. the interrogation
 * orchestrator, whose `storage` seam stays a plain StorageProvider). All
 * operations are pinned to one owner id — an owner cannot address another
 * owner's records through this view because the owner id is never a caller
 * parameter here.
 */
export interface OwnerStorageScope {
  readonly ownerId: string;
  readonly sessions: StorageProvider;
  loadProfile(): Promise<UserProfile | null>;
  saveProfile(profile: UserProfile): Promise<{ stored: UserProfile; blockedByTombstone: boolean }>;
}

export function scopeStorageByOwner(
  backend: OwnedStorageProvider,
  ownerId: string
): OwnerStorageScope {
  return {
    ownerId,
    sessions: {
      saveSession: (session) => backend.saveSession(ownerId, session),
      loadSession: (id) => backend.loadSession(ownerId, id),
      listSessions: () => backend.listSessions(ownerId),
      deleteSession: (id) => backend.deleteSession(ownerId, id),
    },
    loadProfile: () => backend.loadProfile(ownerId),
    saveProfile: (profile) => backend.saveProfile(ownerId, profile),
  };
}
