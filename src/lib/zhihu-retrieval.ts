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

export const DEFAULT_ZHIHU_API_BASE_URL = 'https://developer.zhihu.com';
export const RETRIEVAL_TTL_MS = 86_400_000; // 24 hours
export const DEFAULT_LIVE_TIMEOUT_MS = 5_000;

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
const TITLE_KEYS = ['title', 'question_title', 'question'] as const;
const EXCERPT_KEYS = ['excerpt', 'content', 'summary', 'answer_excerpt'] as const;
const AUTHOR_KEYS = ['author', 'author_name'] as const;
const URL_KEYS = ['url', 'link', 'question_url'] as const;
const ENVELOPE_KEYS = ['data', 'items', 'results', 'list'] as const;

/**
 * Extract the record array from a response body. Accepts a bare array or an
 * object envelope ({data|items|results|list: [...]}) — documented response
 * fields do not pin the envelope shape. Returns null when no array is found
 * (the caller degrades).
 */
export function extractItems(body: unknown): unknown[] | null {
  if (Array.isArray(body)) return body;
  if (typeof body === 'object' && body !== null) {
    const record = body as Record<string, unknown>;
    for (const key of ENVELOPE_KEYS) {
      const candidate = record[key];
      if (Array.isArray(candidate)) return candidate;
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
    } catch {
      // Timeout / network error / HTTP 401/403/429/451/5xx / invalid body —
      // degrade to the next level, never throw.
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

  // 3. deterministic demo fallback — never labeled 'live'.
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
  return {
    Authorization: `Bearer ${config.accessSecret}`,
    'X-Request-Timestamp': String(Math.floor(now() / 1000)),
    'Content-Type': 'application/json',
  };
}

/**
 * GET with both an abort signal (cancels a real fetch) and a hard timeout
 * race (a transport that ignores the signal still cannot stall the caller).
 * Non-200 status or unparseable JSON throws — the degradation core catches it.
 */
async function getJson(o: LiveCallOptions, path: string, query: string | null): Promise<unknown> {
  const url = query === null ? `${o.config.baseUrl}${path}` : `${o.config.baseUrl}${path}?${query}`;
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
    if (response.status !== 200) {
      throw new Error(`Zhihu API HTTP ${response.status}`);
    }
    return await response.json();
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

  constructor(options: LiveSearchProviderOptions) {
    this.kind = options.kind;
    this.config = options.config;
    this.transport = options.transport ?? defaultHttpTransport;
    this.cache = options.cache ?? new TtlCache<Source[]>({ ttlMs: options.ttlMs });
    this.timeoutMs = options.timeoutMs ?? DEFAULT_LIVE_TIMEOUT_MS;
    this.now = options.now ?? Date.now;
    this.count = options.count ?? 10;
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
          `Query=${encodeURIComponent(question.trim())}&Count=${this.count}`
        );
        const items = extractItems(body);
        if (items === null) throw new Error('Zhihu API returned an unexpected response shape');
        return items
          .map((item, index) => mapSearchSource(item, this.kind, queryHash, index))
          .filter((s): s is Source => s !== null);
      },
      isUsable: (sources) => sources.length > 0,
      demo: () => getDemoSources(question, demoType),
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

  constructor(options: LiveHotlistProviderOptions) {
    this.config = options.config;
    this.transport = options.transport ?? defaultHttpTransport;
    this.cache = options.cache ?? new TtlCache<HotlistItem[]>({ ttlMs: options.ttlMs });
    this.timeoutMs = options.timeoutMs ?? DEFAULT_LIVE_TIMEOUT_MS;
    this.now = options.now ?? Date.now;
  }

  /** Fetch the hotlist with the full degradation chain; never throws. */
  async fetchHotlist(): Promise<RetrievalHotlistResult> {
    const outcome = await retrieveWithDegradation({
      kind: 'hot_list',
      query: '', // the hotlist is one global feed — a single cache slot
      config: this.config,
      cache: this.cache,
      now: this.now,
      fetchLive: this.config === null ? null : async () => {
        const config = this.config;
        if (!config) throw new Error('Zhihu API is not configured');
        const body = await getJson(
          { config, transport: this.transport, timeoutMs: this.timeoutMs, now: this.now },
          HOTLIST_ENDPOINT,
          null
        );
        const items = extractItems(body);
        if (items === null) throw new Error('Zhihu API returned an unexpected response shape');
        return items
          .map((item, index) => mapHotlistItem(item, index))
          .filter((item): item is HotlistItem => item !== null)
          .slice(0, HOTLIST_LIMIT);
      },
      isUsable: (items) => items.length > 0,
      demo: () => DEMO_HOTLIST_ITEMS.map(item => ({ ...item })),
    });
    return {
      items: outcome.value,
      source: outcome.source,
      ...(outcome.stale !== undefined ? { stale: outcome.stale } : {}),
      updatedAt: outcome.updatedAt,
    };
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
    ...overrides,
  });
}

export function createHotlistProvider(
  overrides: Partial<LiveHotlistProviderOptions> = {}
): LiveHotlistProvider {
  return new LiveHotlistProvider({
    config: readZhihuApiConfig(),
    cache: hotlistCache,
    ...overrides,
  });
}
