const API_BASE_URL = 'https://developer.zhihu.com';

function stringField(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function itemsFrom(payload: unknown): Record<string, unknown>[] | null {
  if (!payload || typeof payload !== 'object') return null;
  const root = payload as Record<string, unknown>;
  const data = root.Data ?? root.data;
  const items = data && typeof data === 'object' ? (data as Record<string, unknown>).Items ?? (data as Record<string, unknown>).items : null;
  return Array.isArray(items) ? items.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object')) : null;
}

async function call(path: string, params: Record<string, string>): Promise<Record<string, unknown>[] | null> {
  const secret = process.env.ZHIHU_ACCESS_SECRET?.trim();
  if (!secret) return null;
  const url = new URL(path, API_BASE_URL);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${secret}`,
      'X-Request-Timestamp': String(Math.floor(Date.now() / 1000)),
      'Content-Type': 'application/json',
    },
  });
  if (!response.ok) return null;
  return itemsFrom(await response.json());
}

export async function recommendQuestions(topic: string): Promise<{ title: string; url: string }[] | null> {
  const items = await call('/api/v1/user/question_recommendations', { Query: topic, Count: '5' });
  if (!items) return null;
  return items.flatMap((item) => {
    const title = stringField(item, 'Title', 'title');
    const url = stringField(item, 'Url', 'url');
    return title && url && /^https:\/\/www\.zhihu\.com\/question\//.test(url) ? [{ title, url }] : [];
  }).slice(0, 5);
}

export async function getQuestionAnswerSummaries(questionUrl: string): Promise<{ summary: string; url: string | null }[] | null> {
  const items = await call('/api/v1/content/question_answers', { QuestionUrl: questionUrl, Offset: '0', Limit: '10' });
  if (!items) return null;
  return items.flatMap((item) => {
    const summary = stringField(item, 'Summary', 'summary');
    if (!summary) return [];
    return [{ summary, url: stringField(item, 'Url', 'url') }];
  }).slice(0, 10);
}

export function isZhihuQuestionUrl(value: string): boolean {
  return /^https:\/\/www\.zhihu\.com\/question\/\d+(?:[/?#].*)?$/i.test(value);
}