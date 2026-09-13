// Ticket #26/R3: Demo Golden Path rewritten for PRD v4.2 §5 — gentle
// adaptive interrogation. The v4.1 fixed five-round strategy sequence
// and the 5/8/11 round checkpoints are gone. Each demo topic now drives
// three substantive answers, the summary gate, 生成总结, and a reload
// that restores the completed result card.

import { test, expect } from '@playwright/test';
import { DEMO_FIXTURES } from '../../src/lib/demo-fixtures';

const roundAnswer = (round: number) =>
  `第${round}轮的具体回答：结合报告中的来源给出明确例子与理由，不回避问题。`;

for (const fixture of DEMO_FIXTURES) {
  test.describe(`Demo Golden Path: ${fixture.category}`, () => {
    test(`three-round gentle flow on topic: ${fixture.topic}`, async ({ page }) => {
      await page.goto('/');
      await expect(page.locator('h1')).toContainText('知研');

      await page.click('summary:has-text("补充我的初步看法（可选）")');
      await page.fill('textarea#question', fixture.topic);
      await page.fill('[data-testid="initial-opinion-input"]', '我的初步看法');
      await page.click('button[type="submit"]');
      await expect(page).toHaveURL(/session=\w+/);

      // Wait for report (the report panel renders the synthesis headings).
      await expect(page.getByTestId('report-source-state')).toBeVisible({ timeout: 30_000 });
      await page.waitForLoadState('networkidle');

      // Ticket #18 honesty: the report panel labels demo data as demo.
      await expect(page.getByTestId('report-source-state')).toContainText('演示数据');

      // Choose a stance via the StanceSelector (added testid in #26/R3).
      await expect(page.getByTestId('stance-selector')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('stance-option').first().click();
      await expect(page.getByTestId('qa-panel')).toBeVisible({ timeout: 15_000 });

      // Three substantive answers open the 3-round summary gate.
      const answers = [1, 2, 3].map(roundAnswer);
      for (let i = 0; i < 3; i++) {
        await page.fill('[data-testid="answer-input"]', answers[i]!);
        await page.getByTestId('send-answer-button').click();
        await page.waitForTimeout(300);
      }
      await expect(page.getByTestId('summary-gate')).toBeVisible({ timeout: 30_000 });

      // 生成总结 builds the result card.
      await page.getByTestId('summary-gate-complete').click();
      await expect(page.locator('h3:has-text("思辨成果卡")')).toBeVisible({ timeout: 10_000 });

      // All three user answers survive in the result card.
      for (const a of answers) {
        await expect(page.getByText(a).first()).toBeVisible();
      }

      // Reload and verify persistence: card + three answers.
      const url = page.url();
      await page.reload();
      await expect(page.locator('h3:has-text("思辨成果卡")')).toBeVisible({ timeout: 10_000 });
      for (const a of answers) {
        await expect(page.getByText(a).first()).toBeVisible();
      }
      expect(url).toMatch(/session=\w+/);
    });
  });
}
