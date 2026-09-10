 'use client';

import { useEffect, useState } from 'react';

function sectionBlocks(markdown: string): Array<{ title: string; body: string }> {
  return markdown.split(/^## /m).slice(1).map((block) => {
    const [title, ...lines] = block.split('\n');
    return { title: title.trim(), body: lines.join('\n').trim() };
  });
}

function HoloCard({ markdown }: { markdown: string }) {
  const blocks = sectionBlocks(markdown);
  const topic = blocks.find((block) => block.title.includes('辩题'))?.body || '知研思辨成果';
  const keyBlocks = blocks.filter((block) => !block.title.includes('附录')).slice(0, 6);
  return (
    <div className="holo-share-stage">
      <article className="holo-card" tabIndex={0} aria-label={`知研思辨卡片：${topic}`}>
        <div className="holo-card-foil" aria-hidden="true" />
        <div className="holo-card-grid" aria-hidden="true" />
        <div className="holo-card-header">
          <span className="holo-card-mark">知研</span>
          <span className="holo-card-edition">THINKING RECORD · 001</span>
        </div>
        <div className="holo-card-core">
          <div className="holo-card-orbit" aria-hidden="true"><span>✦</span></div>
          <p className="holo-card-kicker">思辨成果卡</p>
          <h2>{topic.replace(/^\*\*|\*\*$/g, '').slice(0, 80)}</h2>
        </div>
      </article>
      <div className="holo-card-detail">
        {keyBlocks.map((block) => (
          <section key={block.title}>
            <h3>{block.title}</h3>
            <div className="holo-card-detail-body">{block.body}</div>
          </section>
        ))}
      </div>
    </div>
  );
}

export default function SharePage({ params }: { params: Promise<{ id: string }> }) {
  const [markdown, setMarkdown] = useState<string | null>(null);
  useEffect(() => {
    void params.then(({ id }) => fetch(`/api/share?id=${encodeURIComponent(id)}`).then((response) => response.json()).then((data) => setMarkdown(data.markdown ?? null)).catch(() => setMarkdown(null)));
  }, [params]);
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8">
      <article className="mx-auto max-w-4xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="mb-5 text-xl font-bold text-blue-600">知研 · 思辨分享</h1>
        {markdown ? <HoloCard markdown={markdown} /> : <p className="text-sm text-slate-500">分享内容不存在或已失效。</p>}
      </article>
    </main>
  );
}
