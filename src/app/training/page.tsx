'use client';
/* eslint-disable @next/next/no-html-link-for-pages */
import { useEffect, useState } from 'react';
import { ownerHeaders } from '@/lib/owner-id';

const challenges = [
  { id: 'evidence', title: '不完整证据下行动', desc: '训练在信息不足时设计可撤回的小规模行动。' },
  { id: 'counter', title: '最强反方挑战', desc: '练习准确复述反方，并找出改变判断的条件。' },
  { id: 'fairness', title: '成本由谁承担', desc: '识别总体收益背后的群体差异与分配风险。' },
  { id: 'tradeoff', title: '不可逆决策', desc: '在时间压力下明确排序价值并承担代价。' },
];
export default function TrainingPage() {
  const [profile, setProfile] = useState<any>(null);
  useEffect(() => { fetch('/api/profile', { headers: ownerHeaders() }).then((r) => r.json()).then(setProfile).catch(() => undefined); }, []);
  const code = profile?.thinkingProfile?.code ?? '';
  const recommended = code.startsWith('E') ? challenges[0] : code.endsWith('G') ? challenges[2] : challenges[1];
  return <main className="min-h-screen bg-surface p-6 sm:p-10"><div className="max-w-3xl mx-auto space-y-6"><a href="/" className="text-sm text-brand">返回知研</a><h1 className="text-2xl font-semibold">思维训练中心</h1><p className="text-sm text-content-secondary">根据你的近期思维画像，选择一个挑战继续推演。</p><div className="grid sm:grid-cols-2 gap-4">{challenges.map((item) => <a key={item.id} href={`/?training=${item.id}`} className={`rounded-xl border p-5 bg-surface-elevated hover:border-brand transition-colors ${item.id === recommended.id ? 'border-brand ring-1 ring-brand/20' : 'border-line'}`}><div className="text-xs text-brand mb-2">{item.id === recommended.id ? '推荐挑战' : '训练剧本'}</div><h2 className="font-semibold">{item.title}</h2><p className="text-xs text-content-secondary mt-2">{item.desc}</p></a>)}</div></div></main>;
}
