import { NextResponse } from 'next/server';
import { AnonymousIdentityProvider } from '@/lib/fixture-providers';
import { getServerStorage } from '@/lib/server-storage';
import { readZhihuApiConfig } from '@/lib/zhihu-retrieval';
import { readOpenAILLMConfig } from '@/lib/openai-llm-provider';

const identityProvider = new AnonymousIdentityProvider();

export const runtime = 'nodejs';

export async function GET() {
  const identity = await identityProvider.getCurrentIdentity();
  const serverStorage = await getServerStorage();
  const zhihuConfig = readZhihuApiConfig();
  const llmConfig = readOpenAILLMConfig();
  const graphLlmConfigured = Boolean(
    process.env.GRAPH_LLM_API_KEY?.trim() && process.env.GRAPH_LLM_MODEL?.trim()
  );

  return NextResponse.json({
    status: 'ok',
    identity,
    timestamp: new Date().toISOString(),
    remotePersistence: serverStorage.mode === 'postgres',
    // Retrieval configuration
    retrieval: {
      configured: !!zhihuConfig,
      hasSecret: !!process.env.ZHIHU_ACCESS_SECRET?.trim(),
      baseUrl: zhihuConfig?.baseUrl || 'default (developer.zhihu.com)',
      // Do not log the actual secret value
    },
    // LLM configuration
    llm: {
      configured: !!llmConfig,
      hasApiKey: !!process.env.LLM_API_KEY?.trim(),
      hasModel: !!process.env.LLM_MODEL?.trim(),
      model: llmConfig?.model || 'not configured',
      baseUrl: llmConfig?.baseUrl || 'default (api.openai.com/v1)',
      timeoutMs: llmConfig?.timeoutMs || 10000,
      synthesisTimeoutMs: llmConfig?.synthesisTimeoutMs || 45000,
      // Do not log the actual API key value
    },
    graphLlm: {
      configured: graphLlmConfigured,
      model: process.env.GRAPH_LLM_MODEL?.trim() || 'not configured',
      baseUrl: process.env.GRAPH_LLM_BASE_URL?.trim() || 'default (api.openai.com/v1)',
      timeoutMs: Number(process.env.GRAPH_LLM_TIMEOUT_MS?.trim()) || 45_000,
    },
    // Environment variable presence (boolean only, no values)
    env: {
      ZHIHU_ACCESS_SECRET: !!process.env.ZHIHU_ACCESS_SECRET?.trim(),
      LLM_API_KEY: !!process.env.LLM_API_KEY?.trim(),
      LLM_MODEL: !!process.env.LLM_MODEL?.trim(),
      LLM_BASE_URL: !!process.env.LLM_BASE_URL?.trim(),
      GRAPH_LLM_API_KEY: !!process.env.GRAPH_LLM_API_KEY?.trim(),
      DATABASE_URL: !!process.env.DATABASE_URL?.trim(),
    },
  });
}
