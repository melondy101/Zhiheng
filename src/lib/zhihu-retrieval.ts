// Server-side real retrieval against the Zhihu Open Platform (#19).
//
// Degradation chain, per source kind (zhihu_search | global_search | hot_list):
//   1. live  — only when ZHIHU_ACCESS_SECRET is configured AND no fresh cache
//              exists for this (kind, query). A success writes the cache.
//   2. cache — a fresh hit is served without burning an external call (quota
//              protection: the platform caps hot_list at 100 calls/day and
//              search at 5000/day); a stale hit is served with stale:true when
//              live is unconfigured or fails. updatedAt is always preserved.
//   3. demo  — deterministic fixture, never labeled 'live'.
//
// Honesty red lines:
//   - fixture/demo data is NEVER labeled 'live'; only a successful real
//     provider call yields source='live';
//   - without a configured secret the transport is never invoked;
//   - missing provider metadata stays null — never coerced, never fabricated;
//   - every external response is untrusted input: mapped field-by-field,
//     validated, never executed, never interpolated into prompts.
//
// Secrets are read from the server environment only. No NEXT_PUBLIC_ variable
// is used anywhere in this module, so nothing here can reach the browser.
//
// All failures (timeout, network error, invalid body, unusable payload, HTTP
// 401/403/429/451/5xx) degrade cleanly to the next level; callers never see a
// throw.

import type { Source, SourceState } from './providers';
import { getDemoSources } from './demo-sources';
import type { HotlistItem } from './hotlist-providers';
import type { HotlistSnapshot, HotlistSnapshotStore } from './db/hotlist-snapshot-store';
import { logStartupPath } from './startup-log';
import { logRequest, maskSensitiveHeaders, nowMs, previewBody, redactQuery } from './request-log';

// Log environment configuration on module load (once).
logStartupPath();

export const DEFAULT_ZHIHU_API_BASE_URL = 'https://developer.zhihu.com';
export const RETRIEVAL_TTL_MS = 86_400_000; // 24 hours
export const DEFAULT_LIVE_TIMEOUT_MS = 5_000;
/** PRD v4.2 §2: the persisted hotlist snapshot is trusted for 6 hours. */
export const HOTLIST_SNAPSHOT_TTL_MS = 6 * 60 * 60 * 1000;

export type RetrievalKind = 'zhihu_search' | 'global_search' | 'hot_list';

// ---------------------------------------------------------------------------
// Server-side configuration (env-only, never exposed to the browser)
// ---------------------------------------------------------------------------

export interface ZhihuApiConfig {
  baseUrl: string;
  accessSecret: string;
}

/**
 * Read the retrieval configuration from the server environment. Returns null
 * when no access secret is configured — the system then runs the honest demo
 * path and never touches the network.
 */
export function readZhihuApiConfig(
  env: Record<string, string | undefined> = process.env
): ZhihuApiConfig | null {
  const accessSecret = env.ZHIHU_ACCESS_SECRET?.trim();
  if (!accessSecret) return null;
  const baseUrl = (env.ZHIHU_API_BASE_URL?.trim() || DEFAULT_ZHIHU_API_BASE_URL).replace(/\/+$/, '');
  return { baseUrl, accessSecret };
}

// ---------------------------------------------------------------------------
// Injectable HTTP transport (contract tests fake this; production uses fetch)
// ---------------------------------------------------------------------------

export interface ZhihuCallOptions {
  method: 'GET';
  headers: Record<string, string>;
  signal: AbortSignal;
}

export type ZhihuHttpTransport = (url: string, options: ZhihuCallOptions) => Promise<Response>;

export const defaultHttpTransport: ZhihuHttpTransport = (url, options) => fetch(url, options);

// ---------------------------------------------------------------------------
// In-process TTL cache — isolated per (kind, normalized query), 24h TTL
// ---------------------------------------------------------------------------

export interface CacheHit<T> {
  value: T;
  updatedAt: number;
  stale: boolean;
}

export interface TtlCacheOptions {
  ttlMs?: number;
  /** Injectable clock for deterministic fresh/stale tests. */
  now?: () => number;
}

/** Normalize a query for cache identity: trim, lowercase, collapse whitespace. */
export function normalizeQuery(question: string): string {
  return question.trim().toLowerCase().replace(/\s+/g, ' ');
}

export class TtlCache<T> {
  private readonly entries = new Map<string, { value: T; updatedAt: number }>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: TtlCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? RETRIEVAL_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  private keyFor(kind: RetrievalKind, query: string): string {
    return `${kind}:${normalizeQuery(query)}`;
  }

  get(kind: RetrievalKind, query: string): CacheHit<T> | null {
    const entry = this.entries.get(this.keyFor(kind, query));
    if (!entry) return null;
    return {
      value: entry.value,
      updatedAt: entry.updatedAt,
      stale: this.now() - entry.updatedAt > this.ttlMs,
    };
  }

  set(kind: RetrievalKind, query: string, value: T): void {
    this.entries.set(this.keyFor(kind, query), { value, updatedAt: this.now() });
  }
}

// ---------------------------------------------------------------------------
// Untrusted response mapping — field-by-field, validated, null-preserving
// ---------------------------------------------------------------------------

/** Accept only non-empty strings; numbers/objects/etc. stay null (no coercion). */
export function asTrimmedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

const HTTP_URL_RE = /^https?:\/\/\S+$/i;

/** Only http(s) links are usable; anything else stays null (never fabricated). */
export function normalizeUrl(value: unknown): string | null {
  const raw = asTrimmedString(value);
  return raw && HTTP_URL_RE.test(raw) ? raw : null;
}

// Candidate keys for the documented response fields. The platform docs list
// the returned fields in prose (title/summary/author/publish time/…), not a
// JSON schema, so mapping accepts the documented field names and common
// snake_case variants. Anything unrecognized stays null — never guessed.
// The first spelling in each list is the documented Zhihu Open Platform field;
// the remaining spellings keep compatible gateways and existing fixtures working.
const TITLE_KEYS = ['Title', 'title', 'question_title', 'question'] as const;
const EXCERPT_KEYS = ['ContentText', 'excerpt', 'content', 'summary', 'answer_excerpt'] as const;
const AUTHOR_KEYS = ['AuthorName', 'author', 'author_name'] as const;
const URL_KEYS = ['Url', 'url', 'link', 'question_url'] as const;
// The live Zhihu API uses a PascalCase response envelope (`Code`, `Data`,
// `Message`), while fixtures and compatible gateways commonly use lowercase
// envelope keys.  Keep the accepted shape explicit: only array-bearing
// collection keys are considered. The official successful shape is
// `{ Code: 0, Data: { Items: [...] } }`; a business-error `Data: null` stays
// unusable and follows the honest degradation path.
const ENVELOPE_KEYS = ['data', 'Data', 'items', 'results', 'list'] as const;
const NESTED_ITEM_KEYS = ['Items', 'items'] as const;

/**
 * Extract the record array from a response body. Accepts a bare array or an
 * object envelope ({data|Data|items|results|list: [...]}) or the documented
 * `{ Data: { Items: [...] } }` shape. Returns null when no array is found (the
 * caller degrades).
 */
export function extractItems(body: unknown): unknown[] | null {
  if (Array.isArray(body)) return body;
  if (typeof body === 'object' && body !== null) {
    const record = body as Record<string, unknown>;
    for (const key of ENVELOPE_KEYS) {
      const candidate = record[key];
      if (Array.isArray(candidate)) return candidate;
      if (typeof candidate === 'object' && candidate !== null) {
        const nested = candidate as Record<string, unknown>;
        for (const itemKey of NESTED_ITEM_KEYS) {
          const items = nested[itemKey];
          if (Array.isArray(items)) return items;
        }
      }
    }
  }
  return null;
}

function firstString(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = asTrimmedString(record[key]);
    if (value !== null) return value;
  }
  return null;
}

/** Stable 32-bit hash of the normalized query — deterministic source ids. */
function stableHash(text: string): number {
  let hash = 0;
  const normalized = text.trim().toLowerCase();
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) - hash) + normalized.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

/**
 * Map one search record to a Source. Records without any title or excerpt are
 * unusable (null). Missing author/url/excerpt stay null.
 */
export function mapSearchSource(
  raw: unknown,
  kind: 'zhihu_search' | 'global_search',
  queryHash: string,
  index: number
): Source | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const title = firstString(record, TITLE_KEYS);
  const excerpt = firstString(record, EXCERPT_KEYS);
  if (title === null && excerpt === null) return null;
  return {
    id: `${kind === 'zhihu_search' ? 'zsearch' : 'gsearch'}_${queryHash}_${index}`,
    type: kind === 'zhihu_search' ? 'zhihu' : 'web',
    author: firstString(record, AUTHOR_KEYS),
    title,
    url: normalizeUrl(firstString(record, URL_KEYS)),
    excerpt,
  };
}

/**
 * Map one hot_list record to a hotlist item. Records without any title are
 * unusable (null). A missing URL stays null.
 */
export function mapHotlistItem(raw: unknown, index: number): HotlistItem | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const title = firstString(record, TITLE_KEYS);
  if (title === null) return null;
  return {
    id: `hot_${stableHash(title)}_${index}`,
    title,
    url: normalizeUrl(firstString(record, URL_KEYS)),
  };
}

// ---------------------------------------------------------------------------
// Shared degradation core: live → fresh cache → stale cache → demo
// ---------------------------------------------------------------------------

export interface DegradedResult<T> {
  value: T;
  source: SourceState;
  stale?: boolean;
  updatedAt: number;
}

interface DegradedCall<T> {
  kind: RetrievalKind;
  query: string;
  config: ZhihuApiConfig | null;
  cache: TtlCache<T>;
  now: () => number;
  /** Null when live retrieval is impossible (unconfigured). */
  fetchLive: (() => Promise<T>) | null;
  isUsable: (value: T) => boolean;
  demo: () => T;
  allowDemoFallback?: boolean;
}

async function retrieveWithDegradation<T>(call: DegradedCall<T>): Promise<DegradedResult<T>> {
  const cached = call.cache.get(call.kind, call.query);

  // 1. live — always attempted when a secret is configured; fresh cache is a
  //     fallback used only after live has failed (never a default path).
  if (call.config && call.fetchLive) {
    try {
      const live = await call.fetchLive();
      if (call.isUsable(live)) {
        call.cache.set(call.kind, call.query, live);
        return { value: live, source: 'live', updatedAt: call.now() };
      }
      // Unusable live payload — treated like any other external failure.
    } catch (err) {
      // #19 honest degradation: surface the real failure so we never silently
      // claim 'live' succeeded. Operators need to see 401/timeout/parse errors.
      console.warn(
        `[zhihu-retrieval] live ${call.kind} failed — degrading:`,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  // 2. fresh or stale cache — updatedAt is preserved for honest display.
  if (cached) {
    return {
      value: cached.value,
      source: 'cache',
      stale: cached.stale ?? false,
      updatedAt: cached.updatedAt,
    };
  }

  // 3. A configured live provider must never replace an upstream failure with
  // fixture content. Returning demo records here makes real reports look
  // valid while citing placeholder URLs. Demo is reserved for unconfigured
  // local development only.
  if (call.config && call.allowDemoFallback !== true) {
    return { value: [] as T, source: 'unavailable', updatedAt: call.now() };
  }
  return { value: call.demo(), source: 'demo', updatedAt: call.now() };
}

// ---------------------------------------------------------------------------
// Live HTTP call (auth headers, timeout, JSON parsing)
// ---------------------------------------------------------------------------

interface LiveCallOptions {
  config: ZhihuApiConfig;
  transport: ZhihuHttpTransport;
  timeoutMs: number;
  now: () => number;
}

function buildHeaders(config: ZhihuApiConfig, now: () => number): Record<string, string> {
  const token = config.accessSecret.replace(/^Bearer\s+/i, '').trim();
  return {
    Authorization: `Bearer ${token}`,
    'X-Request-Timestamp': String(Math.floor(now() / 1000)),
    'Content-Type': 'application/json',
  };
}

/**
 * GET with both an abort signal (cancels a real fetch) and a hard timeout
 * race (a transport that ignores the signal still cannot stall the caller).
 * Non-200 status or unparseable JSON throws — the degradation core catches it.
 *
 * Every call emits a [req:zhihu_search|global_search|zhihu_hotlist] log line
 * (start / success / failure) so operators can see exactly which URL the
 * upstream returned on, with status + first body bytes — never the secret.
 */
async function getJson(
  o: LiveCallOptions,
  path: string,
  query: string | null,
  stage: 'zhihu_hotlist' | 'zhihu_search' | 'global_search' = 'zhihu_search'
): Promise<unknown> {
  const url = query === null ? `${o.config.baseUrl}${path}` : `${o.config.baseUrl}${path}?${query}`;
  const safeQuery = redactQuery(query);
  const headers = maskSensitiveHeaders(buildHeaders(o.config, o.now));
  const startedAt = nowMs();

  logRequest({
    stage,
    phase: 'start',
    url,
    method: 'GET',
    query: safeQuery,
    headers,
    durationMs: 0,
  });

  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), o.timeoutMs);
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`Zhihu API timeout after ${o.timeoutMs}ms`)), o.timeoutMs);
  });
  try {
    const response = await Promise.race([
      o.transport(url, {
        method: 'GET',
        headers: buildHeaders(o.config, o.now),
        signal: controller.signal,
      }),
      timeoutPromise,
    ]);
    const durationMs = nowMs() - startedAt;
    const contentType = response.headers.get('content-type');
    // Always read at least a short slice of the body so we can log the
    // {"Code":30001,"Message":"rate limit exceeded"} payload that drives
    // demo degradation — the symptom operators need to see.
    const bodyText = await response.text();
    const responsePreview = previewBody(bodyText);
    if (response.status !== 200) {
      logRequest({
        stage,
        phase: 'failure',
        url,
        method: 'GET',
        query: safeQuery,
        headers,
        durationMs,
        status: response.status,
        contentType,
        error: `Zhihu API HTTP ${response.status}`,
        responsePreview,
      });
      throw new Error(`Zhihu API HTTP ${response.status}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(bodyText);
    } catch (err) {
      logRequest({
        stage,
        phase: 'failure',
        url,
        method: 'GET',
        query: safeQuery,
        headers,
        durationMs,
        status: response.status,
        contentType,
        error: `Zhihu API returned non-JSON body: ${err instanceof Error ? err.message : String(err)}`,
        responsePreview,
      });
      throw new Error('Zhihu API returned non-JSON body');
    }

    if (typeof parsed === 'object' && parsed !== null) {
      const record = parsed as Record<string, unknown>;
      const code = typeof record.Code === 'number' ? record.Code : typeof record.code === 'number' ? record.code : null;
      if (code !== null && code !== 0 && code !== 200) {
        const msg = String(record.Message || record.message || record.msg || 'Authorization or business error');
        logRequest({
          stage,
          phase: 'failure',
          url,
          method: 'GET',
          query: safeQuery,
          headers,
          durationMs,
          status: response.status,
          contentType,
          error: `Zhihu API error ${code}: ${msg}`,
          responsePreview,
        });
        throw new Error(`Zhihu API error ${code}: ${msg}`);
      }
    }

    logRequest({
      stage,
      phase: 'success',
      url,
      method: 'GET',
      query: safeQuery,
      headers,
      durationMs,
      status: response.status,
      contentType,
      responsePreview,
    });
    return parsed;
  } catch (err) {
    if (!(err instanceof Error && err.message.startsWith('Zhihu API '))) {
      logRequest({
        stage,
        phase: 'failure',
        url,
        method: 'GET',
        query: safeQuery,
        headers,
        durationMs: nowMs() - startedAt,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    throw err;
  } finally {
    clearTimeout(abortTimer);
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

// ---------------------------------------------------------------------------
// Search providers (zhihu_search / global_search)
// ---------------------------------------------------------------------------

export interface RetrievalResult {
  sources: Source[];
  source: SourceState;
  stale?: boolean;
  updatedAt: number;
}

export interface LiveSearchProviderOptions {
  kind: 'zhihu_search' | 'global_search';
  config: ZhihuApiConfig | null;
  transport?: ZhihuHttpTransport;
  cache?: TtlCache<Source[]>;
  timeoutMs?: number;
  ttlMs?: number;
  now?: () => number;
  /** Count parameter for the search endpoints (1-20, platform default 10). */
  count?: number;
  /** Production factories disable fixture fallback once a secret is set. */
  allowDemoFallback?: boolean;
}

const SEARCH_ENDPOINTS: Record<'zhihu_search' | 'global_search', string> = {
  zhihu_search: '/api/v1/content/zhihu_search',
  global_search: '/api/v1/content/global_search',
};

export class LiveSearchProvider {
  private readonly kind: 'zhihu_search' | 'global_search';
  private readonly config: ZhihuApiConfig | null;
  private readonly transport: ZhihuHttpTransport;
  private readonly cache: TtlCache<Source[]>;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private readonly count: number;
  private readonly allowDemoFallback: boolean;

  constructor(options: LiveSearchProviderOptions) {
    this.kind = options.kind;
    this.config = options.config;
    this.transport = options.transport ?? defaultHttpTransport;
    this.cache = options.cache ?? new TtlCache<Source[]>({ ttlMs: options.ttlMs });
    this.timeoutMs = options.timeoutMs ?? DEFAULT_LIVE_TIMEOUT_MS;
    this.now = options.now ?? Date.now;
    this.count = options.count ?? 10;
    this.allowDemoFallback = options.allowDemoFallback ?? true;
  }

  /** Search with the full degradation chain; never throws. */
  async search(question: string): Promise<RetrievalResult> {
    const demoType = this.kind === 'zhihu_search' ? 'zhihu' : 'web';
    const queryHash = String(stableHash(question));
    const outcome = await retrieveWithDegradation({
      kind: this.kind,
      query: question,
      config: this.config,
      cache: this.cache,
      now: this.now,
      fetchLive: this.config === null ? null : async () => {
        const config = this.config;
        if (!config) throw new Error('Zhihu API is not configured');
        const body = await getJson(
          { config, transport: this.transport, timeoutMs: this.timeoutMs, now: this.now },
          SEARCH_ENDPOINTS[this.kind],
          `Query=${encodeURIComponent(question.trim())}&Count=${this.count}`,
          this.kind
        );
        const items = extractItems(body);
        if (items === null) throw new Error('Zhihu API returned an unexpected response shape');
        return items
          .map((item, index) => mapSearchSource(item, this.kind, queryHash, index))
          .filter((s): s is Source => s !== null);
      },
      isUsable: (sources) => sources.length > 0,
      demo: () => getDemoSources(question, demoType),
      allowDemoFallback: this.allowDemoFallback,
    });
    return {
      sources: outcome.value,
      source: outcome.source,
      ...(outcome.stale !== undefined ? { stale: outcome.stale } : {}),
      updatedAt: outcome.updatedAt,
    };
  }
}

// ---------------------------------------------------------------------------
// Hotlist provider (hot_list)
// ---------------------------------------------------------------------------

export interface RetrievalHotlistResult {
  items: HotlistItem[];
  source: SourceState;
  stale?: boolean;
  updatedAt: number;
}

export interface LiveHotlistProviderOptions {
  config: ZhihuApiConfig | null;
  transport?: ZhihuHttpTransport;
  cache?: TtlCache<HotlistItem[]>;
  timeoutMs?: number;
  ttlMs?: number;
  now?: () => number;
  /**
   * Persistent snapshot store (PRD v4.2 §2). When present the provider runs
   * the CACHE-FIRST decision order; when absent it keeps the #22/#19 live
   * -first chain in retrieveWithDegradation, which search still relies on.
   */
  snapshotStore?: HotlistSnapshotStore;
  allowDemoFallback?: boolean;
}

const HOTLIST_ENDPOINT = '/api/v1/content/hot_list';
const HOTLIST_LIMIT = 10; // the UI shows the top 10

// Same deterministic demo hotlist the MVP shipped before #19 (identical ids,
// titles and demo URLs), so the demo experience is stable across the migration
// to the server-side provider.
const DEMO_HOTLIST_ITEMS: HotlistItem[] = [
  { id: 'd1', title: '2026年AI大模型竞争格局：谁是最后的赢家？', url: 'https://www.zhihu.com/question/1' },
  { id: 'd2', title: '为什么越来越多的人开始学习Rust？', url: 'https://www.zhihu.com/question/2' },
  { id: 'd3', title: '如何评价OpenAI最新发布的推理模型？', url: 'https://www.zhihu.com/question/3' },
  { id: 'd4', title: '程序员35岁之后的职业出路在哪里？', url: 'https://www.zhihu.com/question/4' },
  { id: 'd5', title: '自动驾驶距离真正落地还有多远？', url: 'https://www.zhihu.com/question/5' },
  { id: 'd6', title: '量子计算距离实用化还有哪些核心瓶颈？', url: 'https://www.zhihu.com/question/6' },
  { id: 'd7', title: 'WebAssembly能否取代JavaScript成为前端主流？', url: 'https://www.zhihu.com/question/7' },
  { id: 'd8', title: 'AI生成内容对原创写作生态的影响', url: 'https://www.zhihu.com/question/8' },
  { id: 'd9', title: '为什么国内云厂商纷纷押注大模型？', url: 'https://www.zhihu.com/question/9' },
  { id: 'd10', title: '微服务架构是否正在走向终结？', url: 'https://www.zhihu.com/question/10' },
];

export class LiveHotlistProvider {
  private readonly config: ZhihuApiConfig | null;
  private readonly transport: ZhihuHttpTransport;
  private readonly cache: TtlCache<HotlistItem[]>;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private readonly snapshotStore: HotlistSnapshotStore | null;
  private readonly allowDemoFallback: boolean;

  constructor(options: LiveHotlistProviderOptions) {
    this.config = options.config;
    this.transport = options.transport ?? defaultHttpTransport;
    this.cache = options.cache ?? new TtlCache<HotlistItem[]>({ ttlMs: options.ttlMs });
    this.timeoutMs = options.timeoutMs ?? DEFAULT_LIVE_TIMEOUT_MS;
    this.now = options.now ?? Date.now;
    this.snapshotStore = options.snapshotStore ?? null;
    this.allowDemoFallback = options.allowDemoFallback ?? true;
  }

  /** Fetch the hotlist with the full degradation chain; never throws. */
  async fetchHotlist(): Promise<RetrievalHotlistResult> {
    // Two deliberate paths: with a persistent snapshot store the hotlist is
    // cache-first (PRD v4.2 §2.2); without one (search, legacy hotlist tests)
    // the #22 live-first chain stays untouched.
    if (this.snapshotStore) {
      return this.fetchHotlistFromSnapshot(this.snapshotStore);
    }
    // No persistent DB snapshot: never use the in-memory TtlCache and never
    // claim source='cache'. Every request is a fresh live attempt (when a
    // secret is configured) or an honest demo fallback.
    try {
      const items = await this.fetchLiveItems();
      return { items, source: 'live', updatedAt: this.now() };
    } catch (err) {
      // #19 honest degradation: surface the real failure so we never silently
      // claim 'live' succeeded. Operators need to see 401/timeout/parse errors.
      console.warn(
        `[zhihu-retrieval] live hotlist failed — degrading to demo:`,
        err instanceof Error ? err.message : String(err)
      );
    }
    if (this.config && !this.allowDemoFallback) {
      return { items: [], source: 'unavailable', updatedAt: this.now() };
    }
    return {
      items: DEMO_HOTLIST_ITEMS.map((item) => ({ ...item })),
      source: 'demo',
      updatedAt: this.now(),
    };
  }

  /** One live hot_list call, mapped and trimmed to the visible top 10. */
  private async fetchLiveItems(): Promise<HotlistItem[]> {
    const config = this.config;
    if (!config) throw new Error('Zhihu API is not configured');
    const body = await getJson(
      { config, transport: this.transport, timeoutMs: this.timeoutMs, now: this.now },
      HOTLIST_ENDPOINT,
      null,
      'zhihu_hotlist'
    );
    const items = extractItems(body);
    if (items === null) throw new Error('Zhihu API returned an unexpected response shape');
    return items
      .map((item, index) => mapHotlistItem(item, index))
      .filter((item): item is HotlistItem => item !== null)
      .slice(0, HOTLIST_LIMIT);
  }

  /**
   * PRD v4.2 §2.2 decision order, used only when a snapshot store exists:
   *   1. fresh snapshot (<= 6h)  → source 'cache', ZERO external calls;
   *   2. missing/expired snapshot + live success → persist, source 'live';
   *   3. live failure + any snapshot → source 'cache' + stale:true, the
   *      snapshot's REAL updatedAt is preserved;
   *   4. live failure + no snapshot → demo (never persisted);
   *   5. store failures are logged, never disguised as a cache hit.
   */
  private async fetchHotlistFromSnapshot(
    store: HotlistSnapshotStore
  ): Promise<RetrievalHotlistResult> {
    const startedAt = this.now();
    const snapshot = await this.readSnapshotSafely(store);

    if (snapshot && startedAt - snapshot.updatedAt <= HOTLIST_SNAPSHOT_TTL_MS) {
      // Fresh: return it without touching the live transport at all.
      return { items: snapshot.items, source: 'cache', updatedAt: snapshot.updatedAt };
    }

    let liveItems: HotlistItem[] | null = null;
    if (this.config !== null) {
      try {
        const items = await this.fetchLiveItems();
        if (items.length > 0) liveItems = items;
      } catch {
        // Timeout / network / HTTP 4xx-5xx / invalid body / unusable payload —
        // degrade, never throw.
      }
    }

    if (liveItems) {
      const updatedAt = this.now();
      try {
        await store.write({ items: liveItems, updatedAt });
      } catch (err) {
        // Known limitation: the data IS live, only the persistence failed.
        // The response stays 'live' (honest about where the data came from)
        // and the failure is logged server-side — it is never reported as a
        // successful write, and the next request simply misses the cache.
        console.warn(
          '[hotlist] live hotlist could not be persisted:',
          err instanceof Error ? err.message : String(err)
        );
      }
      return { items: liveItems, source: 'live', updatedAt };
    }

    if (snapshot) {
      return {
        items: snapshot.items,
        source: 'cache',
        stale: true,
        updatedAt: snapshot.updatedAt,
      };
    }

    return {
      items: DEMO_HOTLIST_ITEMS.map(item => ({ ...item })),
      source: 'demo',
      updatedAt: this.now(),
    };
  }

  /**
   * A snapshot read failure (database down, bad row) means "no snapshot" —
   * never a cache hit and never a silent success.
   */
  private async readSnapshotSafely(store: HotlistSnapshotStore): Promise<HotlistSnapshot | null> {
    try {
      return await store.read();
    } catch (err) {
      console.warn(
        '[hotlist] snapshot read failed — falling back to live/demo:',
        err instanceof Error ? err.message : String(err)
      );
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Route-facing factories — configured from the server env; no key → demo only
// ---------------------------------------------------------------------------

// Module-level process caches (#19: MVP is a single Node process; per-request
// providers reuse one cache so identical queries do not burn quota).
const searchCache = new TtlCache<Source[]>();
const hotlistCache = new TtlCache<HotlistItem[]>();

export function createZhihuSearchProvider(
  overrides: Partial<LiveSearchProviderOptions> = {}
): LiveSearchProvider {
  return new LiveSearchProvider({
    kind: 'zhihu_search',
    config: readZhihuApiConfig(),
    cache: searchCache,
    allowDemoFallback: false,
    ...overrides,
  });
}

export function createGlobalSearchProvider(
  overrides: Partial<LiveSearchProviderOptions> = {}
): LiveSearchProvider {
  return new LiveSearchProvider({
    kind: 'global_search',
    config: readZhihuApiConfig(),
    cache: searchCache,
    allowDemoFallback: false,
    ...overrides,
  });
}

export function createHotlistProvider(
  overrides: Partial<LiveHotlistProviderOptions> = {}
): LiveHotlistProvider {
  return new LiveHotlistProvider({
    config: readZhihuApiConfig(),
    cache: hotlistCache,
    allowDemoFallback: false,
    ...overrides,
  });
}
