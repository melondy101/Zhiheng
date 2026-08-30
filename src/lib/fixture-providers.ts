import type {
  Identity,
  IdentityProvider,
  LLMProvider,
  Report,
  RetrievalProvider,
  Session,
} from './providers';
import { FIXTURE_QUESTION } from './providers';

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
      content: `关于"${question}"，社区中存在多种代表性观点。本报告使用本地演示数据归纳核心论点，供思辨过程参考。`,
      viewpoints: [
        '这种观点强调渐进式变革的重要性',
        '另一种视角认为激进创新才能带来真正的突破',
        '还有一种观点认为答案取决于具体情境',
      ],
    };
  }
}

export class FixtureLLMProvider implements LLMProvider {
  async generateQuestion(_session: Session): Promise<string> {
    return FIXTURE_QUESTION;
  }
}

export class AnonymousIdentityProvider implements IdentityProvider {
  async getCurrentIdentity(): Promise<Identity> {
    return { type: 'anonymous', id: 'anon' };
  }
}
