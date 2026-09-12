import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

const ZHIHU_QUOTA_ENDPOINT = 'https://developer.zhihu.com/api/v1/quota';
const QUESTION_API_IDS = 'creator,question_answers';

type ZhihuQuotaItem = {
  APIID?: unknown;
  apiId?: unknown;
  RemainingQuota?: unknown;
  remaining?: unknown;
};

function parseQuotaItems(payload: unknown) {
  const record = payload as { Data?: { Items?: ZhihuQuotaItem[] } };
  const items = record.Data?.Items;
  if (!Array.isArray(items)) return [];

  return items.flatMap((item) => {
    const apiId = item.APIID ?? item.apiId;
    const remaining = item.RemainingQuota ?? item.remaining;
    if (typeof apiId !== 'string' || typeof remaining !== 'number' || !Number.isFinite(remaining)) {
      return [];
    }
    return [{ apiId, remaining }];
  });
}

export async function GET() {
  const accessSecret = process.env.ZHIHU_ACCESS_SECRET;
  if (!accessSecret) {
    return NextResponse.json({ error: 'ZHIHU_QUOTA_UNAVAILABLE' }, { status: 503 });
  }

  const url = new URL(ZHIHU_QUOTA_ENDPOINT);
  url.searchParams.set('APIIDs', QUESTION_API_IDS);

  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessSecret}` },
      cache: 'no-store',
    });
    if (!response.ok) {
      return NextResponse.json({ error: 'ZHIHU_QUOTA_UNAVAILABLE' }, { status: 503 });
    }
    return NextResponse.json({ quotas: parseQuotaItems(await response.json()) });
  } catch {
    return NextResponse.json({ error: 'ZHIHU_QUOTA_UNAVAILABLE' }, { status: 503 });
  }
}
