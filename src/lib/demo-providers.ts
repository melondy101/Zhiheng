// Client-side deterministic providers and localStorage storage for ticket #2.
// These run only in the browser; do not import in server-side code.

import type { StorageProvider, RenderingProvider, Report, Session, ResultCard } from './providers';
import { buildSimpleResultCard } from './result-card-builder';

// ---------------------------------------------------------------------------
// Browser Storage Provider (localStorage adapter)
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'zhiyan_sessions';

export class BrowserStorageProvider implements StorageProvider {
  lsKey(id: string): string {
    return `${STORAGE_KEY}:${id}`;
  }

  async saveSession(session: Session): Promise<void> {
    try {
      localStorage.setItem(this.lsKey(session.id), JSON.stringify(session));
    } catch { /* quota exceeded — silent */ }
  }

  async loadSession(id: string): Promise<Session | null> {
    try {
      const raw = localStorage.getItem(this.lsKey(id));
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  async listSessions(): Promise<Session[]> {
    const sessions: Session[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(STORAGE_KEY)) {
          const raw = localStorage.getItem(key);
          if (raw) sessions.push(JSON.parse(raw));
        }
      }
    } catch { /* ignore parse errors */ }
    return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async deleteSession(id: string): Promise<void> {
    localStorage.removeItem(this.lsKey(id));
  }
}

export const clientStorage = new BrowserStorageProvider();

// ---------------------------------------------------------------------------
// Static Rendering Providers (client-side)
// ---------------------------------------------------------------------------

export class StaticReportRenderer implements RenderingProvider {
  async renderReport(report: Report): Promise<Report> {
    return structuredClone(report);
  }

  async renderResultCard(card: ResultCard): Promise<ResultCard> {
    return structuredClone(card);
  }
}

export const reportRenderer = new StaticReportRenderer();
export const resultCardRenderer = new StaticReportRenderer();

// ---------------------------------------------------------------------------
// Result card builder
// ---------------------------------------------------------------------------

export function buildResultCard(session: Session): ResultCard {
  // #17: the simple card shape now lives in the pure result-card-builder
  // module so the server-side complete action can build it too.
  return buildSimpleResultCard(session);
}
