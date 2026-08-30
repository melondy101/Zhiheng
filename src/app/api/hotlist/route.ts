import { NextResponse } from 'next/server';
import { DemoRetrievalProvider } from '@/lib/demo-providers';

const retrievalProvider = new DemoRetrievalProvider();

export const runtime = 'nodejs';

export async function GET() {
  const data = await retrievalProvider.getHotList();
  return NextResponse.json(data);
}
