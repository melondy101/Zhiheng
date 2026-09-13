import { test, expect } from '@playwright/test';

// #20: browser-level LLM failure degradation golden path.
//
// The webServer in playwright.llm-failure.config.js starts the app with the
// REAL OpenAI-compatible provider pointed at http://127.0.0.1:9 (instant
// connection refused — zero cost, zero network egress). Every question
// generation fails twice, and withFallback (src/lib/llm-fallback.ts) degrades
// to the strategy template, which carries the honest 【策略模板降级】
// disclosure (src/lib/strategy-engine.ts). The unit/integration suites cover
// these seams without a browser; this spec proves them end-to-end in the UI:
//   (a) the assistant question IS the strategy template (marker + template
//       body), (b) the QAPanel fallback notice is visible, (c) after one
//       answered round the user's answer is kept and the round advances.

const ANSWER_1 = '第一轮回答：我引用报告里的具体数据来支持我目前的看法。';

test('LLM failure degrades to the strategy template and preserves the round', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('h1')).toContainText('知研');

  // Minimal flow: enter a question and generate the demo report (the demo
  // retrieval path is unaffected by the LLM env).
  await page.click('summary:has-text("补充我的初步看法（可选）")');
  await page.fill('textarea#question', '大模型幻觉问题有多严重？');
  await page.fill('[data-testid="initial-opinion-input"]', '我认为大模型幻觉被夸大了');
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/session=\w+/);
  // 该配置下 LLM 恒失败，报告不会产出综合观点（report-viewpoints-heading
  // 不渲染）。用 stance-selector 作为「报告已就绪」的锚点。
  await expect(page.getByTestId('stance-selector')).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState('networkidle');

  // Select a stance -> the round 1 question is generated (LLM fails twice).
  const viewpoints = page.getByTestId('stance-option');
  await expect(viewpoints.first()).toBeVisible();
  await viewpoints.first().click();

  // (a) The assistant question is the strategy template: it carries the
  //     honest degradation marker and the M1 evidence template body
  //     (round 1 is always 证据追问; both the plain and the claim-quoting
  //     variants contain "数据或例子").
  //     The question text appears both in the message list (persisted assistant
  //     message) and in the current question panel; target the first one.
  const question = page.getByText('【策略模板降级】').first();
  await expect(question).toBeVisible();
  await expect(question).toContainText('数据或例子');

  // (b) The QAPanel degradation notice is visible.
  await expect(page.getByText('AI 服务异常，已使用策略模板')).toBeVisible();

  // (c) Answer one round: the answer is kept, the round advances, and the
  //     round 2 question (前提追问) is template-degraded again.
  await page.fill('[data-testid="answer-input"]', ANSWER_1);
  await page.getByTestId('send-answer-button').click();
  await expect(page.getByText(ANSWER_1).first()).toBeVisible();
  await expect(page.getByText('第 2 轮').first()).toBeVisible();
  await expect(page.getByText('【策略模板降级】').first()).toBeVisible();
});
