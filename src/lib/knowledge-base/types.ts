// Types and interfaces for Zhiyan Knowledge Base (M2: Philosophy, Debate, Logic, Domain).

export type KnowledgeBaseCategory = 'philosophy' | 'debate' | 'logic' | 'domain';

export interface KnowledgeBaseItem {
  id: string;
  category: KnowledgeBaseCategory;
  topic: string;
  title: string;
  summary: string;
  content: string;
  tags: string[];
  suggestedQuestions: string[];
  fallaciesIdentified?: string[];
  argumentPatterns?: string[];
  /** Optional pre-computed 1536-dimensional or reduced-dimensional embedding vector */
  embedding?: number[];
}

export interface KnowledgeBaseSearchResult {
  item: KnowledgeBaseItem;
  score: number;
  matchType: 'vector' | 'keyword' | 'category';
}

export interface KnowledgeBaseSearchOptions {
  category?: KnowledgeBaseCategory;
  limit?: number;
  minScore?: number;
  tags?: string[];
}

export interface KnowledgeBaseProvider {
  search(query: string, options?: KnowledgeBaseSearchOptions): Promise<KnowledgeBaseSearchResult[]>;
  getItem(id: string): Promise<KnowledgeBaseItem | null>;
  listByCategory(category: KnowledgeBaseCategory): Promise<KnowledgeBaseItem[]>;
  listAll(): Promise<KnowledgeBaseItem[]>;
}
