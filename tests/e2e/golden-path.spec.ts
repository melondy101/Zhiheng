import { test, expect, type Page } from '@playwright/test';

const QUESTION = 'AI是否会取代人类创造力？';
const INITIAL_OPINION = '我认为AI会增强而非取代创造力';

// The standard five-round sequence (ticket #14): M1 → M2 → M4 → M6 → M5.
const STRATEGY_SEQUENCE = ['证据追问', '前提追问', '钢铁人反驳', '立场反转', '观点重述'];

const ANSWERS = [
  '第一个回答：摄影术没有消灭绘画，反而催生了全新的艺术表达形式。',
  '第二个回答：我的前提是技术进步最终会扩大人类的表达空间。',
  '第三个回答：最强的反驳是AI批量生成内容会稀释创作的稀缺性。',
  '第四个回答：如果为相反立场辩护，我会说效率提升本身就是一种价值。',
  '第五个回答：综合以上讨论，我认为AI将重塑而非取代人类创造力。',
];

async function startSession(page: Page, question: string, opinion: string) {
  await page.goto('/');
  await expect(page.locator('h1')).toContainText('知研');

  await page.click('summary:has-text("补充我的初步看法（可选）")');
  await page.fill('textarea#question', question);
  await page.fill('textarea[placeholder="你目前的看法是什么？"]', opinion);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/session=\w+/);

  await expect(page.locator('h2')).toContainText(question);
  await page.waitForLoadState('networkidle');
  await expect(page.locator('h3:has-text("核心知识点")')).toBeVisible({ timeout: 15000 });

  const viewpoints = page.locator('.space-y-2 button');
  await expect(viewpoints.first()).toBeVisible();
  await viewpoints.first().click();
}

async function answerRound(page: Page, round: number, text: string) {
  // The header must show the expected strategy tag for this round.
  await expect(page.getByText(STRATEGY_SEQUENCE[round - 1]!)).toBeVisible();
  await expect(page.getByText(`第 ${round} 轮`).first()).toBeVisible();
  await page.fill('input[placeholder="输入你的回答..."]', text);
  await page.click('button:has-text("发送")');
}

test.describe('Golden Path: five-round interrogation state machine', () => {
  test('five rounds -> checkpoint -> end -> result card keeps all five answers', async ({ page }) => {
    await startSession(page, QUESTION, INITIAL_OPINION);

    // Rounds 1-5 in the fixed strategy order.
    for (let i = 0; i < 5; i++) {
      await answerRound(page, i + 1, ANSWERS[i]!);
    }

    // Checkpoint decision appears after the 5th answer (not before).
    await expect(page.getByText('阶段小结')).toBeVisible();
    await expect(page.getByRole('button', { name: '继续' })).toBeVisible();
    await expect(page.getByRole('button', { name: '结束并生成成果卡' })).toBeVisible();

    // Choose "end" -> result card.
    await page.getByRole('button', { name: '结束并生成成果卡' }).click();
    await expect(page.locator('h3:has-text("思辨成果卡")')).toBeVisible({ timeout: 10000 });

    // The card must be built from the five saved user answers:
    // answers 1-4 appear as new evidence, answer 5 as the final position.
    await expect(page.locator('h4:has-text("初始表达")')).toBeVisible();
    await expect(page.locator('h4:has-text("起始立场")')).toBeVisible();
    await expect(page.locator('h4:has-text("新增证据")')).toBeVisible();
    await expect(page.locator('h4:has-text("最终观点")')).toBeVisible();
    for (const a of ANSWERS) {
      await expect(page.getByText(a).first()).toBeVisible();
    }
    await expect(page.getByText(INITIAL_OPINION).first()).toBeVisible();

    // Reload: the completed session still shows the card with all five answers.
    await page.reload();
    await expect(page.locator('h3:has-text("思辨成果卡")')).toBeVisible({ timeout: 10000 });
    for (const a of ANSWERS) {
      await expect(page.getByText(a).first()).toBeVisible();
    }
  });

  test('checkpoint "continue" -> round 6 question appears', async ({ page }) => {
    await startSession(page, QUESTION, INITIAL_OPINION);

    for (let i = 0; i < 5; i++) {
      await answerRound(page, i + 1, ANSWERS[i]!);
    }
    await expect(page.getByText('阶段小结')).toBeVisible();

    // Continue -> the next round's question is generated (no result card).
    await page.getByRole('button', { name: '继续' }).click();
    await expect(page.getByText('第 6 轮').first()).toBeVisible();
    await expect(page.getByText('请进一步阐述你的观点')).toBeVisible();
    await expect(page.getByText('证据追问')).toBeVisible();
    await expect(page.locator('h3:has-text("思辨成果卡")')).toHaveCount(0);
  });

  // Ticket #15: the checkpoint decision and the assistant question are
  // persisted, so a refresh restores exactly one of the two pending states
  // instead of replaying the checkpoint (#14 P2 elimination evidence).
  test('reload while checkpoint decision pending restores the checkpoint, not a question', async ({ page }) => {
    await startSession(page, QUESTION, INITIAL_OPINION);

    for (let i = 0; i < 5; i++) {
      await answerRound(page, i + 1, ANSWERS[i]!);
    }
    await expect(page.getByText('阶段小结')).toBeVisible();

    await page.reload();
    // The checkpoint gate is restored — the input stays hidden so the gate
    // cannot be bypassed by refreshing.
    await expect(page.getByText('阶段小结')).toBeVisible();
    await expect(page.getByRole('button', { name: '继续' })).toBeVisible();
    await expect(page.locator('input[placeholder="输入你的回答..."]')).toHaveCount(0);

    // Continuing still works: round 6 question appears.
    await page.getByRole('button', { name: '继续' }).click();
    await expect(page.getByText('第 6 轮').first()).toBeVisible();
  });

  test('reload after checkpoint "continue" restores the round 6 question, not a checkpoint replay', async ({ page }) => {
    await startSession(page, QUESTION, INITIAL_OPINION);

    for (let i = 0; i < 5; i++) {
      await answerRound(page, i + 1, ANSWERS[i]!);
    }
    await expect(page.getByText('阶段小结')).toBeVisible();

    await page.getByRole('button', { name: '继续' }).click();
    await expect(page.getByText('第 6 轮').first()).toBeVisible();

    await page.reload();
    // Restored to the pending round 6 question — no checkpoint replay, no
    // result card.
    await expect(page.getByText('第 6 轮').first()).toBeVisible();
    await expect(page.getByText('请进一步阐述你的观点')).toBeVisible();
    await expect(page.getByText('证据追问')).toBeVisible();
    await expect(page.getByText('阶段小结')).toHaveCount(0);
    await expect(page.locator('h3:has-text("思辨成果卡")')).toHaveCount(0);
  });

  test('reload mid-session restores the correct round, then finishes five rounds', async ({ page }) => {
    await startSession(page, QUESTION, INITIAL_OPINION);

    await answerRound(page, 1, ANSWERS[0]!);
    await answerRound(page, 2, ANSWERS[1]!);
    // Wait until round 3 is planned: the session with 2 answers is saved by then.
    await expect(page.getByText('钢铁人反驳')).toBeVisible();

    await page.reload();
    // Restored: history kept, next planned round is 3 with the steel-man strategy.
    await expect(page.getByText('钢铁人反驳')).toBeVisible();
    await expect(page.getByText('第 3 轮').first()).toBeVisible();
    await expect(page.getByText(ANSWERS[0]!)).toBeVisible();
    await expect(page.getByText(ANSWERS[1]!)).toBeVisible();

    await answerRound(page, 3, ANSWERS[2]!);
    await answerRound(page, 4, ANSWERS[3]!);
    await answerRound(page, 5, ANSWERS[4]!);
    await expect(page.getByText('阶段小结')).toBeVisible();
  });

  test('early exit after two answers builds the card from saved messages', async ({ page }) => {
    await startSession(page, QUESTION, INITIAL_OPINION);

    await answerRound(page, 1, ANSWERS[0]!);
    await answerRound(page, 2, ANSWERS[1]!);
    await expect(page.getByText('钢铁人反驳')).toBeVisible();

    // The exit button visible in every round of the QA panel.
    await page.getByRole('button', { name: '结束本次思辨' }).click();
    await expect(page.locator('h3:has-text("思辨成果卡")')).toBeVisible({ timeout: 10000 });

    await expect(page.locator('h4:has-text("新增证据")')).toBeVisible();
    await expect(page.locator('h4:has-text("最终观点")')).toBeVisible();
    await expect(page.getByText(ANSWERS[0]!).first()).toBeVisible();
    await expect(page.getByText(ANSWERS[1]!).first()).toBeVisible();
  });
});
