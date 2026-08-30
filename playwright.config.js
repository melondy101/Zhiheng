import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3001',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npx cross-env PORT=3001 next dev',
    url: 'http://localhost:3001',
    reuseExistingServer: false,
    timeout: 60000,
    // E2E 恒走 fixture/模板路径：钉空 LLM_* 环境变量，防止本地 .env /
    // shell 中的真实密钥泄漏进测试而触发真实 HTTP 请求（消耗额度）。
    // readOpenAILLMConfig 对空串判"未配置"，工厂因此返回 FixtureLLMProvider。
    env: {
      LLM_API_KEY: '',
      LLM_MODEL: '',
      LLM_BASE_URL: '',
    },
  },
});
