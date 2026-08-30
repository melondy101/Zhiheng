import { NextResponse } from 'next/server';
import { storageProvider } from '@/lib/demo-providers';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    identity: { type: 'anonymous', id: 'anonymous' },
    providers: {
      retrieval: 'demo',
      llm: 'deterministic',
      storage: 'memory',
      rendering: 'server-rendered-html',
    },
    timestamp: new Date().toISOString(),
  });
}
