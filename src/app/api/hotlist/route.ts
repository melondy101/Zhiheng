import { NextResponse } from 'next/server';

// Demo data — same as client-side fallback. Server cannot access localStorage.
const DEMO_ITEMS = [
  { id: 'd1', title: '2026年AI大模型竞争格局：谁是最后的赢家？', url: 'https://www.zhihu.com/question/1' },
  { id: 'd2', title: '为什么越来越多的人开始学习Rust？', url: 'https://www.zhihu.com/question/2' },
  { id: 'd3', title: '如何评价OpenAI最新发布的推理模型？', url: 'https://www.zhihu.com/question/3' },
  { id: 'd4', title: '程序员35岁之后的职业出路在哪里？', url: 'https://www.zhihu.com/question/4' },
  { id: 'd5', title: '自动驾驶距离真正落地还有多远？', url: 'https://www.zhihu.com/question/5' },
  { id: 'd6', title: '量子计算距离实用化还有哪些核心瓶颈？', url: 'https://www.zhihu.com/question/6' },
  { id: 'd7', title: 'WebAssembly能否取代JavaScript成为前端主流？', url: 'https://www.zhihu.com/question/7' },
  { id: 'd8', title: 'AI生成内容对原创写作生态的影响', url: 'https://www.zhihu.com/question/8' },
  { id: 'd9', title: '为什么国内云厂商纷纷押注大模型？', url: 'https://www.zhihu.com/question/9' },
  { id: 'd10', title: '微服务架构是否正在走向终结？', url: 'https://www.zhihu.com/question/10' },
];

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({
    items: DEMO_ITEMS,
    source: 'demo',
    updatedAt: Date.now(),
  });
}
