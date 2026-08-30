// Shared provider interfaces and deterministic fixture data for ticket #2
// This file has no side effects and no browser/server-specific code.

export interface Question {
  id: string;
  text: string;
  timestamp: number;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
}

export interface Viewpoint {
  id: string;
  text: string;
  source: 'user_authored' | 'ai_authored';
}

export interface Report {
  question: string;
  title: string;
  knowledgePoints: string[];
  content: string;
  viewpoints: string[];
  references: Source[];
  citations: Record<number, Source>;
}

// Source interface — a cited origin for a claim in the report.
// Every field may be null when the origin lacks that information.
// Null ≠ fabricated — missing fields are left blank, never invented.
export interface Source {
  id: string;
  type: 'zhihu' | 'web' | 'ai_synthesis' | 'personal_history';
  author: string | null;
  title: string | null;
  url: string | null;
  excerpt: string | null;
  /** Present when type=personal_history */
  sourceSessionId?: string;
  /** Present when type=personal_history */
  provenance?: string;
}

// Progress event emitted by a RetrievalProvider while building a report.
export type ReportProgressStage =
  | 'zhihu_search'
  | 'web_search'
  | 'history_search'
  | 'synthesizing'
  | 'building_graph'
  | 'complete';

export type SourceState = 'live' | 'cache' | 'demo';

export interface ReportProgress {
  stage: ReportProgressStage;
  message: string;
  timestamp: number;
  zhihuSourceState?: SourceState;
  webSourceState?: SourceState;
}

export interface Session {
  id: string;
  question: string;
  initialOpinion: string | null;
  report: Report | null;
  knowledgeGraph?: import('./knowledge-graph').KnowledgeGraph | null;
  selectedViewpoint: Viewpoint | null;
  messages: Message[];
  resultCard: ResultCard | null;
  completed: boolean;
  createdAt: number;
  updatedAt: number;
  /** Session IDs to exclude from history search results */
  excludedHistoryIds?: string[];
}

export interface ResultCard {
  sessionId: string;
  initialStance: { text: string; source: 'user_authored' } | null;
  selectedStartingStance: { text: string; source: 'user_authored' | 'ai_authored' } | null;
  finalPosition: string | null;
  messageIds: string[];
}

export interface Identity {
  type: 'anonymous';
  id: string;
}

// Provider interfaces
export interface RetrievalProvider {
  /**
   * Generate a research report for the given question.
   * @param onProgress Optional callback for progress updates during generation.
   *   Called at least once with stage 'complete' even on error.
   */
  generateReport(
    question: string,
    onProgress?: (progress: ReportProgress) => void
  ): Promise<Report>;
}

export interface LLMProvider {
  generateQuestion(session: Session): Promise<string>;
}

export interface StorageProvider {
  saveSession(session: Session): Promise<void>;
  loadSession(id: string): Promise<Session | null>;
  listSessions(): Promise<Session[]>;
  deleteSession(id: string): Promise<void>;
}

export interface RenderingProvider {
  renderReport(report: Report): Promise<Report>;
  renderResultCard(card: ResultCard): Promise<ResultCard>;
}

export interface IdentityProvider {
  getCurrentIdentity(): Promise<Identity>;
}

// ---------------------------------------------------------------------------
// Fixture data (shared between client and server providers)
// ---------------------------------------------------------------------------

export const FIXTURE_QUESTION = '你能提供一个具体的数据或例子来支持这个观点吗？';
