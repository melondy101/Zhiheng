// Provider contracts for ticket #2 minimal persistent reasoning loop

export interface Question {
  id: string;
  text: string;
  timestamp: number;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  strategyId?: string;
  timestamp: number;
}

export interface Viewpoint {
  id: string;
  text: string;
  source: 'user_authored' | 'ai_suggested_user_selected' | 'ai_authored';
}

export interface Report {
  question: string;
  title: string;
  knowledgePoints: string[];
  content: string;
  viewpoints: string[];
  references: Reference[];
  graph: GraphData;
}

export interface Reference {
  id: number;
  category: 'zhihu' | 'web' | 'historical_report' | 'ai_synthesis';
  title: string;
  url?: string;
}

export interface GraphNode {
  id: string;
  label: string;
  type: 'concept' | 'evidence' | 'counter' | 'inferred' | 'user';
}

export interface GraphEdge {
  from: string;
  to: string;
  label: string;
  sourceType: 'supported' | 'inferred' | 'user_claimed';
  citationId?: number;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface Session {
  id: string;
  question: string;
  report: Report | null;
  initialOpinion: string | null;
  selectedViewpoint: Viewpoint | null;
  messages: Message[];
  resultCard: ResultCard | null;
  completed: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ResultCard {
  sessionId: string;
  initialStance: { text: string; source: 'user_authored' } | null;
  selectedStartingStance: { text: string; source: 'ai_suggested_user_selected' } | null;
  evidence: string[];
  revisions: Array<{ before: string; after: string }>;
  finalPosition: string | null;
  unresolved: string[];
  messageIds: string[];
}

export interface Identity {
  type: 'anonymous';
  id: string;
}

export interface LLMResponse {
  question: string;
  strategyId: string;
  strategyName: string;
  citations: number[];
}

// Provider interfaces

export interface RetrievalProvider {
  getHotList(): Promise<{ items: Array<{ id: number; title: string; url: string }>; updatedAt: string; source: string }>;
  search(query: string): Promise<{ query: string; results: Array<{ id: number; title: string; snippet: string; source: string; url: string }> }>;
  generateReport(question: string): Promise<Report>;
}

export interface LLMProvider {
  generateQuestion(session: Session): Promise<LLMResponse>;
}

export interface StorageProvider {
  saveSession(session: Session): Promise<void>;
  loadSession(id: string): Promise<Session | null>;
  listSessions(): Promise<Session[]>;
  deleteSession(id: string): Promise<void>;
}

export interface RenderingProvider {
  renderReport(report: Report): Promise<string>;
  renderResultCard(card: ResultCard): Promise<string>;
}

export interface IdentityProvider {
  getCurrentIdentity(): Promise<Identity>;
}
