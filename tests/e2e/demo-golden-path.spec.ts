import { test, expect } from '@playwright/test';
import { DEMO_FIXTURES } from '../../src/lib/demo-fixtures';

for (const fixture of DEMO_FIXTURES) {
  test.describe(`Demo Golden Path: ${fixture.category}`, () => {
    test(`full flow on topic: ${fixture.topic}`, async ({ page }) => {
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

      // Choose a stance
      const viewpoints = page.locator('.space-y-2 button');
      await expect(viewpoints.first()).toBeVisible();
      await viewpoints.first().click();

      // Submit an answer
      await page.fill('input[placeholder="输入你的回答..."]', '我的具体回答');
      await page.click('button:has-text("发送")');

      // Result card visible
      await expect(page.locator('h3:has-text("思辨成果卡")')).toBeVisible({ timeout: 10000 });

      // Reload and verify persistence
      const url = page.url();
      await page.reload();
      await expect(page.locator('h3:has-text("思辨成果卡")')).toBeVisible({ timeout: 10000 });
      expect(url).toMatch(/session=\w+/);
    });
  });
}
