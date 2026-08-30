// Deterministic search providers for ticket #4.
// These providers return fixed demonstration data — NOT live search results.
// They exist to anchor the report pipeline with reproducible citation sources.

import type { Source } from './providers';

// ---------------------------------------------------------------------------
// ZhihuSearchProvider — returns 3-5 deterministic Zhihu sources
// ---------------------------------------------------------------------------

const ZHIHU_DEMO_SOURCES: Omit<Source, 'id'>[] = [
  {
    type: 'zhihu',
    author: '张三',
    title: 'AI 会取代程序员吗？——从历史技术演进角度分析',
    url: 'https://www.zhihu.com/question/10001',
    excerpt: '回顾历次技术浪潮，每次都会创造新的岗位而非消灭所有旧岗位。AI 编程助手本质上是工具升级，程序员需要从"写代码"转向"管理 AI 写代码"。',
  },
  {
    type: 'zhihu',
    author: '李四',
    title: '大模型时代，普通开发者如何保持竞争力',
    url: 'https://www.zhihu.com/question/10002',
    excerpt: '核心观点是：理解业务场景和系统架构的能力比手写代码速度更重要。AI 擅长的是语法层面的生成，人类擅长的是需求拆解和决策判断。',
  },
  {
    type: 'zhihu',
    author: '王五',
    title: '我对 AI 生成代码质量的实际观察',
    url: 'https://www.zhihu.com/question/10003',
    excerpt: '经过半年使用 AI 辅助编程，发现代码质量高度依赖提示词工程。简单需求 AI 完成度高，但复杂业务逻辑仍需人工审查和重构。',
  },
  {
    type: 'zhihu',
    author: '赵六',
    title: '从招聘角度看 AI 对程序员岗位的影响',
    url: 'https://www.zhihu.com/question/10004',
    excerpt: '公司招聘初级工程师的标准正在变化：不再考察语法记忆，而是考察问题定义能力和 AI 工具使用熟练度。',
  },
];

export class ZhihuSearchProvider {
  /**
   * Search Zhihu for sources related to the given question.
   * Returns a deterministic subset (first 3-5 matches).
   */
  async search(question: string): Promise<Source[]> {
    // Simulate network delay (200-400ms)
    const delay = 200 + Math.abs(this.hashCode(question)) % 200;
    await new Promise<void>(resolve => setTimeout(resolve, delay));

    const normalized = question.trim().toLowerCase();
    // Deterministic "scoring" based on question hash to select 3-5 sources
    const count = 3 + (Math.abs(this.hashCode(normalized)) % 3); // 3-5
    const selected = ZHIHU_DEMO_SOURCES.slice(0, count);

    return selected.map((s, i) => ({
      ...s,
      id: `zhihu_${Math.abs(this.hashCode(normalized))}_${i}`,
    }));
  }

  /** Simple deterministic string hash for "search relevance" scoring. */
  private hashCode(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0; // Convert to 32bit integer
    }
    return hash;
  }
}

// ---------------------------------------------------------------------------
// WebSearchProvider — returns 2-3 deterministic web sources
// ---------------------------------------------------------------------------

const WEB_DEMO_SOURCES: Omit<Source, 'id'>[] = [
  {
    type: 'web',
    author: 'GitHub Blog',
    title: 'How GitHub Copilot Changes Developer Workflow',
    url: 'https://github.blog/2024-ai-developer-workflow/',
    excerpt: 'A study of 1M+ Copilot users shows 55% reduction in time spent on boilerplate code, with mixed results on architectural decision tasks.',
  },
  {
    type: 'web',
    author: 'ACM TechReport',
    title: 'Assessing AI-Generated Code: A Comparative Study',
    url: 'https://dl.acm.org/doi/example/ai-code-quality-2024',
    excerpt: 'Benchmark of GPT-4 and Claude 3 on real-world codebases shows AI excels at pattern matching but struggles with cross-cutting concerns.',
  },
  {
    type: 'web',
    author: 'IEEE Spectrum',
    title: 'The Future of Software Engineering in an AI-First World',
    url: 'https://spectrum.ieee.org/software-engineering-ai-2024',
    excerpt: 'Industry survey of 500 CTOs: 78% have integrated AI tools, but only 12% have reduced headcount. The role is transforming, not disappearing.',
  },
];

export class WebSearchProvider {
  /**
   * Search the web for sources related to the given question.
   * Returns a deterministic subset (2-3 matches).
   */
  async search(question: string): Promise<Source[]> {
    // Simulate network delay (300-500ms)
    const delay = 300 + Math.abs(this.hashCode(question)) % 200;
    await new Promise<void>(resolve => setTimeout(resolve, delay));

    const normalized = question.trim().toLowerCase();
    const count = 2 + (Math.abs(this.hashCode(normalized + '_web')) % 2); // 2-3
    const selected = WEB_DEMO_SOURCES.slice(0, count);

    return selected.map((s, i) => ({
      ...s,
      id: `web_${Math.abs(this.hashCode(normalized + '_web'))}_${i}`,
    }));
  }

  private hashCode(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return hash;
  }
}
