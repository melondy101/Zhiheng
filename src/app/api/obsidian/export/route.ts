import { NextResponse } from 'next/server';
import { exportSessionToObsidian, ObsidianExportError } from '@/lib/obsidian-export';
import type { Session } from '@/lib/providers';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const body = await request.json() as { session?: Session; relativePath?: string };
    if (!body.session?.id || !body.session.question) {
      return NextResponse.json({ error: 'A complete session is required' }, { status: 400 });
    }
    const result = await exportSessionToObsidian(body.session, body.relativePath);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof ObsidianExportError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error('Obsidian export failed', error);
    return NextResponse.json({ error: 'Obsidian export failed' }, { status: 500 });
  }
}
