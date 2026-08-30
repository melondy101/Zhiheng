// Demo sources returned when search fails completely (live and cache both unavailable).
// These are marked with explicit demo labels so the UI can surface the degradation honestly.

import type { Source } from './providers';

// 3 zhihu demo sources + 2 web demo sources = 5 minimum per the ticket spec.

const ZHIHU_DEMO: Omit<Source, 'id'>[] = [
  {
    type: 'zhihu',
    author: '社区热心用户',
    title: '关于这个话题的讨论（演示数据）',
    url: 'https://www.zhihu.com/question/demo1',
    excerpt: '这是一个演示数据，用于当实时检索和缓存都不可用时展示报告结构。社区中存在多种代表性观点，请以批判性思维参考。',
  },
  {
    type: 'zhihu',
    author: '知乎回答者',
    title: '热门回答摘录（演示数据）',
    url: 'https://www.zhihu.com/question/demo2',
    excerpt: '演示数据：真实情况下此处会显示来自知乎社区的真实用户回答，经过筛选和整理后呈现核心论点。',
  },
  {
    type: 'zhihu',
    author: '认证专家',
    title: '专业角度分析（演示数据）',
    url: 'https://www.zhihu.com/question/demo3',
    excerpt: '演示数据：专家视角的分析内容。在实际场景中，这部分会包含来自行业内专业人士的深度见解和数据分析。',
  },
];

const WEB_DEMO: Omit<Source, 'id'>[] = [
  {
    type: 'web',
    author: '行业报告',
    title: '相关领域研究报告（演示数据）',
    url: 'https://example.com/report-demo1',
    excerpt: '演示数据：此处会显示来自权威机构或专业媒体的研究报告内容摘要，包含数据支撑的核心发现。',
  },
  {
    type: 'web',
    author: '技术博客',
    title: '技术分析与趋势观察（演示数据）',
    url: 'https://example.com/blog-demo2',
    excerpt: '演示数据：此处会显示来自技术博客或专业媒体的分析文章，提供行业趋势和技术洞察。',
  },
];

function hashQuestion(question: string): number {
  let hash = 0;
  const normalized = question.trim().toLowerCase();
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash;
}

/**
 * Get demo sources for a given question.
 * Returns a deterministic subset of zhihu + web sources.
 */
export function getDemoSources(question: string, type: 'zhihu' | 'web' | 'all' = 'all'): Source[] {
  const normalized = question.trim().toLowerCase();
  const seed = Math.abs(hashCode(normalized));

  if (type === 'zhihu') {
    return ZHIHU_DEMO.map((s, i) => ({
      ...s,
      id: `demo_zhihu_${seed}_${i}`,
    }));
  }

  if (type === 'web') {
    return WEB_DEMO.map((s, i) => ({
      ...s,
      id: `demo_web_${seed}_${i}`,
    }));
  }

  // 'all': return combined list
  const zhihu = ZHIHU_DEMO.map((s, i) => ({
    ...s,
    id: `demo_zhihu_${seed}_${i}`,
  }));
  const web = WEB_DEMO.map((s, i) => ({
    ...s,
    id: `demo_web_${seed}_${i}`,
  }));
  return [...zhihu, ...web];
}

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash;
}
