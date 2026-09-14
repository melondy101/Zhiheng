import type { Source } from './providers';

// Small, dependency-free public-page crawler. It is deliberately low volume
// and cached; it is a supplementary evidence path, not a replacement for an
// authorised Zhihu API client. Results are returned as ordinary Zhihu sources
// so the UI does not expose transport details.
const cache = new Map<string, { sources: Source[]; updatedAt: number }>();
const TTL = Number(process.env.CRAWLER_TTL_MS || 86_400_000);

function key(q: string) { return q.trim().toLowerCase().replace(/\s+/g, ' '); }
function unescapeHtml(s: string) {
  return s.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/<[^>]+>/g, '').trim();
}

async function crawlPost(url: string, fallbackTitle: string, signal: AbortSignal, headers: Record<string, string>, id: string): Promise<Source> {
  try {
    const res = await fetch(url, { headers, signal });
    if (!res.ok) return { id, type: 'zhihu', author: null, title: fallbackTitle, url, excerpt: null };
    const html = await res.text();
    const pick = (pattern: RegExp) => unescapeHtml((html.match(pattern)?.[1] || '').trim());
    const title = pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i) || pick(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || fallbackTitle;
    const description = pick(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']+)/i);
    const body = pick(/<article[^>]*>([\s\S]*?)<\/article>/i);
    return { id, type: 'zhihu', author: null, title, url, excerpt: (body || description || '').slice(0, 1200) || null };
  } catch {
    return { id, type: 'zhihu', author: null, title: fallbackTitle, url, excerpt: null };
  }
}

export async function crawlZhihuSources(question: string, timeoutMs = 8_000): Promise<Source[]> {
  // Opt-in until an authorised crawler endpoint/session is configured. Public
  // Zhihu search currently returns an anti-bot challenge from this runtime;
  // silently treating that as evidence would be misleading.
  if (process.env.CRAWLER_ENABLED !== 'true') return [];
  const k = key(question); if (!k) return [];
  const hit = cache.get(k); if (hit && Date.now() - hit.updatedAt < TTL) return hit.sources;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { 'User-Agent': 'Mozilla/5.0 (compatible; Zhiyan/1.0)', Accept: 'text/html' };
    // Zhihu's first-party search page is often JS/challenge protected. Use it
    // when available, then fall back to a free public search index query that
    // returns links and snippets for Zhihu posts (no paid crawler involved).
    let res = await fetch(`https://www.zhihu.com/search?type=content&q=${encodeURIComponent(question.trim())}`, { headers, signal: controller.signal });
    let html = res.ok ? await res.text() : '';
    if (!html || html.length < 500 || res.status === 403) {
      res = await fetch(`https://www.bing.com/search?q=${encodeURIComponent(`site:zhihu.com/question ${question.trim()}`)}`, { headers, signal: controller.signal });
      if (!res.ok) return [];
      html = await res.text();
    }
    const out: Source[] = [];
    const seen = new Set<string>();
    const re = /<h2[^>]*>\s*<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>\s*<\/h2>/gi;
    let m: RegExpExecArray | null; let i = 0;
    while ((m = re.exec(html)) && out.length < 10) {
      const href = unescapeHtml(m[1] || '');
      const title = unescapeHtml(m[2] || '');
      const excerpt = '';
      if (!title || seen.has(title)) continue; seen.add(title);
      if (!/zhihu\.com\/(question|answer|p)\//i.test(href)) continue;
      out.push({ id: `zcrawl_${Math.abs(hash(k))}_${i++}`, type: 'zhihu', author: null, title, url: href, excerpt: excerpt || null });
    }
    // Follow discovered links and enrich each item with page metadata/content.
    // A 403 remains a real URL-only result; no fabricated body is produced.
    const enriched = await Promise.all(out.slice(0, 5).map((s) => crawlPost(s.url!, s.title || '', controller.signal, headers, s.id)));
    const result = enriched.length ? enriched : out;
    if (result.length) cache.set(k, { sources: result, updatedAt: Date.now() });
    return result;
  } catch { return []; } finally { clearTimeout(timer); }
}

function hash(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = ((h << 5) - h) + s.charCodeAt(i) | 0; return h; }
