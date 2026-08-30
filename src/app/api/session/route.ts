import { NextResponse } from 'next/server';
import { serverStorage } from '@/lib/server-providers';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'Missing id parameter' }, { status: 400 });
  }

  const session = await serverStorage.loadSession(id);
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  return NextResponse.json(session);
}

export async function POST(request: Request) {
  const data = await request.json();
  if (!data.id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  const existing = await serverStorage.loadSession(data.id);
  if (!existing) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  if (data.selectedViewpoint !== undefined) {
    existing.selectedViewpoint = data.selectedViewpoint;
  }
  if (data.resultCard) {
    existing.resultCard = data.resultCard;
  }
  if (data.completed !== undefined) {
    existing.completed = data.completed;
  }
  existing.updatedAt = Date.now();

  await serverStorage.saveSession(existing);
  return NextResponse.json({ ok: true, session: existing });
}
