// Knowledge Base Provider implementations for Zhiyan M2.
// Includes InMemory deterministic semantic/keyword provider and PgVector provider.

import type {
  KnowledgeBaseCategory,
  KnowledgeBaseItem,
  KnowledgeBaseProvider,
  KnowledgeBaseSearchOptions,
  KnowledgeBaseSearchResult,
} from './types';
import { KNOWLEDGE_BASE_ITEMS } from './data';
import { type SqlExecutor, normalizeJsonColumn } from '../db/sql-executor';

/**
 * Tokenize string into lowercase character n-grams and alphanumeric tokens for Chinese/English text search.
 */
function tokenize(text: string): string[] {
  if (!text) return [];
  const normalized = text.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, ' ').trim();
  const words = normalized.split(/\s+/).filter(Boolean);
  const tokens: string[] = [];

  for (const word of words) {
    if (word.length <= 1) {
      tokens.push(word);
      continue;
    }
    // For alphanumeric English/numbers
    if (/^[a-z0-9]+$/i.test(word)) {
      tokens.push(word);
    } else {
      // For Chinese / CJK characters: add full word and 2-character / 3-character n-grams
      tokens.push(word);
      for (let i = 0; i < word.length - 1; i++) {
        tokens.push(word.slice(i, i + 2));
      }
      for (let i = 0; i < word.length - 2; i++) {
        tokens.push(word.slice(i, i + 3));
      }
    }
  }

  return tokens;
}

/** Compute cosine similarity between two vectors */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * In-memory deterministic knowledge base provider.
 * Works completely offline without external credentials or network access.
 */
export class InMemoryKnowledgeBaseProvider implements KnowledgeBaseProvider {
  private items: KnowledgeBaseItem[];

  constructor(customItems: KnowledgeBaseItem[] = [...KNOWLEDGE_BASE_ITEMS]) {
    this.items = customItems;
  }

  async search(query: string, options: KnowledgeBaseSearchOptions = {}): Promise<KnowledgeBaseSearchResult[]> {
    const { category, limit = 5, minScore = 0.05, tags } = options;
    const queryTokens = new Set(tokenize(query));

    let candidates = this.items;
    if (category) {
      candidates = candidates.filter(item => item.category === category);
    }
    if (tags && tags.length > 0) {
      const tagSet = new Set(tags.map(t => t.toLowerCase()));
      candidates = candidates.filter(item => item.tags.some(t => tagSet.has(t.toLowerCase())));
    }

    if (queryTokens.size === 0) {
      return candidates.slice(0, limit).map(item => ({
        item,
        score: 0.1,
        matchType: 'category',
      }));
    }

    const scored: KnowledgeBaseSearchResult[] = [];

    for (const item of candidates) {
      let score = 0;
      let matchedTokens = 0;

      // Check title tokens (highest weight)
      const titleTokens = tokenize(item.title);
      for (const t of titleTokens) {
        if (queryTokens.has(t)) {
          score += 0.35;
          matchedTokens++;
        }
      }

      // Check topic and tags tokens (high weight)
      const topicTokens = tokenize(item.topic);
      for (const t of topicTokens) {
        if (queryTokens.has(t)) {
          score += 0.25;
          matchedTokens++;
        }
      }

      for (const tag of item.tags) {
        const tagTokens = tokenize(tag);
        for (const t of tagTokens) {
          if (queryTokens.has(t)) {
            score += 0.2;
            matchedTokens++;
          }
        }
      }

      // Check fallacies and argument patterns
      if (item.fallaciesIdentified) {
        for (const f of item.fallaciesIdentified) {
          const fTokens = tokenize(f);
          for (const t of fTokens) {
            if (queryTokens.has(t)) {
              score += 0.25;
              matchedTokens++;
            }
          }
        }
      }

      if (item.argumentPatterns) {
        for (const p of item.argumentPatterns) {
          const pTokens = tokenize(p);
          for (const t of pTokens) {
            if (queryTokens.has(t)) {
              score += 0.15;
              matchedTokens++;
            }
          }
        }
      }

      // Check summary and content
      const summaryTokens = tokenize(item.summary);
      for (const t of summaryTokens) {
        if (queryTokens.has(t)) {
          score += 0.08;
          matchedTokens++;
        }
      }

      const contentTokens = tokenize(item.content);
      for (const t of contentTokens) {
        if (queryTokens.has(t)) {
          score += 0.03;
          matchedTokens++;
        }
      }

      // Direct string inclusion bonus
      const qLower = query.toLowerCase();
      if (item.title.toLowerCase().includes(qLower)) score += 0.4;
      if (item.topic.toLowerCase().includes(qLower)) score += 0.3;
      if (item.tags.some(t => t.toLowerCase().includes(qLower) || qLower.includes(t.toLowerCase()))) score += 0.25;
      if (item.fallaciesIdentified?.some(f => f.toLowerCase().includes(qLower) || qLower.includes(f.toLowerCase()))) score += 0.35;

      // Normalization
      const normalizedScore = Math.min(1, score / (1 + score));

      if (normalizedScore >= minScore) {
        scored.push({
          item,
          score: normalizedScore,
          matchType: 'keyword',
        });
      }
    }

    scored.sort((a, b) => b.score - a.score);

    // If no keyword matches were found, fallback to top category matches
    if (scored.length === 0 && candidates.length > 0) {
      return candidates.slice(0, Math.min(limit, 3)).map(item => ({
        item,
        score: 0.1,
        matchType: 'category',
      }));
    }

    return scored.slice(0, limit);
  }

  async getItem(id: string): Promise<KnowledgeBaseItem | null> {
    return this.items.find(item => item.id === id) ?? null;
  }

  async listByCategory(category: KnowledgeBaseCategory): Promise<KnowledgeBaseItem[]> {
    return this.items.filter(item => item.category === category);
  }

  async listAll(): Promise<KnowledgeBaseItem[]> {
    return [...this.items];
  }
}

/**
 * Neon PostgreSQL + pgvector knowledge base provider.
 * Gracefully degrades to InMemoryKnowledgeBaseProvider if database or pgvector is unavailable.
 */
export class PgVectorKnowledgeBaseProvider implements KnowledgeBaseProvider {
  private fallback: InMemoryKnowledgeBaseProvider;
  private executor: SqlExecutor | null;

  constructor(executor: SqlExecutor | null = null, fallbackItems: KnowledgeBaseItem[] = [...KNOWLEDGE_BASE_ITEMS]) {
    this.executor = executor;
    this.fallback = new InMemoryKnowledgeBaseProvider(fallbackItems);
  }

  async search(query: string, options: KnowledgeBaseSearchOptions = {}): Promise<KnowledgeBaseSearchResult[]> {
    if (!this.executor) {
      return this.fallback.search(query, options);
    }

    try {
      // Check if table exists
      const { category, limit = 5, minScore = 0.05 } = options;
      let sql = `
        SELECT id, category, topic, title, summary, content, tags, suggested_questions, fallacies_identified, argument_patterns
        FROM zhiyan_knowledge_base
      `;
      const params: unknown[] = [];
      const whereClauses: string[] = [];

      if (category) {
        params.push(category);
        whereClauses.push(`category = $${params.length}`);
      }

      if (whereClauses.length > 0) {
        sql += ` WHERE ${whereClauses.join(' AND ')}`;
      }

      sql += ` LIMIT 50`;

      const result = await this.executor.query(sql, params);
      const rows = (result?.rows ?? []) as Record<string, unknown>[];
      if (rows.length === 0) {
        return this.fallback.search(query, options);
      }

      // Map rows to KnowledgeBaseItem and score via in-memory matching
      const items: KnowledgeBaseItem[] = rows.map(r => {
        const tags = normalizeJsonColumn<string[]>(r.tags) ?? (Array.isArray(r.tags) ? (r.tags as string[]) : []);
        const questions = normalizeJsonColumn<string[]>(r.suggested_questions) ?? (Array.isArray(r.suggested_questions) ? (r.suggested_questions as string[]) : []);
        const fallacies = normalizeJsonColumn<string[]>(r.fallacies_identified) ?? (Array.isArray(r.fallacies_identified) ? (r.fallacies_identified as string[]) : undefined);
        const patterns = normalizeJsonColumn<string[]>(r.argument_patterns) ?? (Array.isArray(r.argument_patterns) ? (r.argument_patterns as string[]) : undefined);

        return {
          id: String(r.id),
          category: r.category as KnowledgeBaseCategory,
          topic: String(r.topic),
          title: String(r.title),
          summary: String(r.summary),
          content: String(r.content),
          tags,
          suggestedQuestions: questions,
          fallaciesIdentified: fallacies,
          argumentPatterns: patterns,
        };
      });

      const provider = new InMemoryKnowledgeBaseProvider(items);
      return provider.search(query, { category, limit, minScore, tags: options.tags });
    } catch (err) {
      // Degrade gracefully on any database or pgvector query failure
      console.warn('[PgVectorKnowledgeBaseProvider] Falling back to in-memory search:', err);
      return this.fallback.search(query, options);
    }
  }

  async getItem(id: string): Promise<KnowledgeBaseItem | null> {
    if (!this.executor) {
      return this.fallback.getItem(id);
    }
    try {
      const result = await this.executor.query(
        'SELECT id, category, topic, title, summary, content, tags, suggested_questions, fallacies_identified, argument_patterns FROM zhiyan_knowledge_base WHERE id = $1 LIMIT 1',
        [id]
      );
      const rows = (result?.rows ?? []) as Record<string, unknown>[];
      if (rows.length > 0) {
        const r = rows[0];
        const tags = normalizeJsonColumn<string[]>(r.tags) ?? (Array.isArray(r.tags) ? (r.tags as string[]) : []);
        const questions = normalizeJsonColumn<string[]>(r.suggested_questions) ?? (Array.isArray(r.suggested_questions) ? (r.suggested_questions as string[]) : []);
        const fallacies = normalizeJsonColumn<string[]>(r.fallacies_identified) ?? (Array.isArray(r.fallacies_identified) ? (r.fallacies_identified as string[]) : undefined);
        const patterns = normalizeJsonColumn<string[]>(r.argument_patterns) ?? (Array.isArray(r.argument_patterns) ? (r.argument_patterns as string[]) : undefined);

        return {
          id: String(r.id),
          category: r.category as KnowledgeBaseCategory,
          topic: String(r.topic),
          title: String(r.title),
          summary: String(r.summary),
          content: String(r.content),
          tags,
          suggestedQuestions: questions,
          fallaciesIdentified: fallacies,
          argumentPatterns: patterns,
        };
      }
      return null;
    } catch {
      return this.fallback.getItem(id);
    }
  }

  async listByCategory(category: KnowledgeBaseCategory): Promise<KnowledgeBaseItem[]> {
    return this.fallback.listByCategory(category);
  }

  async listAll(): Promise<KnowledgeBaseItem[]> {
    return this.fallback.listAll();
  }
}

/**
 * Strategy-to-KnowledgeBase mapping for enhancing interrogation strategies with curated frameworks.
 */
export const STRATEGY_TO_KB_ITEM_ID: Record<string, string> = {
  M1_evidence: 'debate-burden-of-proof',
  M2_premise: 'philo-socratic-elenchus',
  M3_anchoring: 'logic-confirmation-bias',
  M4_steelman: 'debate-steelmanning',
  M5_system2: 'domain-unintended-consequences',
  M6_reversal: 'philo-rawls-veil',
  M7_metacognition: 'philo-cartesian-doubt',
  M8_contradiction: 'philo-hegel-dialectic',
  M5_restate: 'debate-toulmin-model',
};

export function getKnowledgeBaseItemForStrategy(strategyId: string): KnowledgeBaseItem | null {
  const kbId = STRATEGY_TO_KB_ITEM_ID[strategyId];
  if (!kbId) return null;
  return KNOWLEDGE_BASE_ITEMS.find((item) => item.id === kbId) ?? null;
}

