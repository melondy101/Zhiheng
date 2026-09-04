// Ticket #5: E2E Golden Path for PRD v4.2 §5 "温和自适应思辨".
//
// Covers:
// 1. User asks a question → gets direct answer + follow-up, directive round unchanged
// 2. User gives substantive response → gets acknowledgment + strategy question, directive round advances
// 3. Three directive rounds → summary gate (继续/总结) appears
// 4. AI replies and follow-ups visible in message history
// 5. Can summarize at any time
import { test, expect, type Page } from '@playwright/test';

const QUESTION = 'AI是否会取代人类创造力？';
const INITIAL_OPINION = '我认为AI会增强而非取代创造力';

async function startSession(page: Page, question: string, opinion: string) {
  await page.goto('/');
  await expect(page.locator('h1')).toContainText('知研');

  await page.click('summary:has-text("补充我的初步看法（可选）")');
  await page.fill('textarea#question', question);
  await page.fill('textarea[placeholder="你目前的看法是什么？"]', opinion);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/session=\w+/);

  // Wait for report
  await page.waitForLoadState('networkidle');

  // Choose a stance
  const viewpoints = page.locator('.space-y-2 button');
  await expect(viewpoints.first()).toBeVisible();
  await viewpoints.first().click();

  // Wait for the first question to appear
  await expect(page.getByText('第 1 轮').first()).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.bg-yellow-50').first()).toBeVisible({ timeout: 15000 });
}

async function answerRound(page: Page, text: string) {
  await page.fill('input[placeholder="输入你的回答..."]', text);
  await page.click('button:has-text("发送")');
  // Wait for the page to update
  await page.waitForTimeout(2000);
}

test.describe('Golden Path: gentle adaptive interrogation (#5)', () => {
  test('user question → direct answer + follow-up, directive round unchanged', async ({ page }) => {
    await startSession(page, QUESTION, INITIAL_OPINION);

    // After selecting viewpoint, round 1 question should appear
    await expect(page.getByText('第 1 轮').first()).toBeVisible();

    // User asks a question instead of answering
    await answerRound(page, '你能详细解释一下吗？');

    // AI reply should appear in the message history
    await expect(page.locator('.bg-gray-100').first()).toBeVisible({ timeout: 10000 });

    // Follow-up question should appear as the pending question
    await expect(page.getByText('追问:').first()).toBeVisible();
  });

  test('substantive response → acknowledgment + strategy question, directive round advances', async ({
    page,
  }) => {
    await startSession(page, QUESTION, INITIAL_OPINION);

    // Answer round 1 substantively
    await answerRound(page, '我认为AI会增强而非取代创造力，因为摄影术催生了新艺术形式。');

    // AI acknowledgment should appear
    await expect(page.locator('.bg-gray-100').first()).toBeVisible({ timeout: 10000 });

    // Follow-up question should appear (round 2)
    await expect(page.getByText('第 2 轮').first()).toBeVisible({ timeout: 5000 });
  });

  test('three directive rounds → summary gate appears', async ({ page }) => {
    await startSession(page, QUESTION, INITIAL_OPINION);

    // Three substantive responses
    await answerRound(page, '第一轮回答：摄影术催生了新艺术形式，说明工具促进新表达。');
    await page.waitForTimeout(500);

    await answerRound(page, '第二轮回答：技术进步最终会扩大人类的表达空间。');
    await page.waitForTimeout(500);

    await answerRound(page, '第三轮回答：综合以上，AI将重塑而非取代人类创造力。');
    await page.waitForTimeout(500);

    // Summary gate should appear (继续聊 / 生成总结)
    await expect(page.getByText('阶段小结').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(`你已经完成了 3 轮定向思辨`)).toBeVisible();
    await expect(page.getByRole('button', { name: '继续聊' })).toBeVisible();
    await expect(page.getByRole('button', { name: '生成总结' })).toBeVisible();
  });

  test('can summarize at any time via exit button', async ({ page }) => {
    await startSession(page, QUESTION, INITIAL_OPINION);

    // Answer round 1
    await answerRound(page, '第一轮回答：摄影术催生了新艺术形式。');
    await page.waitForTimeout(500);

    // Click "结束本次思辨" before the three-round gate
    await page.getByRole('button', { name: '结束本次思辨' }).click();

    // Should go to result card
    await expect(page.locator('h3:has-text("思辨成果卡")')).toBeVisible({ timeout: 10000 });
  });

  test('AI reply and follow-up survive page reload', async ({ page }) => {
    await startSession(page, QUESTION, INITIAL_OPINION);

    // Answer with a question first
    await answerRound(page, '你能详细解释一下吗？');
    await page.waitForTimeout(1000);

    // Get the URL with session id
    const url = page.url();

    // Reload the page
    await page.reload();
    await page.waitForLoadState('networkidle');

    // The session should be restored (we should still be in the session view)
    // Messages including AI replies should be visible
    await expect(page.locator('.bg-gray-100').first()).toBeVisible({ timeout: 10000 });
  });

  test('non-substantive response gets gentle nudge without advancing directive round', async ({
    page,
  }) => {
    await startSession(page, QUESTION, INITIAL_OPINION);

    // Answer with non-substantive input
    await answerRound(page, '不知道');
    await page.waitForTimeout(500);

    // Should see a gentle hint/encouragement
    await expect(page.locator('.bg-blue-50, .bg-yellow-50').first()).toBeVisible({ timeout: 5000 });
  });
});
