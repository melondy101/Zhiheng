import { spawn } from 'node:child_process';
import path from 'node:path';
import type { Source } from './providers';

export interface ScraplingResult { posts: Array<{ url: string; title?: string; content?: string; author?: string; source?: string }>; post_count: number; report_input: string; }

export function runScrapling(query: string, timeoutMs = 20_000): Promise<Source[]> {
  return new Promise((resolve) => {
    const script = path.join(process.cwd(), 'scripts', 'scrapling-bridge.py');
    const child = spawn(process.env.PYTHON_BIN || 'python', [script], { stdio: ['pipe', 'pipe', 'ignore'] });
    let out = ''; const timer = setTimeout(() => { child.kill(); resolve([]); }, timeoutMs);
    child.stdout.on('data', (chunk) => { out += chunk.toString(); });
    child.on('error', () => { clearTimeout(timer); resolve([]); });
    child.on('close', () => {
      clearTimeout(timer);
      try {
        const result = JSON.parse(out) as ScraplingResult;
        resolve((result.posts ?? []).filter((p) => p.url && (p.title || p.content)).map((p, i) => ({ id: `scrapling_${i}_${Math.abs(hash(p.url))}`, type: 'zhihu', author: p.author || null, title: p.title || null, url: p.url, excerpt: p.content || null, provenance: 'scrapling_public_web' })));
      } catch { resolve([]); }
    });
    child.stdin.end(JSON.stringify({ query, limit: 10, timeout: Math.max(5, Math.floor(timeoutMs / 1000)) }));
  });
}
function hash(value: string) { let h = 0; for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) | 0; return h; }
