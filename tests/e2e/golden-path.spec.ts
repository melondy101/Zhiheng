import { test, expect } from '@playwright/test';

const QUESTION = 'AI是否会取代人类创造力？';
const INITIAL_OPINION = '我认为AI会增强而非取代创造力';
const ANSWER = '例如摄影技术没有消灭绘画，而是催生了新的艺术表达。';

test.describe('Golden Path: minimal reasoning loop', () => {
  test('full flow: question -> opinion -> report -> stance -> exchange -> result card -> reload -> persist', async ({ page }) => {
    // Step 1: Open home page
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('知研');

    // Step 2: Expand initial opinion and enter question + opinion
    await page.click('summary:has-text("补充我的初步看法（可选）")');
    await page.fill('textarea#question', QUESTION);
    await page.fill('textarea[placeholder="你目前的看法是什么？"]', INITIAL_OPINION);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/session=\w+/);

    // Step 3: Verify fixture report appears
    await expect(page.locator('h2')).toContainText(QUESTION);
    await expect(page.locator('text=核心知识点')).toBeVisible();

    // Step 4: Choose a stance (select first viewpoint)
    const viewpoints = page.locator('.space-y-2 button');
    await expect(viewpoints.first()).toBeVisible();
    await viewpoints.first().click();

    // Step 5: Complete one exchange (answer the question)
    await page.fill('input[placeholder="输入你的回答..."]', ANSWER);
    await page.click('button:has-text("发送")');

    // Wait for result card to show
    await expect(page.locator('h3:has-text("思辨成果卡")')).toBeVisible({ timeout: 10000 });

    // Step 6: Verify each section of result card separately
    await expect(page.locator('text=最初立场')).toBeVisible();
    await expect(page.locator('text=选择的初始立场')).toBeVisible();
    await expect(page.locator('text=最终观点')).toBeVisible();

    // Step 7: Verify initial opinion is preserved
    await expect(page.locator(`text=${INITIAL_OPINION}`)).toBeVisible();
    await expect(page.getByText(ANSWER, { exact: true })).toBeVisible();

    // Step 8: Record session URL and reload
    const currentUrl = page.url();
    await page.reload();

    // Step 9: Verify persisted content after reload
    await expect(page.locator('h3:has-text("思辨成果卡")')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=最初立场')).toBeVisible();
    await expect(page.locator('text=选择的初始立场')).toBeVisible();
    await expect(page.locator('text=最终观点')).toBeVisible();
    await expect(page.locator(`text=${INITIAL_OPINION}`)).toBeVisible();
    await expect(page.getByText(ANSWER, { exact: true })).toBeVisible();

    // Step 10: Verify the session ID is in the URL (reopen behavior)
    expect(currentUrl).toMatch(/session=\w+/);
  });
});
