// Diagnostic classification for Zhihu retrieval (search/hotlist) and AI services.
// Provides precise reason classification for UI display and backend logging.

export type DiagnosticReason =
  | 'ok'
  | 'daily_quota'       // 到达今日上限 (Daily Quota)
  | 'rate_limit'        // 到达 rate_limit / 频率限制 (Rate Limit)
  | 'unconfigured'      // 未配置 API Key / Secret
  | 'auth_failed'       // 鉴权失败 / Key 无效 (401 / 20001)
  | 'timeout'           // 请求超时
  | 'network_error'     // DNS、连接或 TLS 失败
  | 'server_error'      // 服务端异常 (5xx)
  | 'invalid_response'  // 返回非预期格式 / JSON解析异常
  | 'empty_result'      // 返回空可用数据
  | 'other';            // 其它原因

export interface ServiceDiagnostic {
  service: 'zhihu_hotlist' | 'zhihu_search' | 'global_search' | 'ai_synthesis' | 'ai_graph' | 'ai_chat';
  serviceName: string;
  success: boolean;
  reason: DiagnosticReason;
  reasonLabel: string;
  message: string;
  detail?: string;
  statusCode?: number;
  errorCode?: number | string;
  timestamp: number;
}

export const REASON_LABELS: Record<DiagnosticReason, string> = {
  ok: '正常',
  daily_quota: '达到今日上限',
  rate_limit: '达到频率限制 (Rate Limit)',
  unconfigured: '未配置秘钥',
  auth_failed: '鉴权认证失败',
  timeout: '请求超时',
  network_error: '网络连接异常',
  server_error: '服务提供商异常',
  invalid_response: '数据格式异常',
  empty_result: '未找到匹配结果',
  other: '调用异常',
};

const SERVICE_NAMES: Record<ServiceDiagnostic['service'], string> = {
  zhihu_hotlist: '知乎热榜 API',
  zhihu_search: '知乎内容检索 API',
  global_search: '全网检索 API',
  ai_synthesis: 'AI 研报多观点提炼',
  ai_graph: 'AI 知识图谱生成',
  ai_chat: 'AI 诘问对话引擎',
};

/** Classify error for Zhihu Open Platform endpoints (search & hotlist) */
export function classifyZhihuError(
  service: 'zhihu_hotlist' | 'zhihu_search' | 'global_search',
  err: unknown,
  status?: number,
  responsePreview?: string
): ServiceDiagnostic {
  const errMsg = err instanceof Error ? err.message : String(err ?? '');
  const combined = `${errMsg} ${responsePreview ?? ''}`.toLowerCase();
  const serviceName = SERVICE_NAMES[service];
  const now = Date.now();

  if (!errMsg && !status) {
    return {
      service,
      serviceName,
      success: true,
      reason: 'ok',
      reasonLabel: REASON_LABELS.ok,
      message: `${serviceName} 响应正常`,
      timestamp: now,
    };
  }

  if (errMsg.includes('not configured') || errMsg.includes('未配置')) {
    return {
      service,
      serviceName,
      success: false,
      reason: 'unconfigured',
      reasonLabel: REASON_LABELS.unconfigured,
      message: `未配置知乎 API 访问秘钥 (ZHIHU_ACCESS_SECRET)，已使用演示数据`,
      detail: errMsg,
      timestamp: now,
    };
  }

  // Check for daily quota exceeded
  const isDailyQuota =
    combined.includes('quota') ||
    combined.includes('daily') ||
    combined.includes('今日') ||
    combined.includes('配额') ||
    combined.includes('上限') ||
    combined.includes('超限') ||
    combined.includes('30002') ||
    combined.includes('30003') ||
    combined.includes('40001');

  if (isDailyQuota) {
    return {
      service,
      serviceName,
      success: false,
      reason: 'daily_quota',
      reasonLabel: REASON_LABELS.daily_quota,
      message: `${serviceName} 已达到今日调用配额上限 (Daily Quota Exceeded)`,
      detail: errMsg,
      statusCode: status,
      timestamp: now,
    };
  }

  // Check for rate limit (429 or 30001 or rate limit message)
  const isRateLimit =
    status === 429 ||
    combined.includes('rate limit') ||
    combined.includes('rate_limit') ||
    combined.includes('too many') ||
    combined.includes('frequency') ||
    combined.includes('频繁') ||
    combined.includes('频率') ||
    combined.includes('30001');

  if (isRateLimit) {
    return {
      service,
      serviceName,
      success: false,
      reason: 'rate_limit',
      reasonLabel: REASON_LABELS.rate_limit,
      message: `${serviceName} 已达到请求频率限制 (Rate Limit - 429)`,
      detail: errMsg,
      statusCode: status ?? 429,
      timestamp: now,
    };
  }

  // Check for Auth failure
  if (
    status === 401 ||
    status === 403 ||
    combined.includes('20001') ||
    combined.includes('authorization failed') ||
    combined.includes('unauthorized') ||
    combined.includes('forbidden') ||
    combined.includes('invalid secret') ||
    combined.includes('token') ||
    combined.includes('auth')
  ) {
    return {
      service,
      serviceName,
      success: false,
      reason: 'auth_failed',
      reasonLabel: REASON_LABELS.auth_failed,
      message: `${serviceName} 鉴权失败，请检查 ZHIHU_ACCESS_SECRET 有效性`,
      detail: errMsg || '知乎 API 鉴权未通过 (Authorization failed: 20001)',
      statusCode: status ?? 401,
      errorCode: 20001,
      timestamp: now,
    };
  }

  // An upstream request that completed without usable records is not a transport or format failure.
  if (combined.includes('empty or unusable records') || combined.includes('empty result')) {
    return {
      service,
      serviceName,
      success: false,
      reason: 'empty_result',
      reasonLabel: REASON_LABELS.empty_result,
      message: `${serviceName} 未返回可用内容`,
      detail: errMsg,
      statusCode: status,
      timestamp: now,
    };
  }

  // Timeout
  if (combined.includes('timeout') || combined.includes('aborted') || status === 504) {
    return {
      service,
      serviceName,
      success: false,
      reason: 'timeout',
      reasonLabel: REASON_LABELS.timeout,
      message: `${serviceName} 请求超时，上游接口未在限定时间内响应`,
      detail: errMsg,
      statusCode: status,
      timestamp: now,
    };
  }

  // Connection failures occur before the upstream can return an HTTP response.
  if (
    !status &&
    (combined.includes('fetch failed') || combined.includes('network error') || combined.includes('enotfound') || combined.includes('econnrefused') || combined.includes('econnreset') || combined.includes('certificate') || combined.includes('tls'))
  ) {
    return {
      service,
      serviceName,
      success: false,
      reason: 'network_error',
      reasonLabel: REASON_LABELS.network_error,
      message: `${serviceName} 网络连接异常，未能连接到上游服务`,
      detail: errMsg,
      timestamp: now,
    };
  }

  // Server Error
  if ((status && status >= 500) || combined.includes('500') || combined.includes('502') || combined.includes('503')) {
    return {
      service,
      serviceName,
      success: false,
      reason: 'server_error',
      reasonLabel: REASON_LABELS.server_error,
      message: `${serviceName} 远端服务端异常 (HTTP ${status ?? 500})`,
      detail: errMsg,
      statusCode: status,
      timestamp: now,
    };
  }

  // Non-JSON or bad format
  if (combined.includes('non-json') || combined.includes('unexpected response shape')) {
    return {
      service,
      serviceName,
      success: false,
      reason: 'invalid_response',
      reasonLabel: REASON_LABELS.invalid_response,
      message: `${serviceName} 返回非预期的数据格式`,
      detail: errMsg,
      statusCode: status,
      timestamp: now,
    };
  }

  return {
    service,
    serviceName,
    success: false,
    reason: 'other',
    reasonLabel: REASON_LABELS.other,
    message: `${serviceName} 调用失败: ${errMsg || '未知异常'}`,
    detail: errMsg,
    statusCode: status,
    timestamp: now,
  };
}

/** Classify error for AI LLM services (Synthesis / Graph / Interrogate) */
export function classifyLLMError(
  service: 'ai_synthesis' | 'ai_graph' | 'ai_chat',
  err: unknown,
  status?: number
): ServiceDiagnostic {
  const errMsg = err instanceof Error ? err.message : String(err ?? '');
  const combined = errMsg.toLowerCase();
  const serviceName = SERVICE_NAMES[service];
  const now = Date.now();

  if (!errMsg && !status) {
    return {
      service,
      serviceName,
      success: true,
      reason: 'ok',
      reasonLabel: REASON_LABELS.ok,
      message: `${serviceName} 服务正常`,
      timestamp: now,
    };
  }

  if (combined.includes('not configured') || combined.includes('未配置') || combined.includes('no key') || combined.includes('missing api key')) {
    return {
      service,
      serviceName,
      success: false,
      reason: 'unconfigured',
      reasonLabel: REASON_LABELS.unconfigured,
      message: `未配置大模型 API 秘钥或模型 (LLM_API_KEY / LLM_MODEL)`,
      detail: errMsg,
      timestamp: now,
    };
  }

  // Insufficient quota / Billing / Daily limit
  const isDailyQuota =
    combined.includes('insufficient_quota') ||
    combined.includes('quota') ||
    combined.includes('billing') ||
    combined.includes('credit') ||
    combined.includes('余额') ||
    combined.includes('配额') ||
    combined.includes('上限') ||
    combined.includes('欠费');

  if (isDailyQuota) {
    return {
      service,
      serviceName,
      success: false,
      reason: 'daily_quota',
      reasonLabel: REASON_LABELS.daily_quota,
      message: `AI 服务配额不足或已达到今日调用上限 (Quota Exceeded)`,
      detail: errMsg,
      statusCode: status,
      timestamp: now,
    };
  }

  // Rate limit
  const isRateLimit =
    status === 429 ||
    combined.includes('rate limit') ||
    combined.includes('rate_limit') ||
    combined.includes('too many') ||
    combined.includes('429');

  if (isRateLimit) {
    return {
      service,
      serviceName,
      success: false,
      reason: 'rate_limit',
      reasonLabel: REASON_LABELS.rate_limit,
      message: `AI 服务达到请求频率限制 (Rate Limit - 429)`,
      detail: errMsg,
      statusCode: status ?? 429,
      timestamp: now,
    };
  }

  // Auth failed
  if (status === 401 || combined.includes('401') || combined.includes('invalid_api_key') || combined.includes('unauthorized') || combined.includes('authentication')) {
    return {
      service,
      serviceName,
      success: false,
      reason: 'auth_failed',
      reasonLabel: REASON_LABELS.auth_failed,
      message: `AI 服务 API Key 无效或未通过鉴权 (401 Unauthorized)`,
      detail: errMsg,
      statusCode: status ?? 401,
      timestamp: now,
    };
  }

  // Timeout
  if (combined.includes('timeout') || combined.includes('timed out') || combined.includes('aborted') || status === 504) {
    return {
      service,
      serviceName,
      success: false,
      reason: 'timeout',
      reasonLabel: REASON_LABELS.timeout,
      message: `AI 服务请求超时，未能在规定时间内完成推理`,
      detail: errMsg,
      statusCode: status,
      timestamp: now,
    };
  }

  // Non-conforming response / parse failure
  if (combined.includes('non-json') || combined.includes('invalid_response') || combined.includes('parse') || combined.includes('non-conforming')) {
    return {
      service,
      serviceName,
      success: false,
      reason: 'invalid_response',
      reasonLabel: REASON_LABELS.invalid_response,
      message: `AI 服务返回内容格式不符合要求，未能提取有效观点`,
      detail: errMsg,
      statusCode: status,
      timestamp: now,
    };
  }

  // Server error
  if ((status && status >= 500) || combined.includes('500') || combined.includes('502') || combined.includes('503')) {
    return {
      service,
      serviceName,
      success: false,
      reason: 'server_error',
      reasonLabel: REASON_LABELS.server_error,
      message: `AI 模型服务提供商异常 (HTTP ${status ?? 500})`,
      detail: errMsg,
      statusCode: status,
      timestamp: now,
    };
  }

  return {
    service,
    serviceName,
    success: false,
    reason: 'other',
    reasonLabel: REASON_LABELS.other,
    message: `AI 服务调用异常: ${errMsg || '未知错误'}`,
    detail: errMsg,
    statusCode: status,
    timestamp: now,
  };
}

export interface ServiceDiagnosticBundle {
  allOk: boolean;
  diagnostics: Record<string, ServiceDiagnostic>;
  degradedServices: ServiceDiagnostic[];
  summary: string;
}

export function buildServiceDiagnostics(
  diagnostics: Record<string, ServiceDiagnostic | undefined>
): ServiceDiagnosticBundle {
  const validMap: Record<string, ServiceDiagnostic> = {};
  const degraded: ServiceDiagnostic[] = [];

  for (const [key, diag] of Object.entries(diagnostics)) {
    if (diag) {
      validMap[key] = diag;
      if (!diag.success || diag.reason !== 'ok') {
        degraded.push(diag);
      }
    }
  }

  const allOk = degraded.length === 0;
  let summary = '所有服务运行正常';

  if (!allOk) {
    const reasons = degraded.map(d => `${d.serviceName}: ${d.reasonLabel} (${d.message})`);
    summary = `部分服务发生降级：${reasons.join('；')}`;
  }

  return {
    allOk,
    diagnostics: validMap,
    degradedServices: degraded,
    summary,
  };
}

