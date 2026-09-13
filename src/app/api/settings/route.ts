import { NextResponse } from 'next/server';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const runtime = 'nodejs';

const LOCAL_KEYS = [
  'LLM_BASE_URL', 'LLM_MODEL', 'LLM_API_KEY', 'ZHIHU_API_BASE_URL', 'ZHIHU_ACCESS_SECRET',
  'SINK_BASE_URL', 'SINK_API_KEY', 'OBSIDIAN_VAULT_PATH', 'SMTP_USER', 'SMTP_PASS',
  'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_FROM', 'RESEND_API_KEY', 'RESEND_FROM_EMAIL',
] as const;
const SECRET_KEYS = new Set(['LLM_API_KEY', 'ZHIHU_ACCESS_SECRET', 'SINK_API_KEY', 'SMTP_PASS', 'RESEND_API_KEY']);

function isLocal() { return process.env.VERCEL !== '1' && process.env.LOCAL_SETTINGS_ENABLED !== 'false'; }

export async function GET() {
  let envText = '';
  try { envText = await readFile(path.join(process.cwd(), '.env.local'), 'utf8'); } catch { /* use process env */ }
  const settings = Object.fromEntries(LOCAL_KEYS.map((key) => {
    const fileMatch = envText.match(new RegExp(`^${key}=(.*)$`, 'm'));
    const value = (fileMatch?.[1] ?? process.env[key] ?? '').trim();
    return [key, SECRET_KEYS.has(key) ? (value ? 'configured' : 'empty') : value];
  }));
  return NextResponse.json({ mode: isLocal() ? 'local' : 'web', localSettings: isLocal(), settings, source: 'env.local' });
}

export async function PUT(request: Request) {
  if (!isLocal()) return NextResponse.json({ error: 'Local settings are unavailable in web deployment' }, { status: 403 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  const envPath = path.join(process.cwd(), '.env.local');
  let text = '';
  try { text = await readFile(envPath, 'utf8'); } catch { /* create below */ }
  for (const key of LOCAL_KEYS) {
    if (typeof body[key] !== 'string') continue;
    const value = body[key] as string;
    const escaped = value.replace(/\r?\n/g, '');
    const line = new RegExp(`^${key}=.*$`, 'm');
    if (line.test(text)) text = text.replace(line, `${key}=${escaped}`);
    else text += `${text.endsWith('\n') || !text ? '' : '\n'}${key}=${escaped}\n`;
    process.env[key] = escaped;
  }
  await writeFile(envPath, text, 'utf8');
  return NextResponse.json({ ok: true });
}
