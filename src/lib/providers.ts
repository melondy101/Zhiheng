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
  strategy?: import('./strategy-engine').StrategyId;
  round?: number;
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

/** The structured multiple-viewpoint synthesis (PRD v4.2 §3.2).
 *
 * The report deliberately has no separate final verdict. Each viewpoint owns
 * its directly supporting material, so readers can assess the evidence rather
 * than being handed an uncited overall conclusion.
 */
export interface ReportSynthesis {
  /** Older stored reports may carry this field. New reports do not generate or render it. */
  summary?: string;
  viewpoints: ReportViewpoint[];
}

export interface Report {
  question: string;
  title: string;
  subtitle?: string;
  originalQuestion?: string;
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
  type: 'zhihu' | 'web' | 'ai_synthesis' | 'personal_history' | 'knowledge_base';
  author: string | null;
  title: string | null;
  url: string | null;
  excerpt: string | null;
  /** Present when type=personal_history */
  sourceSessionId?: string;
  /** Present when type=personal_history */
  provenance?: string;
  /** Present when type=knowledge_base */
  category?: string;
  topic?: string;
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
  | 'kb_search'
  | 'synthesizing'
  | 'building_graph'
  | 'complete';

export type SourceState = 'live' | 'cache' | 'demo' | 'unavailable';

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
  subtitle?: string;
  originalQuestion?: string;
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
   * Strategies already presented in this session, in order. This is persisted
   * state used by the rotation algorithm; legacy sessions may omit it and are
   * treated as having no recorded history.
   */
  strategyHistory?: import('./strategy-engine').StrategyId[];
  /** Current session-level questioning pressure; omitted legacy sessions start gentle. */
  questioningIntensity?: import('./engagement-signal').QuestioningIntensity;
  /** Conservative adaptations applied to questioning pressure; never a user score. */
  interrogationIntensityLog?: Array<{
    round: number;
    from: import('./strategy-engine').StrategyId;
    to: import('./strategy-engine').StrategyId;
    mode: import('./engagement-signal').AdaptiveQuestionMode;
    reasons: string[];
  }>;
  /** #Q-01 / #D-03: Session mode ('quick' | 'deep' | 'fun' | 'story'). */
  mode?: import('./mode-config').SessionMode;
  /** #Q-01 / #Q-02: Interrogation phase ('orientation' | 'transitionChoice' | 'interrogation' | 'completed'). */
  phase?: import('./mode-config').SessionPhase;
  /** #Q-02: Quick target for targeted orientation ('clarify_position' | 'weigh_decision' | 'refine_expression'). */
  target?: import('./mode-config').QuickTargetId | null;
  /** #Q-01: Number of orientation dialogue rounds completed. */
  orientationRounds?: number;
  /** #Q-02: Selected transition choice. */
  transitionChoice?: import('./mode-config').TransitionActionId | null;
  /** #D-03: Recorded cognitive trajectory events. */
  cognitiveTrajectory?: import('./cognitive-trajectory').CognitiveTrajectoryEvent[];
  /** #F-01: Selected character for fun mode ('relaxed_friend' | 'ancient_scholar' | 'anime_partner'). */
  character?: import('./character').CharacterId | null;
  /** #G-01: Active StoryRun for GalGame interactive story mode. */
  storyRun?: import('./story-run').StoryRun | null;
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
  /** Why the last question used a template; absent for old sessions and non-fallbacks. */
  fallbackReason?: import('./llm-fallback').LLMFailureReason;
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
  mode?: import('./mode-config').SessionMode;
  phase?: import('./mode-config').SessionPhase;
  target?: import('./mode-config').QuickTargetId | null;
  orientationRounds?: number;
  transitionChoice?: import('./mode-config').TransitionActionId | null;
  character?: import('./character').CharacterId | null;
  storyRun?: import('./story-run').StoryRun | null;
  /** How the current question was adapted, if at all. */
  adaptiveMode?: import('./engagement-signal').AdaptiveQuestionMode;
  questioningIntensity?: import('./engagement-signal').QuestioningIntensity;
}

/** Actions accepted by the interrogation orchestration API (#15, #17, #Q-02). */
export type InterrogateAction =
  | 'start'
  | 'answer'
  | 'continue'
  | 'complete'
  | 'transition'
  | 'set_target'
  | 'story_choice'
  | 'story_end_early'
  | 'story_complete'
  | 'story_bridge';

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
  fallbackReason?: import('./llm-fallback').LLMFailureReason;
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
  /** #Q-01 / #D-03: Current active session mode. */
  mode?: import('./mode-config').SessionMode;
  /** #Q-01 / #Q-02: Current interrogation phase. */
  phase?: import('./mode-config').SessionPhase;
  /** #Q-02: Quick target for targeted orientation. */
  target?: import('./mode-config').QuickTargetId | null;
  /** #Q-01: Orientation rounds completed. */
  orientationRounds?: number;
  /** #Q-02: Available transition action cards if in transitionChoice phase. */
  transitionActions?: import('./mode-config').TransitionAction[];
  /** #D-03: Cognitive trajectory events. */
  cognitiveTrajectory?: import('./cognitive-trajectory').CognitiveTrajectoryEvent[];
  /** #F-01: Character in fun mode. */
  character?: import('./character').CharacterId | null;
  /** #G-01: StoryRun in story mode. */
  storyRun?: import('./story-run').StoryRun | null;
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
   * PRD v4.2 §3: produce a structured multiple-viewpoint synthesis (core
   * viewpoints with evidence) for a finished report. Optional because the fixture LLM
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
  /**
   * Produce a structured knowledge graph (entities and logical relations) for a finished report.
   * Optional: returns null to fall back to the deterministic graph builder.
   */
  generateKnowledgeGraph?(args: {
    report: Report;
    sources: Source[];
  }): Promise<import('./knowledge-graph').KnowledgeGraph | null>;
  /**
   * Rewrite a question into a deep inquiry question and generate a punchy subtitle.
   * Optional: returns null to fall back to the deterministic heuristic rewriter.
   */
  generateQuestionRewrite?(question: string): Promise<import('./question-rewriter').QuestionRewriteResult | null>;
  /** Alias for generateSynthesis for backward compatibility in tests. */
  generateReportSynthesis?(args: {
    question: string;
    sources: import('./report-synthesis').SynthesisSource[];
    historySources?: import('./report-synthesis').SynthesisSource[];
  }): Promise<ReportSynthesis | null>;
  /** Generic completion helper for custom prompt messages. */
  generateCustomCompletion?(
    messages: Array<{ role: string; content: string }>,
    timeoutMs?: number
  ): Promise<string | null>;
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
