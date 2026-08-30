import type {
  Identity,
  IdentityProvider,
  LLMProvider,
  Report,
  RetrievalProvider,
  Session,
  Source,
} from './providers';
import { FIXTURE_QUESTION } from './providers';

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
  async generateQuestion(_session: Session): Promise<string> {
    return FIXTURE_QUESTION;
  }

  async generateStrategyQuestion(
    _strategy: import('./strategy-engine').StrategyId,
    session: Session
  ): Promise<string> {
    // Fixture: round-based deterministic question matching strategy-engine plan
    const userCount = session.messages.filter((m) => m.role === 'user').length;
    const next = userCount + 1;
    const questions: Record<number, string> = {
      1: '你能给出一个具体的数据或例子来支持你目前的观点吗？',
      2: '你的观点背后，是否有一个隐含的前提？如果该前提不成立，结论会改变吗？',
      3: '请尝试用最强的一种对立观点重新论证。哪种反驳最难回应？',
      4: '如果你必须为相反的立场辩护，你最有力的论据是什么？',
      5: '基于以上讨论，请用一两句话重新表述你当前的观点。',
    };
    return questions[next] ?? `第 ${next} 轮：请进一步阐述你的观点。`;
  }
}

export class AnonymousIdentityProvider implements IdentityProvider {
  async getCurrentIdentity(): Promise<Identity> {
    return { type: 'anonymous', id: 'anon' };
  }
}
