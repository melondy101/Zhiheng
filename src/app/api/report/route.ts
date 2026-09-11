import { NextResponse } from 'next/server';
import { getServerStorage, StorageUnavailableError } from '@/lib/server-storage';
import { readOwnerId } from '@/lib/owner-id';
import type { Session, ReportProgress, SourceState, Source } from '@/lib/providers';
import { createZhihuSearchProvider, createGlobalSearchProvider } from '@/lib/zhihu-retrieval';
import { HistorySearchProvider, type HistorySessionSnapshot } from '@/lib/history-search';
import { defaultKnowledgeBaseProvider } from '@/lib/knowledge-base';
import { buildReport } from '@/lib/report-builder';
import { safeBuildGraphAsync, safeBuildGraph } from '@/lib/knowledge-graph';
import { graphLlmProvider, llmProvider } from '@/lib/server-providers';
import { classifyLLMError, classifyZhihuError, type ServiceDiagnostic } from '@/lib/service-diagnostics';

export const runtime = 'nodejs';
export const maxDuration = 60;

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

/**
 * Accept only the minimal browser-owned history shape used by the history
 * provider. The route remains safe when called by older clients or arbitrary
 * HTTP clients that omit or malformed this optional field.
 */
function parseHistorySessions(value: unknown): HistorySessionSnapshot[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((candidate): HistorySessionSnapshot[] => {
    if (!candidate || typeof candidate !== 'object') return [];
    const record = candidate as Record<string, unknown>;
    if (
      typeof record.id !== 'string' ||
      typeof record.question !== 'string' ||
      (record.initialOpinion !== null && typeof record.initialOpinion !== 'string') ||
      typeof record.completed !== 'boolean' ||
      typeof record.updatedAt !== 'number' ||
      !Number.isFinite(record.updatedAt) ||
      !Array.isArray(record.messages)
    ) {
      return [];
    }

    const messages = record.messages.flatMap((message): { role: string; text: string }[] => {
      if (!message || typeof message !== 'object') return [];
      const item = message as Record<string, unknown>;
      return typeof item.role === 'string' && typeof item.text === 'string'
        ? [{ role: item.role, text: item.text }]
        : [];
    });

    return [{
      id: record.id,
      question: record.question,
      initialOpinion: record.initialOpinion as string | null,
      messages,
      completed: record.completed,
      updatedAt: record.updatedAt,
    }];
  });
}

export async function POST(request: Request) {
  const requestStartedAt = Date.now();
  try {
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

    const { question, initialOpinion, excludedHistoryIds = [], historySessions } = await request.json();
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
    const parsedHistorySessions = parseHistorySessions(historySessions);

    const retrievalStartedAt = Date.now();
    const [zhihuResult, webResult, historyResult, kbResults] = await Promise.all([
      zhihuProvider.search(question),
      webProvider.search(question),
      historyProvider.search(question, parsedHistorySessions, excludedHistoryIds as string[]),
      defaultKnowledgeBaseProvider.search(question, { limit: 2 }),
    ]);
    const retrievalDurationMs = Date.now() - retrievalStartedAt;
    console.log('[report] Retrieval completed:', {
      durationMs: retrievalDurationMs,
      zhihu: zhihuResult.source,
      web: webResult.source,
      zhihuCount: zhihuResult.sources.length,
      webCount: webResult.sources.length,
    });

    const kbSources: Source[] = kbResults.map((r) => ({
      id: `kb_${r.item.id}`,
      type: 'knowledge_base',
      author:
        r.item.category === 'philosophy'
          ? '哲学思辨知识库'
          : r.item.category === 'debate'
          ? '辩论模型知识库'
          : r.item.category === 'logic'
          ? '逻辑与认知谬误知识库'
          : '垂直领域分析库',
      title: `${r.item.topic}（${r.item.title}）`,
      url: null,
      excerpt: `${r.item.summary} —— ${r.item.content}`,
      category: r.item.category,
      topic: r.item.topic,
    }));

    // Log the actual retrieval results for debugging
    console.log('[report] Retrieval results:', {
      zhihu: { count: zhihuResult.sources.length, source: zhihuResult.source, stale: zhihuResult.stale, updatedAt: zhihuResult.updatedAt },
      web: { count: webResult.sources.length, source: webResult.source, stale: webResult.stale, updatedAt: webResult.updatedAt },
      history: { count: historyResult.sources.length },
      kb: { count: kbSources.length },
      question,
    });
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
    console.log('[report] Building report with llmProvider:', {
      hasLLM: !!llmProvider.generateSynthesis,
      llmProviderType: llmProvider.constructor.name,
    });
    const synthesisStartedAt = Date.now();
    const { report, progress, synthesisDiagnostic } = await buildReport({
      question,
      zhihuSources: zhihuResult.sources,
      webSources: webResult.sources,
      historySources: historyResult.sources,
      kbSources,
      zhihuSourceState,
      webSourceState,
      llmProvider,
    });
    const synthesisDurationMs = Date.now() - synthesisStartedAt;

    // #24: attach sourceState for KG provenance so the view can show truthful
    // source provenance even for graphs restored from a stored session.
    let knowledgeGraph;
    let graphDiagnostic: ServiceDiagnostic | undefined;
    try {
      const graphStartedAt = Date.now();
      const raw = await safeBuildGraphAsync(report, report.references, graphLlmProvider);
      knowledgeGraph = { ...raw, sourceState };
      graphDiagnostic = {
        service: 'ai_graph',
        serviceName: 'AI 知识图谱生成',
        success: !raw.isFallback,
        reason: raw.isFallback ? 'other' : 'ok',
        reasonLabel: raw.isFallback ? '降级静态提取' : '正常',
        message: raw.isFallback ? '知识图谱使用基于规则的实体提取' : 'AI 知识图谱推理构建成功',
        timestamp: Date.now(),
      };
      console.log('[report] Knowledge graph completed:', {
        durationMs: Date.now() - graphStartedAt,
        isFallback: raw.isFallback,
        nodeCount: raw.nodes.length,
        edgeCount: raw.edges.length,
      });
    } catch (error) {
      console.warn('[report] Knowledge graph async failed, degrading to safe graph:', error instanceof Error ? error.message : String(error));
      const raw = safeBuildGraph(report, report.references);
      knowledgeGraph = { ...raw, sourceState };
      graphDiagnostic = classifyLLMError('ai_graph', error);
    }

    const effectiveSynthesisDiag = synthesisDiagnostic ?? {
      service: 'ai_synthesis',
      serviceName: 'AI 研报多观点提炼',
      success: Boolean(report.synthesis),
      reason: report.synthesis ? 'ok' : 'unconfigured',
      reasonLabel: report.synthesis ? '正常' : '未配置秘钥',
      message: report.synthesis ? 'AI 综合观点提炼成功' : '未生成 AI 观点',
      timestamp: Date.now(),
    };

    const diagnostics = {
      zhihuSearch: zhihuResult.diagnostic ?? classifyZhihuError('zhihu_search', null),
      webSearch: webResult.diagnostic ?? classifyZhihuError('global_search', null),
      aiSynthesis: effectiveSynthesisDiag,
      aiGraph: graphDiagnostic,
    };

    // Print clear structured diagnostic logs in backend console as requested
    console.log('================== [REPORT SERVICE DIAGNOSTICS] ==================');
    console.log(`[report:diagnostics] 议题: "${question}"`);
    console.log(
      `[report:diagnostics] 1. 知乎内容检索 (Zhihu Search): [${diagnostics.zhihuSearch.reasonLabel}] - ${diagnostics.zhihuSearch.message} (获取到 ${zhihuResult.sources.length} 条材料, 数据源: ${zhihuResult.source})`
    );
    console.log(
      `[report:diagnostics] 2. 全网内容检索 (Global Search): [${diagnostics.webSearch.reasonLabel}] - ${diagnostics.webSearch.message} (获取到 ${webResult.sources.length} 条材料, 数据源: ${webResult.source})`
    );
    console.log(
      `[report:diagnostics] 3. AI 观点提炼 (AI Synthesis): [${diagnostics.aiSynthesis.reasonLabel}] - ${diagnostics.aiSynthesis.message}`
    );
    if (diagnostics.aiGraph) {
      console.log(
        `[report:diagnostics] 4. AI 知识图谱 (AI Graph): [${diagnostics.aiGraph.reasonLabel}] - ${diagnostics.aiGraph.message}`
      );
    }
    console.log('===================================================================');

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
      reportSourceState: sourceState,
    };

    // #21: persist under the anonymous owner. If the configured database is
    // unavailable the report is STILL returned — it is fully computed and too
    // expensive to throw away — with an explicit saved:false / storage:
    // 'unavailable' signal so the client keeps its localStorage mirror.
    let saved = true;
    let storageSignal: 'memory' | 'postgres' | 'unavailable' = 'memory';
    try {
      const serverStorage = await getServerStorage();
      storageSignal = serverStorage.mode;
      try {
        await serverStorage.forOwner(ownerId).sessions.saveSession(session);
      } catch (storageErr) {
        console.warn('[report] Storage saveSession failed, degrading safely:', storageErr);
        saved = false;
        storageSignal = 'unavailable';
      }
    } catch (storageInitErr) {
      console.warn('[report] getServerStorage failed, degrading to memory fallback:', storageInitErr);
      saved = false;
      storageSignal = 'unavailable';
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
      diagnostics,
      saved,
      storage: storageSignal,
      timings: {
        totalMs: Date.now() - requestStartedAt,
        retrievalMs: retrievalDurationMs,
        synthesisMs: synthesisDurationMs,
      },
    });
  } catch (fatalErr) {
    const fatalDiag = classifyLLMError('ai_synthesis', fatalErr);
    console.error('[report:fatal_error] Fatal error in report generation:', fatalErr);
    console.error(`[report:fatal_error] Classified diagnostic: reason=${fatalDiag.reason}, message=${fatalDiag.message}`);
    return NextResponse.json(
      {
        error: fatalDiag.message || '研报生成异常，请稍后重试',
        reason: fatalDiag.reason,
        reasonLabel: fatalDiag.reasonLabel,
        diagnostic: fatalDiag,
        detail: fatalErr instanceof Error ? fatalErr.message : String(fatalErr),
      },
      { status: 500 }
    );
  }
}
