import { NextResponse } from 'next/server';
import { getServerStorage, StorageUnavailableError } from '@/lib/server-storage';
import { readOwnerId } from '@/lib/owner-id';
import type { Session, ReportProgress, SourceState } from '@/lib/providers';
import { createZhihuSearchProvider, createGlobalSearchProvider } from '@/lib/zhihu-retrieval';
import { HistorySearchProvider } from '@/lib/history-search';
import { buildReport } from '@/lib/report-builder';
import { buildGraph } from '@/lib/knowledge-graph';

export const runtime = 'nodejs';

const SEARCH_TIMEOUT_MS = 5_000;

interface ExtendedProgress extends ReportProgress {
  zhihuSourceState?: SourceState;
  webSourceState?: SourceState;
}

/**
 * Honest retrieval disclosure for the report (#18/#19). The optional
 * updatedAt/stale fields carry cache timestamps so the UI can show when the
 * cached data was actually retrieved instead of implying it is current.
 */
interface ExtendedSourceState {
  zhihu: SourceState;
  web: SourceState;
  zhihuUpdatedAt?: number;
  webUpdatedAt?: number;
  zhihuStale?: boolean;
  webStale?: boolean;
}

export async function POST(request: Request) {
  // #21: every storage-touching request must carry the anonymous ownership
  // header; the session is stored under that owner and is invisible to
  // other owners.
  const ownerId = readOwnerId(request);
  if (!ownerId) {
    return NextResponse.json(
      { error: 'Missing or invalid x-zhiyan-owner header' },
      { status: 400 }
    );
  }

  const { question, initialOpinion, excludedHistoryIds = [] } = await request.json();
  if (!question) {
    return NextResponse.json({ error: 'Missing question' }, { status: 400 });
  }

  // Real retrieval (#19): each provider degrades internally
  // live → fresh cache → stale cache → demo and never throws. SEARCH_TIMEOUT_MS
  // is the live-call timeout, so one slow provider cannot stall the report.
  // Without a configured ZHIHU_ACCESS_SECRET the providers never touch the
  // network and return the deterministic demo data (same behavior as before #19).
  const zhihuProvider = createZhihuSearchProvider({ timeoutMs: SEARCH_TIMEOUT_MS });
  const webProvider = createGlobalSearchProvider({ timeoutMs: SEARCH_TIMEOUT_MS });
  const historyProvider = new HistorySearchProvider();

  const [zhihuResult, webResult, historyResult] = await Promise.all([
    zhihuProvider.search(question),
    webProvider.search(question),
    historyProvider.search(question, excludedHistoryIds as string[]),
  ]);

  const zhihuSourceState: SourceState = zhihuResult.source;
  const webSourceState: SourceState = webResult.source;

  const sourceState: ExtendedSourceState = {
    zhihu: zhihuSourceState,
    web: webSourceState,
    zhihuUpdatedAt: zhihuResult.updatedAt,
    webUpdatedAt: webResult.updatedAt,
    zhihuStale: zhihuResult.stale === true,
    webStale: webResult.stale === true,
  };

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

  // Ticket #15: persist the full initial session state (including the user's
  // initial opinion and the knowledge graph) so the interrogation API returns
  // a complete session the client can mirror losslessly.
  const session: Session = {
    id: `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    question,
    initialOpinion:
      typeof initialOpinion === 'string' && initialOpinion.trim().length > 0
        ? initialOpinion.trim()
        : null,
    report,
    knowledgeGraph,
    selectedViewpoint: null,
    messages: [],
    resultCard: null,
    completed: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    excludedHistoryIds: excludedHistoryIds as string[],
  };

  // #21: persist under the anonymous owner. If the configured database is
  // unavailable the report is STILL returned — it is fully computed and too
  // expensive to throw away — with an explicit saved:false / storage:
  // 'unavailable' signal so the client keeps its localStorage mirror and
  // never believes the session was persisted remotely.
  const serverStorage = await getServerStorage();
  let saved = true;
  let storageSignal: 'memory' | 'postgres' | 'unavailable' = serverStorage.mode;
  try {
    await serverStorage.forOwner(ownerId).sessions.saveSession(session);
  } catch (err) {
    if (err instanceof StorageUnavailableError) {
      saved = false;
      storageSignal = 'unavailable';
    } else {
      throw err;
    }
  }

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
    sourceState,
    knowledgeGraph,
    saved,
    storage: storageSignal,
  });
}
