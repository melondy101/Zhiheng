// Deterministic demo provider - all data is fixture-backed, no external calls
import type {
  RetrievalProvider, LLMProvider, Report, Reference, GraphData,
  Viewpoint, LLMResponse, Session, Message, ResultCard,
} from './providers';

const DEMO_REFERENCES: Reference[] = [
  { id: 1, category: 'zhihu', title: '知乎：AI能否真正具有创造力？', url: 'https://zhihu.com/question/ai-creativity' },
  { id: 2, category: 'zhihu', title: '知乎：大模型时代的创作新范式', url: 'https://zhihu.com/question/creation-paradigm' },
  { id: 3, category: 'web', title: 'MIT Technology Review: The Creativity Machine', url: 'https://example.com/mit-creativity' },
  { id: 4, category: 'web', title: 'Nature: AI in Creative Industries', url: 'https://example.com/nature-ai-creative' },
  { id: 5, category: 'ai_synthesis', title: 'AI综合分析：基于知乎与全网检索的归纳' },
];

const DEMO_GRAPH: GraphData = {
  nodes: [
    { id: 'n1', label: 'AI创造力', type: 'concept' },
    { id: 'n2', label: '人类独特性', type: 'concept' },
    { id: 'n3', label: '技术能力', type: 'evidence' },
    { id: 'n4', label: '情感意识', type: 'evidence' },
    { id: 'n5', label: '协作模式', type: 'inferred' },
    { id: 'n6', label: '伦理争议', type: 'counter' },
    { id: 'n7', label: '用户观点', type: 'user' },
    { id: 'n8', label: '未来展望', type: 'inferred' },
  ],
  edges: [
    { from: 'n1', to: 'n3', label: '具备', sourceType: 'supported', citationId: 1 },
    { from: 'n1', to: 'n4', label: '缺乏', sourceType: 'supported', citationId: 2 },
    { from: 'n1', to: 'n5', label: '可能走向', sourceType: 'inferred' },
    { from: 'n1', to: 'n6', label: '引发', sourceType: 'supported', citationId: 3 },
    { from: 'n1', to: 'n7', label: '对立', sourceType: 'user_claimed' },
    { from: 'n2', to: 'n4', label: '依赖', sourceType: 'supported', citationId: 2 },
    { from: 'n5', to: 'n8', label: '通向', sourceType: 'inferred' },
    { from: 'n6', to: 'n8', label: '影响', sourceType: 'inferred' },
  ],
};

const STRATEGY_TEMPLATES = [
  { id: 'm1', name: '证据追问', fallback: '你能提供一个具体的数据或例子来支持这个观点吗？' },
  { id: 'm2', name: '前提追问', fallback: '你提到这个观点时，依赖了什么未明说的前提假设？' },
  { id: 'm4', name: '钢铁人反驳', fallback: '如果对方拿出最强证据反驳你，你认为最有说服力的反方论点会是什么？' },
  { id: 'm6', name: '立场反转', fallback: '假设你必须完全站在对立立场论证，你会怎么重新表述这个观点？' },
];

const TURN_ORDER = ['m1', 'm2', 'm4', 'm6'];

export class DemoRetrievalProvider implements RetrievalProvider {
  async getHotList() {
    return {
      items: [
        { id: 1, title: 'AI是否会取代人类创造力？', url: 'https://zhihu.com/question/1' },
        { id: 2, title: '远程办公的未来趋势', url: 'https://zhihu.com/question/2' },
        { id: 3, title: '如何评价当前的大语言模型发展？', url: 'https://zhihu.com/question/3' },
        { id: 4, title: '程序员35岁危机真的存在吗？', url: 'https://zhihu.com/question/4' },
        { id: 5, title: '量子计算离我们还有多远？', url: 'https://zhihu.com/question/5' },
        { id: 6, title: '年轻人为什么越来越不爱社交？', url: 'https://zhihu.com/question/6' },
        { id: 7, title: '新能源汽车还能走多远？', url: 'https://zhihu.com/question/7' },
        { id: 8, title: '如何建立有效的个人知识体系？', url: 'https://zhihu.com/question/8' },
        { id: 9, title: 'AI伦理：我们应该担心什么？', url: 'https://zhihu.com/question/9' },
        { id: 10, title: '副业是不是当代人的刚需？', url: 'https://zhihu.com/question/10' },
      ],
      updatedAt: new Date().toISOString(),
      source: 'demo',
    };
  }

  async search(query: string) {
    return {
      query,
      results: [
        { id: 1, title: `${query}：知乎上的深度讨论`, snippet: `关于"${query}"的知乎社区讨论...`, source: 'zhihu', url: `https://zhihu.com/search?q=${encodeURIComponent(query)}` },
        { id: 2, title: `${query}：全网综合分析`, snippet: `关于"${query}"的多角度分析...`, source: 'web', url: `https://example.com/search?q=${encodeURIComponent(query)}` },
        { id: 3, title: `${query}：专家观点汇总`, snippet: `多位专家对"${query}"的看法...`, source: 'web', url: 'https://example.com/expert' },
        { id: 4, title: `${query}：历史讨论回顾`, snippet: `此前关于"${query}"的讨论回顾...`, source: 'zhihu', url: 'https://zhihu.com/question/historical' },
        { id: 5, title: `${query}：实证研究综述`, snippet: `实证研究对"${query}"的结论...`, source: 'web', url: 'https://example.com/research' },
      ],
    };
  }

  async generateReport(question: string): Promise<Report> {
    return {
      question,
      title: question,
      knowledgePoints: [
        '当前AI在模式识别和数据处理方面表现出色，但在创造力和意识层面仍有明显局限。',
        '人类创造力涉及情感体验、文化背景和主观意识，这些是AI难以完全复制的维度。',
        'AI与人类的关系更可能是协作而非替代，未来需要重新定义"创造力"的边界。',
      ],
      content: `关于"${question}"的讨论在知乎社区和学术领域持续升温。社区中的主要观点分为支持派、质疑派和协作派三个阵营。`,
      viewpoints: [
        'AI终将取代大部分创造性工作，人类需要找到新的定位',
        'AI是强大的协作工具，人类创造力将通过人机协作得到增强',
        'AI与人类创造力的关系取决于我们如何定义"创造力"本身',
      ],
      references: DEMO_REFERENCES,
      graph: DEMO_GRAPH,
    };
  }
}

export class DemoLLMProvider implements LLMProvider {
  async generateQuestion(session: Session): Promise<LLMResponse> {
    const userTurns = session.messages.filter(m => m.role === 'user').length;
    const idx = (userTurns) % TURN_ORDER.length;
    const strategy = STRATEGY_TEMPLATES[idx];
    return {
      question: strategy.fallback,
      strategyId: strategy.id,
      strategyName: strategy.name,
      citations: [],
    };
  }
}

// Storage provider using server-side singleton Map (survives reloads in same process)
// For production, replace with database-backed implementation
export class MemoryStorageProvider {
  private store = new Map<string, Session>();

  async saveSession(session: Session): Promise<void> {
    this.store.set(session.id, { ...session });
  }

  async loadSession(id: string): Promise<Session | null> {
    return this.store.get(id) || null;
  }

  async listSessions(): Promise<Session[]> {
    return Array.from(this.store.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async deleteSession(id: string): Promise<void> {
    this.store.delete(id);
  }
}

// Singleton instance for process lifetime
export const storageProvider = new MemoryStorageProvider();

export function buildResultCard(session: Session): ResultCard {
  const userMessages = session.messages.filter(m => m.role === 'user');
  return {
    sessionId: session.id,
    initialStance: session.initialOpinion
      ? { text: session.initialOpinion, source: 'user_authored' as const }
      : null,
    selectedStartingStance: session.selectedViewpoint
      ? { text: session.selectedViewpoint.text, source: 'ai_suggested_user_selected' as const }
      : null,
    evidence: userMessages.slice(1).map(m => m.text),
    revisions: [],
    finalPosition: userMessages.length > 0 ? userMessages[userMessages.length - 1].text : null,
    unresolved: [],
    messageIds: userMessages.map(m => m.id),
  };
}

export function isCheckpoint(turn: number): boolean {
  return turn === 5 || (turn > 5 && (turn - 5) % 3 === 0);
}

export const VIEWPOINT_OPTIONS: Viewpoint[] = [
  { id: 'v1', text: 'AI终将取代大部分创造性工作，人类需要找到新的定位', source: 'ai_authored' },
  { id: 'v2', text: 'AI是强大的协作工具，人类创造力将通过人机协作得到增强', source: 'ai_authored' },
  { id: 'v3', text: 'AI与人类创造力的关系取决于我们如何定义"创造力"本身', source: 'ai_authored' },
];
