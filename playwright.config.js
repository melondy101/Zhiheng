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
    // `next dev -p` is cross-platform and avoids relying on an undeclared
    // cross-env binary in CI.
    command: 'npx next dev -p 3001',
    url: 'http://localhost:3001',
    reuseExistingServer: false,
    timeout: 60000,
    // E2E 恒走 fixture/模板路径：钉空 LLM_* 环境变量，防止本地 .env /
    // shell 中的真实密钥泄漏进测试而触发真实 HTTP 请求（消耗额度）。
    // readOpenAILLMConfig 对空串判"未配置"，工厂因此返回 FixtureLLMProvider。
    // #21: 同理钉空 DATABASE_URL —— E2E 恒走进程内存储路径，绝不连接真实
    // Neon 数据库（readServerStorageConfig 对空串判"未配置"）。
    env: {
      LLM_API_KEY: '',
      LLM_MODEL: '',
      LLM_BASE_URL: '',
      DATABASE_URL: '',
      // E2E 恒走 fixture/模板路径：钉空 Zhihu 密钥防止真实网络请求消耗额度。
      ZHIHU_ACCESS_SECRET: '',
      ZHIHU_API_BASE_URL: '',
    },
  },
});
