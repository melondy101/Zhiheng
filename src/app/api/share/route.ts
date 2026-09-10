import { NextResponse } from 'next/server';
import { getServerStorage, StorageUnavailableError } from '@/lib/server-storage';

export const runtime = 'nodejs';

function isLocalAddress(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === 'localhost' || hostname === '0.0.0.0' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return true;
  }
}

function id(): string {
  return `share_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { markdown?: unknown } | null;
  if (!body || typeof body.markdown !== 'string' || body.markdown.length < 1) {
    return NextResponse.json({ error: 'markdown is required' }, { status: 400 });
  }
  const shareId = id();
  const createdAt = Date.now();
  try {
    await (await getServerStorage()).savePublicShare(shareId, body.markdown, createdAt);
  } catch (error) {
    if (error instanceof StorageUnavailableError) {
      return NextResponse.json({ error: 'Share storage unavailable' }, { status: 503 });
    }
    throw error;
  }
  // Sink redirects must target a public deployment URL. The dev server binds
  // to 0.0.0.0, which is not reachable by people opening a shared link.
  const base = process.env.SHARE_BASE_URL?.trim()?.replace(/\/+$/, '') || new URL(request.url).origin;
  let longUrl = `${base}/share/${shareId}`;
  let shortUrl: string | null = null;
  const sinkBase = process.env.SINK_BASE_URL?.trim();
  const sinkKey = process.env.SINK_API_KEY?.trim();
  const sinkReady = Boolean(sinkBase && sinkKey && !isLocalAddress(base));
  // A Sink link to localhost is technically created but unusable to anyone
  // outside this machine. Keep local development usable with the long URL.
  if (sinkReady && sinkBase && sinkKey) {
    try {
      const response = await fetch(`${sinkBase.replace(/\/+$/, '')}/api/link/create`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${sinkKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: longUrl,
          title: '知研 · 思辨分享',
          description: '查看完整的辩题、证据、观点演变与论点争论战场。',
          comment: `Zhiyan share ${shareId}`,
        }),
      });
      if (response.ok) {
        const result = await response.json() as Record<string, unknown>;
        const link = result.link as Record<string, unknown> | undefined;
        const candidate = result.shortLink ?? result.shortUrl ?? link?.shortLink ?? result.url;
        if (typeof candidate === 'string' && candidate.startsWith('http')) shortUrl = candidate;
      }
    } catch (error) {
      console.warn('[share] Sink short-link request failed:', error instanceof Error ? error.message : String(error));
    }
  }
  return NextResponse.json({ shareId, url: shortUrl ?? longUrl, longUrl, shortened: Boolean(shortUrl), sinkConfigured: sinkReady });
}

export async function GET(request: Request) {
  const shareId = new URL(request.url).searchParams.get('id');
  let document = null;
  try {
    document = shareId ? await (await getServerStorage()).loadPublicShare(shareId) : null;
  } catch (error) {
    if (error instanceof StorageUnavailableError) return NextResponse.json({ error: 'Share storage unavailable' }, { status: 503 });
    throw error;
  }
  if (!document) return NextResponse.json({ error: 'Share not found' }, { status: 404 });
  return NextResponse.json(document);
}
