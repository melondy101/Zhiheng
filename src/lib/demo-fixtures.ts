// Demo fixtures for ticket #13 — three fixed topics covering AI/tech, social/life, work/education.
// Each fixture includes raw search response, normalized data, expected report, graph, and capture time.

export interface DemoFixture {
  topic: string;
  category: 'AI/技术' | '社会/生活' | '职场/教育/个人选择';
  captureTime: string;
  rawZhihu: unknown;
  rawWeb: unknown;
  normalized: {
    question: string;
    sources: Array<{
      id: string;
      type: 'zhihu' | 'web';
      author: string;
      title: string;
      url: string;
      excerpt: string;
    }>;
  };
  expectedReport: {
    title: string;
    knowledgePoints: string[];
    viewpoints: string[];
  };
  expectedGraph: {
    nodeCount: number;
    edgeCount: number;
  };
}

export const DEMO_FIXTURES: DemoFixture[] = [
  {
    topic: 'AI是否会取代人类创造力',
    category: 'AI/技术',
    captureTime: '2026-08-30T10:00:00Z',
    rawZhihu: { items: ['raw response captured at ' + new Date().toISOString()] },
    rawWeb: { results: [] },
    normalized: {
      question: 'AI是否会取代人类创造力',
      sources: [
        {
          id: 'ai-1',
          type: 'zhihu',
          author: '张三',
          title: 'AI 与创造力的边界',
          url: 'https://www.zhihu.com/question/ai-1',
          excerpt: 'AI 是工具，不替代灵感。',
        },
        {
          id: 'ai-2',
          type: 'web',
          author: 'MIT Tech Review',
          title: 'Generative AI and the Future of Creativity',
          url: 'https://www.technologyreview.com/ai-creativity',
          excerpt: 'Studies show AI augments but does not replace human creative output.',
        },
      ],
    },
    expectedReport: {
      title: 'AI 与人类创造力：协作而非替代',
      knowledgePoints: [
        'AI 是创造力的工具而非替代',
        '原创想法仍来自人类经验',
        'AI 加速创作流程',
      ],
      viewpoints: [
        '工具增强派：AI 提升创作效率',
        '审慎反思派：过度依赖会削弱原创',
        '协作模式派：人机协作是未来',
      ],
    },
    expectedGraph: { nodeCount: 8, edgeCount: 10 },
  },
  {
    topic: '远程工作是否应该成为常态',
    category: '社会/生活',
    captureTime: '2026-08-30T10:00:00Z',
    rawZhihu: { items: [] },
    rawWeb: { results: [] },
    normalized: {
      question: '远程工作是否应该成为常态',
      sources: [
        {
          id: 'social-1',
          type: 'zhihu',
          author: '李四',
          title: '远程一年体验',
          url: 'https://www.zhihu.com/question/social-1',
          excerpt: '通勤节省，但协作效率下降。',
        },
        {
          id: 'social-2',
          type: 'web',
          author: 'Harvard Business Review',
          title: 'Remote Work: The Future Is Hybrid',
          url: 'https://hbr.org/remote-hybrid',
          excerpt: 'Hybrid models report highest employee satisfaction.',
        },
      ],
    },
    expectedReport: {
      title: '远程工作：混合模式更可持续',
      knowledgePoints: [
        '完全远程降低通勤成本',
        '完全远程影响团队协作',
        '混合模式兼顾灵活与效率',
      ],
      viewpoints: [
        '全远程支持派：效率高、自律强',
        '混合派：灵活兼顾协作',
        '回归办公室派：企业文化需要线下',
      ],
    },
    expectedGraph: { nodeCount: 7, edgeCount: 9 },
  },
  {
    topic: '35岁程序员是否应该转管理',
    category: '职场/教育/个人选择',
    captureTime: '2026-08-30T10:00:00Z',
    rawZhihu: { items: [] },
    rawWeb: { results: [] },
    normalized: {
      question: '35岁程序员是否应该转管理',
      sources: [
        {
          id: 'work-1',
          type: 'zhihu',
          author: '王五',
          title: '35 岁程序员的转型',
          url: 'https://www.zhihu.com/question/work-1',
          excerpt: '技术与管理的平衡是难题。',
        },
        {
          id: 'work-2',
          type: 'web',
          author: 'IEEE Software',
          title: 'Career Paths for Senior Developers',
          url: 'https://www.computer.org/career-paths',
          excerpt: 'IC track and management track both viable beyond age 35.',
        },
      ],
    },
    expectedReport: {
      title: '35 岁程序员：多路径并行',
      knowledgePoints: [
        '技术深度可走 IC 路径',
        '管理是横向扩展',
        '个人兴趣决定路径',
      ],
      viewpoints: [
        '技术专家派：深耕 IC 路径',
        '管理者派：横向扩展影响力',
        '复合型派：双轨并行',
      ],
    },
    expectedGraph: { nodeCount: 7, edgeCount: 9 },
  },
];

export function getFixtureByTopic(topic: string): DemoFixture | undefined {
  return DEMO_FIXTURES.find((f) => f.topic === topic);
}
