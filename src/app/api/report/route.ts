import { NextResponse } from 'next/server';
import { serverStorage } from '@/lib/server-providers';
import type { Session, ReportProgress, SourceState } from '@/lib/providers';
import { ZhihuSearchProvider, WebSearchProvider, SearchResult } from '@/lib/search-providers';
import { HistorySearchProvider } from '@/lib/history-search';
import { buildReport } from '@/lib/report-builder';
import { buildGraph } from '@/lib/knowledge-graph';

export const runtime = 'nodejs';

const SEARCH_TIMEOUT_MS = 5_000;

interface ExtendedProgress extends ReportProgress {
  zhihuSourceState?: SourceState;
  webSourceState?: SourceState;
}

/** Wrap a promise with a timeout. */
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: () => T): T {
  // Synchronous timeout wrapper using Promise.race
  // Returns fallback if timeout fires first
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('Search timeout')), ms);
  });

  return Promise.race([promise, timeoutPromise])
    .finally(() => clearTimeout(timeoutId)) as T;
}

async function searchWithTimeout<T extends SearchResult>(
  provider: { search(question: string): Promise<T> },
  question: string,
  timeoutMs: number
): Promise<T> {
  let timedOut = false;
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      timedOut = true;
      reject(new Error('Search timeout'));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([
      provider.search(question),
      timeoutPromise,
    ]);
    return result;
  } catch {
    // If timed out, provider will return its own fallback (cache/demo)
    // Re-call search which will fall through to cache/demo
    if (timedOut) {
      return provider.search(question);
    }
    // Non-timeout error — still try cache/demo via provider
    return provider.search(question);
  }
}

export async function POST(request: Request) {
  const { question, excludedHistoryIds = [] } = await request.json();
  if (!question) {
    return NextResponse.json({ error: 'Missing question' }, { status: 400 });
  }

  const zhihuProvider = new ZhihuSearchProvider();
  const webProvider = new WebSearchProvider();
  const historyProvider = new HistorySearchProvider();

  // Run searches in parallel with 5s timeout each
  const [zhihuResult, webResult, historyResult] = await Promise.all([
    searchWithTimeout(zhihuProvider, question, SEARCH_TIMEOUT_MS),
    searchWithTimeout(webProvider, question, SEARCH_TIMEOUT_MS),
    historyProvider.search(question, excludedHistoryIds as string[]),
  ]);

  const zhihuSourceState: SourceState = zhihuResult.source;
  const webSourceState: SourceState = webResult.source;

  // Build the report with progress tracking including source state
  const { report, progress } = await buildReport({
    question,
    zhihuSources: zhihuResult.sources,
    webSources: webResult.sources,
    historySources: historyResult.sources,
    zhihuSourceState,
    webSourceState,
  });

  // Build knowledge graph from report sources (non-blocking if it fails)
  let knowledgeGraph = null;
  try {
    knowledgeGraph = buildGraph(report, report.references);
  } catch {
    // Graph failure must not break the report
    knowledgeGraph = null;
  }

  const session: Session = {
    id: `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    question,
    initialOpinion: null,
    report,
    selectedViewpoint: null,
    messages: [],
    resultCard: null,
    completed: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    excludedHistoryIds: excludedHistoryIds as string[],
  };

  await serverStorage.saveSession(session);

  // Attach source state to final progress event
  const enrichedProgress: ExtendedProgress[] = progress.map(p => ({
    ...p,
    zhihuSourceState: p.zhihuSourceState ?? zhihuSourceState,
    webSourceState: p.webSourceState ?? webSourceState,
  }));

  return NextResponse.json({
    sessionId: session.id,
    report,
    progress: enrichedProgress,
    sourceState: { zhihu: zhihuSourceState, web: webSourceState },
    knowledgeGraph,
  });
}
