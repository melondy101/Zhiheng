// Startup diagnostics — logs the retrieval/LLM environment on first import.
// Safe to import from any server-only module.

let logged = false;

export function logStartupPath() {
  if (logged) return;
  logged = true;

  const zhihuSecret = process.env.ZHIHU_ACCESS_SECRET?.trim();
  const zhihuBaseUrl = process.env.ZHIHU_API_BASE_URL?.trim();
  const llmApiKey = process.env.LLM_API_KEY?.trim();
  const llmModel = process.env.LLM_MODEL?.trim();
  const llmBaseUrl = process.env.LLM_BASE_URL?.trim();
  const llmTimeout = process.env.LLM_TIMEOUT_MS?.trim();
  const llmSynthTimeout = process.env.LLM_SYNTHESIS_TIMEOUT_MS?.trim();
  const graphLlmKey = process.env.GRAPH_LLM_API_KEY?.trim();
  const graphLlmModel = process.env.GRAPH_LLM_MODEL?.trim();
  const graphLlmUrl = process.env.GRAPH_LLM_BASE_URL?.trim();
  const databaseUrl = process.env.DATABASE_URL?.trim();

  console.log('[startup] ===== 知研 启动路径 =====');
  console.log(`[startup] 知乎检索: ${zhihuSecret ? '✅ 已配置 (secret=' + zhihuSecret.slice(0, 4) + '...)' : '❌ 未配置 (将使用Demo数据)'}`);
  console.log(`[startup] 知乎API地址: ${zhihuBaseUrl || '默认 (developer.zhihu.com)'}`);
  console.log(`[startup] LLM API: ${(llmApiKey && llmModel) ? '✅ 已配置 (key=' + llmApiKey.slice(0, 4) + '..., model=' + llmModel + ')' : '❌ 未配置 (将使用Fixture生成器)'}`);
  console.log(`[startup] LLM Base URL: ${llmBaseUrl || '默认 (api.openai.com/v1)'}`);
  console.log(`[startup] LLM Timeout: ${llmTimeout || '默认 10000'}ms`);
  console.log(`[startup] LLM Synthesis Timeout: ${llmSynthTimeout || '默认 45000'}ms`);
  console.log(`[startup] 图谱 LLM: ${(graphLlmKey && graphLlmModel) ? '✅ 已配置 (model=' + graphLlmModel + ')' : '❌ 未配置'}`);
  console.log(`[startup] 图谱 LLM Base URL: ${graphLlmUrl || '默认 (api.openai.com/v1)'}`);
  console.log(`[startup] 数据库: ${databaseUrl ? '✅ PostgreSQL (Neon)' : '❌ 未配置 (进程内Memory存储)'}`);
  console.log(`[startup] ============================`);
}
