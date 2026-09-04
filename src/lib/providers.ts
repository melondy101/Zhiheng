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
   * #26/T3: optimistic message status.
   * - 'sent': confirmed by server (default for existing messages).
   * - 'pending': client-side optimistic insert awaiting server confirmation.
   * - 'failed': server rejected; the user can click to retry.
   */
  status?: 'sent' | 'pending' | 'failed';
  /**
   * True when this user input was recorded while the user was uncertain
   * (#17). Uncertain inputs stay traceable in the conversation but never
   * advance the interrogation round.
   */
  uncertain?: boolean;
  /**
   * #5: the classified intent for this user message. 'question' means the
   * user was asking the AI something; 'response' means they were answering
   * or expressing a viewpoint. Absent on legacy messages.
   */
  intent?: 'question' | 'response';
}

/**
 * User intent classification for PRD v4.2 §5.
 */
export type UserIntent = 'question' | 'response';

/**
 * A user message that counts as a completed interrogation round (#17).
 * Uncertain inputs (`uncertain: true`) are preserved in the conversation but
 * do not advance the round, so every round derivation must use this predicate
 * instead of counting all user messages.
 */
export function isRoundAnswer(m: Message): boolean {
  return m.role === 'user' && m.uncertain !== true;
}

/**
 * User intent classification for PRD v4.2 §5.
 */
export type UserIntent = 'question' | 'response';

export interface Viewpoint {
  id: string;
  text: string;
  source: 'user_authored' | 'ai_suggested_and_selected' | 'ai_authored';
  /** If selected, when it was selected (timestamp). */
  selectedAt?: number;
}

/**
 * One piece of support for a viewpoint (PRD v4.2 §3.2). `citationIds` are
 * 1-based keys into `Report.citations` — a viewer can always trace an
 * evidence item back to the material it came from.
 */
export interface ReportEvidence {
  summary: string;
  citationIds: number[];
}

/**
 * A discussable position on the question (PRD v4.2 §3.2). `conclusion` is a
 * claim, never a source title and never a lift from an excerpt.
 */
export interface ReportViewpoint {
  id: string;
  conclusion: string;
  evidence: ReportEvidence[];
}

/**
 * The structured multiple-viewpoint synthesis (PRD v4.2 §3.2). `summary`
 * compares the viewpoints — support, applicable conditions and real-world
 * feasibility — instead of declaring one winner.
 */
export interface ReportSynthesis {
  summary: string;
  viewpoints: ReportViewpoint[];
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
  /**
   * Multiple viewpoints with per-viewpoint evidence (PRD v4.2 §3). Optional:
   * reports generated before this field existed must still render (§3.3).
   */
  synthesis?: ReportSynthesis;
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
  /**
   * Persisted retrieval source state (#24). Records the live/cache/demo
   * provenance of the report's Zhihu and Web sources at the time the report
   * was generated, including cache updatedAt timestamps from the provider.
   *
   * Absent on legacy sessions (predating #24). The UI must display
   * "未披露/未知" — never auto-fill demo. Use resolveReportSourceState()
   * from session-source-state.ts for the side-key fallback rules.
   */
  reportSourceState?: {
    zhihu: SourceState;
    web: SourceState;
    zhihuUpdatedAt?: number;
    webUpdatedAt?: number;
    zhihuStale?: boolean;
    webStale?: boolean;
  };
}

/**
 * Persisted interrogation state (#15). One authority: the orchestration API
 * computes and stores it; `round` is the round whose question is pending
 * (0 = not started), `pendingCheckpoint` marks a checkpoint decision awaiting
 * the user, and `assistantQuestion` is the current pending question text.
 *
 * #5 gentle: `directiveRound` tracks completed directive (strategy-directed)
 * rounds; `lastIntent` records the intent of the most recent user input.
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
  /**
   * #5: number of completed directive (strategy-directed, substantive) rounds.
   * This is the counter that drives the three-round summary gate.
   * Incremented only when the user provides a substantive response (not a
   * question, not a non-substantive input).
   */
  directiveRound?: number;
  /**
   * #5: the classified intent of the most recent user input. Used to
   * determine whether the next AI turn should answer directly or ask a
   * strategy question.
   */
  lastIntent?: 'question' | 'response';
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
  /**
   * #5: AI direct answer text for the most recent user input. Present when
   * the user asked a question; null when the user was responding.
   */
  aiReply?: string | null;
  /**
   * #5: follow-up question or gentle encouragement text. Present when the
   * user should see a next prompt; null when the summary gate is being shown.
   */
  followUp?: string | null;
  /**
   * #5: number of completed directive (strategy-directed, substantive) rounds.
   * Drives the three-round summary gate.
   */
  directiveRound?: number;
  /**
   * #5: true when the summary gate should be shown (after every 3rd directive
   * round). The UI renders 继续聊 / 生成总结 when this is true.
   */
  suggestSummary?: boolean;
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
  /**
   * PRD v4.2 §3: produce a structured multiple-viewpoint synthesis (summary +
   * viewpoints) for a finished report. Optional because the fixture LLM
   * provider declines to synthesize — returning null falls back to the
   * deterministic material-based synthesis in the builder.
   *
   * The payload uses `SynthesisSource` (carrying a 1-based citationId) so the
   * model can never reference a citation that does not exist in the report.
   */
  generateSynthesis?(args: {
    question: string;
    sources: import('./report-synthesis').SynthesisSource[];
    historySources?: import('./report-synthesis').SynthesisSource[];
  }): Promise<ReportSynthesis | null>;
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
