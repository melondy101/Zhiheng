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
  source: 'user_authored' | 'ai_suggested_and_selected' | 'ai_authored';
  /** If selected, when it was selected (timestamp). */
  selectedAt?: number;
}

export interface Report {
  question: string;
  title: string;
  knowledgePoints: string[];
  content: string;
  /** Plain-text viewpoints (legacy, used by #2/#3) */
  viewpoints: string[];
  /** Structured viewpoints with provenance (used by #8) */
  structuredViewpoints?: Viewpoint[];
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
  /**
   * Server-owned interrogation state (#15). The orchestration API is the only
   * writer; the client mirrors it into local storage as the refresh/reload
   * recovery source.
   */
  interrogation?: InterrogationState;
}

/**
 * Persisted interrogation state (#15). One authority: the orchestration API
 * computes and stores it; `round` is the round whose question is pending
 * (0 = not started), `pendingCheckpoint` marks a checkpoint decision awaiting
 * the user, and `assistantQuestion` is the current pending question text.
 */
export interface InterrogationState {
  round: number;
  strategy: import('./strategy-engine').StrategyId | null;
  assistantQuestion: string | null;
  usedFallback: boolean;
  pendingCheckpoint: boolean;
  uncertainStreak: number;
}

/** Actions accepted by the interrogation orchestration API (#15). */
export type InterrogateAction = 'start' | 'answer' | 'continue';

/** Uncertain-answer hint returned by the orchestration API (#10 semantics). */
export interface InterrogateHint {
  message: string;
  hint?: string[];
}

/** Response body of POST /api/interrogate (#15). */
export interface InterrogateResponseBody {
  round: number;
  strategy: import('./strategy-engine').StrategyId | null;
  /** Current pending assistant question; null while a checkpoint is pending. */
  question: string | null;
  /** True while the checkpoint decision (继续/结束) is pending. */
  checkpoint: boolean;
  usedFallback: boolean;
  uncertainStreak: number;
  hint: InterrogateHint | null;
  /** True when three consecutive uncertain answers suggest ending (#10). */
  suggestComplete: boolean;
  completed: boolean;
  /** The full updated session; the client mirrors it into local storage. */
  session: Session;
}

export interface ResultCard {
  sessionId: string;
  initialStance: { text: string; source: 'user_authored' } | null;
  selectedStartingStance: { text: string; source: 'user_authored' | 'ai_suggested_and_selected' | 'ai_authored' } | null;
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
  /**
   * Strategy-aware question generation. Since #15 the LLM only fills in the
   * question text for a strategy chosen by the orchestration API; the old
   * session-level one-round `generateQuestion` contract is removed.
   */
  generateStrategyQuestion(
    strategy: import('./strategy-engine').StrategyId,
    session: Session
  ): Promise<string>;
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
