import type {
  Identity,
  IdentityProvider,
  LLMProvider,
  Report,
  RetrievalProvider,
  Session,
  Source,
} from './providers';
import { STRATEGY_QUESTION_TEMPLATES } from './strategy-engine';
import type { StrategyId } from './strategy-engine';
import { buildInterrogationContext, contextClaimFragment } from './interrogation-context';

// Empty source arrays for the fixture — the fixture has no real citations.
const EMPTY_SOURCES: Source[] = [];
const EMPTY_CITATIONS: Record<number, Source> = {};

export class FixtureRetrievalProvider implements RetrievalProvider {
  async generateReport(question: string): Promise<Report> {
    return {
      question,
      title: question,
      knowledgePoints: [
        '这是一个多维度的问题，涉及技术、社会、伦理等多个层面',
        '不同立场各有其逻辑依据和适用边界',
        '深入分析需要区分事实判断与价值判断',
      ],
      content: `关于"${question}"，社区中存在多种代表性观点。本报告使用本地演示数据归纳核心论点，供思辨过程参考。（演示数据）`,
      viewpoints: [
        '这种观点强调渐进式变革的重要性',
        '另一种视角认为激进创新才能带来真正的突破',
        '还有一种观点认为答案取决于具体情境',
      ],
      references: EMPTY_SOURCES,
      citations: EMPTY_CITATIONS,
    };
  }
}

export class FixtureLLMProvider implements LLMProvider {
  // Ticket #18 dead-code cleanup: the session-level `generateQuestion` method
  // was removed — it was dropped from the LLMProvider contract in #15, has
  // zero production callers, and its tests were removed with it. Only the
  // strategy-aware `generateStrategyQuestion` remains, matching the interface.
  /**
   * Fixture question generation (#16): deterministic and context-driven.
   * The question quotes a claim fragment extracted from the user's latest
   * answer (or the selected stance for round 1) and frames it with the
   * strategy's interrogative template. No external LLM is called; identical
   * inputs always produce the identical question.
   */
  async generateStrategyQuestion(strategy: StrategyId, session: Session): Promise<string> {
    const context = buildInterrogationContext(session, strategy);
    const claim = contextClaimFragment(context);
    const template = STRATEGY_QUESTION_TEMPLATES[strategy];
    return claim ? template.withClaim(claim) : template.plain;
  }
}

export class AnonymousIdentityProvider implements IdentityProvider {
  async getCurrentIdentity(): Promise<Identity> {
    return { type: 'anonymous', id: 'anon' };
  }
}
