import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyZhihuError,
  classifyLLMError,
  buildServiceDiagnostics,
  REASON_LABELS,
} from '../../src/lib/service-diagnostics';

test('classifyZhihuError correctly identifies daily quota exhaustion', () => {
  const diag1 = classifyZhihuError('zhihu_hotlist', new Error('HTTP 40001: daily quota limit reached'));
  assert.equal(diag1.success, false);
  assert.equal(diag1.reason, 'daily_quota');
  assert.equal(diag1.reasonLabel, REASON_LABELS.daily_quota);

  const diag2 = classifyZhihuError('zhihu_search', new Error('今日调用次数超限 (error code 30002)'));
  assert.equal(diag2.success, false);
  assert.equal(diag2.reason, 'daily_quota');
});

test('classifyZhihuError correctly identifies rate limiting', () => {
  const diag1 = classifyZhihuError('zhihu_hotlist', new Error('429 Too Many Requests: Rate limit exceeded'));
  assert.equal(diag1.success, false);
  assert.equal(diag1.reason, 'rate_limit');
  assert.equal(diag1.reasonLabel, REASON_LABELS.rate_limit);

  const diag2 = classifyZhihuError('global_search', new Error('请求过于频繁，请稍后再试 (frequency limit 30001)'));
  assert.equal(diag2.success, false);
  assert.equal(diag2.reason, 'rate_limit');
});

test('classifyZhihuError correctly identifies unconfigured credentials', () => {
  const diag = classifyZhihuError('zhihu_search', new Error('ZHIHU_ACCESS_SECRET not configured'));
  assert.equal(diag.success, false);
  assert.equal(diag.reason, 'unconfigured');
  assert.equal(diag.reasonLabel, REASON_LABELS.unconfigured);
});

test('classifyZhihuError correctly identifies timeout and server errors', () => {
  const diagTimeout = classifyZhihuError('global_search', new Error('fetch failed: connection timeout abort'));
  assert.equal(diagTimeout.success, false);
  assert.equal(diagTimeout.reason, 'timeout');

  const diag500 = classifyZhihuError('zhihu_search', new Error('Internal Server Error'), 502);
  assert.equal(diag500.success, false);
  assert.equal(diag500.reason, 'server_error');
});

test('classifyZhihuError distinguishes a network failure from an upstream failure', () => {
  const diag = classifyZhihuError('zhihu_search', new TypeError('fetch failed: getaddrinfo ENOTFOUND developer.zhihu.com'));

  assert.equal(diag.success, false);
  assert.equal(diag.reason, 'network_error');
  assert.equal(diag.reasonLabel, REASON_LABELS.network_error);
});

test('classifyZhihuError identifies a successful call with no usable records', () => {
  const diag = classifyZhihuError('zhihu_hotlist', new Error('Zhihu API returned empty or unusable records'));

  assert.equal(diag.success, false);
  assert.equal(diag.reason, 'empty_result');
  assert.equal(diag.reasonLabel, REASON_LABELS.empty_result);
});

test('classifyLLMError correctly classifies AI service states', () => {
  const okDiag = classifyLLMError('ai_synthesis', null);
  assert.equal(okDiag.success, true);
  assert.equal(okDiag.reason, 'ok');

  const unconfiguredDiag = classifyLLMError('ai_synthesis', new Error('OPENAI_API_KEY / GEMINI_API_KEY is not configured'));
  assert.equal(unconfiguredDiag.success, false);
  assert.equal(unconfiguredDiag.reason, 'unconfigured');

  const rateLimitDiag = classifyLLMError('ai_synthesis', new Error('429 TPM/RPM rate limit exceeded'));
  assert.equal(rateLimitDiag.success, false);
  assert.equal(rateLimitDiag.reason, 'rate_limit');

  const quotaDiag = classifyLLMError('ai_synthesis', new Error('insufficient_quota: you exceeded your current quota'));
  assert.equal(quotaDiag.success, false);
  assert.equal(quotaDiag.reason, 'daily_quota');

  const timeoutDiag = classifyLLMError('ai_synthesis', new Error('Operation timed out after 30000ms'));
  assert.equal(timeoutDiag.success, false);
  assert.equal(timeoutDiag.reason, 'timeout');
});

test('buildServiceDiagnostics aggregates diagnostics and builds clean user summary', () => {
  const diagZhihu = classifyZhihuError('zhihu_search', new Error('daily quota reached'));
  const diagAI = classifyLLMError('ai_synthesis', null);

  const bundle = buildServiceDiagnostics({
    zhihuSearch: diagZhihu,
    aiSynthesis: diagAI,
  });

  assert.equal(bundle.allOk, false);
  assert.equal(bundle.degradedServices.length, 1);
  assert.equal(bundle.degradedServices[0].service, 'zhihu_search');
  assert.ok(bundle.summary.includes('知乎内容检索 API'));
  assert.ok(bundle.summary.includes('达到今日上限'));
});
