import { NextResponse } from 'next/server';
import { createZhihuSearchProvider } from '@/lib/zhihu-retrieval';
import type { Source } from '@/lib/providers';

export const runtime = 'nodejs';

interface RecommendationInput {
  question?: unknown;
  sources?: unknown;
}

function cleanSources(value: unknown): Source[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): Source[] => {
    if (!item || typeof item !== 'object') return [];
    const source = item as Partial<Source>;
    if (source.type !== 'zhihu' || typeof source.url !== 'string' || !/^https?:\/\/\S+$/i.test(source.url)) return [];
    return [{
      id: typeof source.id === 'string' ? source.id : source.url,
      type: 'zhihu',
      author: typeof source.author === 'string' ? source.author : null,
      title: typeof source.title === 'string' ? source.title : null,
      url: source.url,
      excerpt: typeof source.excerpt === 'string' ? source.excerpt : null,
    }];
  });
}

function normalized(value: string | null): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function usable(source: Source): source is Source & { url: string } {
  return source.type === 'zhihu' && typeof source.url === 'string' && /^https?:\/\/\S+$/i.test(source.url);
}

function uniqueSources(sources: Source[], excluded: Set<string>): Source[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const url = source.url?.trim();
    if (!url || excluded.has(url) || seen.has(url)) return false;
    seen.add(url);
    return true;
  });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as RecommendationInput | null;
  const question = typeof body?.question === 'string' ? body.question.trim() : '';
  if (!question) return NextResponse.json({ error: 'question is required' }, { status: 400 });

  const cited = cleanSources(body?.sources);
  const excluded = new Set(cited.map((source) => source.url!.trim()));
  const authors = [...new Set(cited.map((source) => source.author).filter((author): author is string => Boolean(author?.trim())))].slice(0, 3);
  const provider = createZhihuSearchProvider({ count: 8, timeoutMs: 5_000 });

  // Zhihu applies a short-window limit to search requests. This route is
  // invoked immediately after the report is rendered, so firing the topic and
  // three author expansions together can turn one optional sidebar into a
  // four-request burst. Keep this non-critical enrichment serialized: the
  // report is already visible and each subsequent request starts only after
  // the previous one has completed.
  const topicResult = await provider.search(`${question} 相关话题`);
  const authorResults = [];
  for (const author of authors) {
    authorResults.push(await provider.search(`${author} ${question}`));
  }

  const authorRecommendations = uniqueSources(
    authorResults.flatMap((result, index) => result.source === 'live'
      ? result.sources.filter((source) => usable(source) && normalized(source.author) === normalized(authors[index]))
      : []),
    excluded,
  ).slice(0, 3);
  const topicRecommendations = uniqueSources(
    topicResult.source === 'live' ? topicResult.sources.filter(usable) : [],
    new Set([...excluded, ...authorRecommendations.map((source) => source.url!.trim())]),
  ).slice(0, 5);

  return NextResponse.json({
    source: topicResult.source === 'live' || authorResults.some((result) => result.source === 'live') ? 'live' : 'unavailable',
    author: authorRecommendations,
    topics: topicRecommendations,
  });
}
