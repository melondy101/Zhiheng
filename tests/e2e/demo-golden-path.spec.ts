import { test, expect } from '@playwright/test';
import { DEMO_FIXTURES } from '../../src/lib/demo-fixtures';

// The standard five-round sequence (ticket #14): M1 → M2 → M4 → M6 → M5.
const STRATEGY_SEQUENCE = ['证据追问', '前提追问', '钢铁人反驳', '立场反转', '观点重述'];

const roundAnswer = (round: number) =>
  `第${round}轮的具体回答：结合报告中的来源给出明确例子与理由，不回避问题。`;

for (const fixture of DEMO_FIXTURES) {
  test.describe(`Demo Golden Path: ${fixture.category}`, () => {
    test(`five-round flow on topic: ${fixture.topic}`, async ({ page }) => {
      await page.goto('/');
      await expect(page.locator('h1')).toContainText('知研');

      await page.click('summary:has-text("补充我的初步看法（可选）")');
      await page.fill('textarea#question', fixture.topic);
      await page.fill('textarea[placeholder="你目前的看法是什么？"]', '我的初步看法');
      await page.click('button[type="submit"]');
      await expect(page).toHaveURL(/session=\w+/);

      // Wait for report
      await expect(page.locator('text=核心知识点')).toBeVisible({ timeout: 15000 });
      await page.waitForLoadState('networkidle');

      // Ticket #18 honesty: the report panel labels demo data as demo.
      await expect(page.getByTestId('report-source-state')).toContainText('演示数据');

      // Choose a stance
      const viewpoints = page.locator('.space-y-2 button');
      await expect(viewpoints.first()).toBeVisible();
      await viewpoints.first().click();

      // Five rounds in the fixed strategy order.
      const answers = [1, 2, 3, 4, 5].map(roundAnswer);
      for (let i = 0; i < 5; i++) {
        await expect(page.getByText(STRATEGY_SEQUENCE[i]!)).toBeVisible();
        await expect(page.getByText(`第 ${i + 1} 轮`).first()).toBeVisible();
        await page.fill('input[placeholder="输入你的回答..."]', answers[i]!);
        await page.click('button:has-text("发送")');
      }

      // Checkpoint decision after round 5, then end -> result card.
      await expect(page.getByText('阶段小结')).toBeVisible();
      await page.getByRole('button', { name: '结束并生成成果卡' }).click();
      await expect(page.locator('h3:has-text("思辨成果卡")')).toBeVisible({ timeout: 10000 });

      // All five user answers survive in the result card.
      for (const a of answers) {
        await expect(page.getByText(a).first()).toBeVisible();
      }

      // Reload and verify persistence: card + five answers.
      const url = page.url();
      await page.reload();
      await expect(page.locator('h3:has-text("思辨成果卡")')).toBeVisible({ timeout: 10000 });
      for (const a of answers) {
        await expect(page.getByText(a).first()).toBeVisible();
      }
      expect(url).toMatch(/session=\w+/);
    });
  });
}
