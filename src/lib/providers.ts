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
  /**
   * True when this user input was recorded while the user was uncertain
   * (#17). Uncertain inputs stay traceable in the conversation but never
   * advance the interrogation round.
   */
  uncertain?: boolean;
}

/**
 * A user message that counts as a completed interrogation round (#17).
 * Uncertain inputs (`uncertain: true`) are preserved in the conversation but
 * do not advance the round, so every round derivation must use this predicate
 * instead of counting all user messages.
 */
export function isRoundAnswer(m: Message): boolean {
  return m.role === 'user' && m.uncertain !== true;
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

/**
 * A report citation selected for display next to an interrogation question
 * (#16). `source` is always the exact Source object stored in
 * `Report.citations` — never a re-created or fabricated one.
 */
export interface CitedSource {
  /** 1-based citation number in Report.citations. */
  index: number;
  source: Source;
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
  /**
   * True while the explicit 继续/结束 decision after the third consecutive
   * uncertain answer is pending (#17). The session never auto-completes;
   * the user must choose.
   */
  pendingDecision?: boolean;
}

/** Actions accepted by the interrogation orchestration API (#15, #17). */
export type InterrogateAction = 'start' | 'answer' | 'continue' | 'complete';

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
  /**
   * Report evidence relevant to the current question (#16): the first few
   * citation-numbered sources of the session report that carry a usable URL,
   * in ascending citation order. Empty when no report citations exist — the
   * UI must then say so instead of rendering fabricated links.
   */
  sources: CitedSource[];
  /** True when three consecutive uncertain answers suggest ending (#10). */
  suggestComplete: boolean;
  /**
   * True while the explicit 继续/结束 decision after the third consecutive
   * uncertain answer is pending (#17). While set, the client must render the
   * choice UI and must never complete the session automatically.
   */
  decisionPending: boolean;
  completed: boolean;
  /** The full updated session; the client mirrors it into local storage. */
  session: Session;
  /**
   * Server storage disclosure (#21): 'memory' = no DATABASE_URL configured
   * (process-lifetime storage), 'postgres' = persisted in Neon PostgreSQL,
   * 'unavailable' = the configured database could not be reached and nothing
   * was persisted remotely — the client must rely on its local mirror.
   */
  storage?: 'memory' | 'postgres' | 'unavailable';
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
