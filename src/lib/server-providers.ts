// Server-side deterministic providers and in-memory storage for ticket #2.
// These run only in Node.js API routes; no browser APIs.
// All data is locally generated; no external calls, no fabricated source provenance.

import type { Session, StorageProvider } from './providers';
import { FixtureRetrievalProvider, FixtureLLMProvider } from './fixture-providers';

export { FixtureRetrievalProvider, FixtureLLMProvider } from './fixture-providers';

export const retrievalProvider = new FixtureRetrievalProvider();
export const llmProvider = new FixtureLLMProvider();

// ---------------------------------------------------------------------------
// Server-side in-memory storage for API routes.
// Survives within a single Node.js process only.
// Production boundary is Neon PostgreSQL (PRD v4.0 deferred).
// ---------------------------------------------------------------------------

export class MemoryStorageProvider implements StorageProvider {
  private store = new Map<string, Session>();

  async saveSession(session: Session): Promise<void> {
    this.store.set(session.id, { ...session });
  }

  async loadSession(id: string): Promise<Session | null> {
    return this.store.get(id) ?? null;
  }

  async listSessions(): Promise<Session[]> {
    return Array.from(this.store.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async deleteSession(id: string): Promise<void> {
    this.store.delete(id);
  }
}

export const serverStorage = new MemoryStorageProvider();
