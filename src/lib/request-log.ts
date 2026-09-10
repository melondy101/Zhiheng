// Request-level diagnostics — emits one structured log line per outbound
// HTTP call (zhihu hot_list / zhihu_search / global_search / LLM chat).
//
// Privacy contract (operator-facing):
//   - Bearer tokens, access secrets, and api keys are NEVER printed.
//   - Headers are passed through maskSensitiveHeaders() before logging.
//   - Bodies / responses are clipped to BODY_PREVIEW_CHARS to avoid
//     dumping multi-megabyte LLM responses into the dev terminal.
//   - query strings are passed through redactQuery() so future secrets
//     in URLs (signed tokens, api keys) are caught by the same helper.
//
// The module is import-safe in tests (no side effects on import), matches
// the [startup] / [zhihu-retrieval] log style used elsewhere, and adds
// nothing to the client bundle (server-only).

const BODY_PREVIEW_CHARS = 240;

function maskValue(value: string, visibleHead = 4, visibleTail = 0): string {
  if (value.length <= visibleHead + visibleTail) return '***';
  return `${value.slice(0, visibleHead)}…(${value.length} chars)***`;
}

const SENSITIVE_HEADER_NAMES = new Set([
  'authorization',
  'x-api-key',
  'api-key',
  'x-auth-token',
  'cookie',
  'set-cookie',
]);

/** Replace bearer-style header values with a short prefix + length. */
export function maskSensitiveHeaders(
  headers: Record<string, string>
): Record<string, string> {
  const masked: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (SENSITIVE_HEADER_NAMES.has(name.toLowerCase())) {
      masked[name] = maskValue(value);
    } else {
      masked[name] = value;
    }
  }
  return masked;
}

/** Trim any query parameter that looks like a token/key. Preserves URL path. */
export function redactQuery(query: string | null): string | null {
  if (!query) return query;
  return query
    .replace(/(?:^|[&])(access_?token|access_?secret|api_?key|token|sig|signature)=[^&]*/gi, (_, prefix) => {
      const key = prefix.replace(/^[&]/, '');
      return `${key}=***`;
    });
}

/** First N chars of `body`, with a `…(N chars truncated)` suffix when clipped. */
export function previewBody(body: string | null | undefined): string {
  if (body === null || body === undefined) return '(empty)';
  if (body.length <= BODY_PREVIEW_CHARS) return body;
  return `${body.slice(0, BODY_PREVIEW_CHARS)}…(${body.length - BODY_PREVIEW_CHARS} chars truncated)`;
}

/** Build a single-line, structured "log line" payload as a plain object. */
export interface RequestLogLine {
  stage: 'zhihu_hotlist' | 'zhihu_search' | 'global_search' | 'llm_chat';
  phase: 'start' | 'success' | 'failure';
  url: string;
  method: 'GET' | 'POST';
  query?: string | null;
  headers: Record<string, string>;
  bodyPreview?: string;
  status?: number;
  contentType?: string | null;
  durationMs: number;
  responsePreview?: string;
  error?: string;
}

/**
 * Emit a request log line. The label keeps the output greppable alongside
 * the existing [startup] / [zhihu-retrieval] prefixes.
 */
export function logRequest(line: RequestLogLine): void {
  const tag = `[req:${line.stage}]`;
  if (line.phase === 'start') {
    // `url` already contains the query used by fetch. `query` is retained as
    // a redacted diagnostic field, so do not append it a second time here.
    console.log(`${tag} → ${line.method} ${line.url}`, {
      headers: line.headers,
      bodyPreview: line.bodyPreview,
    });
    return;
  }
  if (line.phase === 'success') {
    console.log(`${tag} ← ${line.status} (${line.durationMs}ms, ${line.contentType ?? 'unknown'})`, {
      responsePreview: line.responsePreview,
    });
    return;
  }
  console.warn(`${tag} × ${line.error} (after ${line.durationMs}ms)`, {
    status: line.status,
    responsePreview: line.responsePreview,
  });
}

/** Convenience timer — pass the start timestamp to mark/measure call sites. */
export function nowMs(): number {
  return Date.now();
}
