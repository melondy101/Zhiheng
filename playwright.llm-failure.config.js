import { defineConfig, devices } from '@playwright/test';

// #20: browser-level LLM failure degradation E2E.
//
// This config runs SEQUENTIALLY after the main playwright.config.js (see the
// test:e2e script in package.json chains the two), so the two dev servers
// never coexist. It pins LLM_* env vars to ACTIVATE the real
// OpenAI-compatible provider against an unreachable endpoint
// (http://127.0.0.1:9 — instant connection refused, zero cost, zero network
// egress). Every question generation then fails twice and withFallback
// (src/lib/llm-fallback.ts) degrades to the strategy template — exactly the
// browser-level degradation the main config cannot exercise (it pins the
// env empty and always takes the fixture path).

export default defineConfig({
  testDir: './tests/e2e-llm',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3002',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npx cross-env PORT=3002 next dev',
    url: 'http://localhost:3002',
    reuseExistingServer: false,
    timeout: 60000,
    // Activate the real provider but guarantee failure: unreachable base URL
    // (connection refused), so withFallback always degrades to the template.
    env: {
      LLM_API_KEY: 'test-key',
      LLM_MODEL: 'test-model',
      LLM_BASE_URL: 'http://127.0.0.1:9',
    },
  },
});
