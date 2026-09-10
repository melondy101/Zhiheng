// Server-side deterministic providers and in-memory storage for ticket #2.
// These run only in Node.js API routes; no browser APIs.
// All data is locally generated; no external calls, no fabricated source provenance.

import type { LLMProvider, Session, StorageProvider } from './providers';
import { FixtureRetrievalProvider, FixtureLLMProvider } from './fixture-providers';
import { createLLMProviderFromEnv, createGraphLLMProviderFromEnv } from './openai-llm-provider';

export { FixtureRetrievalProvider, FixtureLLMProvider } from './fixture-providers';

export const retrievalProvider = new FixtureRetrievalProvider();

/**
 * The question generator used by the interrogation route (#20): the real
 * OpenAI-compatible provider when LLM_API_KEY and LLM_MODEL are configured in
 * the server environment; the deterministic fixture otherwise. Without a key
 * the behavior is unchanged from the pre-#20 fixture path — fixture output is
 * never labeled as a real model response, and usedFallback stays honest
 * because the fixture succeeds without degradation.
 */
export const llmProvider: LLMProvider = createLLMProviderFromEnv() ?? new FixtureLLMProvider();
export const graphLlmProvider: LLMProvider | null = createGraphLLMProviderFromEnv();

// ---------------------------------------------------------------------------
// Server-side in-memory storage.
// NOTE (#21): API routes no longer use a bare singleton — they use the
// ownership-aware server storage from ./server-storage (memory mode without
// DATABASE_URL, Neon PostgreSQL with it). MemoryStorageProvider remains as
// the baseline single-owner implementation for behavior-equivalence tests;
// the owned variant lives in ./owned-storage.
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
