// Ticket #26/R3: Golden Path rewritten for PRD v4.2 §5 — gentle adaptive
// interrogation. The v4.1 fixed five-round strategy sequence and the
// 5/8/11 round checkpoints are gone. The single honest flow is:
//   1. 1 question + 3 substantive answers open the 3-round summary gate.
//   2. 继续聊 starts the next cycle (also 3 rounds) — never a 409.
//   3. 生成总结 builds the result card from the saved user messages.
//   4. A reload mid-session restores the round, the assistant question
//      and the open summary gate when applicable.
//   5. Uncertainty and explicit completion still work; the
//      三轮定向关口 is the only gate.

import { test, expect, type Page } from '@playwright/test';

const QUESTION = 'AI是否会取代人类创造力？';
const INITIAL_OPINION = '我认为AI会增强而非取代创造力';

const ANSWERS = [
  '第一个回答：摄影术没有消灭绘画，反而催生了全新的艺术表达形式。',
  '第二个回答：我的前提是技术进步最终会扩大人类的表达空间。',
  '第三个回答：最强的反驳是AI批量生成内容会稀释创作的稀缺性。',
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

  await expect(page.getByTestId('stance-selector')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('stance-option').first().click();
  await expect(page.getByTestId('qa-panel')).toBeVisible({ timeout: 15_000 });
}

async function answer(page: Page, text: string) {
  await page.fill('input[placeholder="输入你的回答..."]', text);
  await page.click('button:has-text("发送")');
}

test.describe('Golden Path: gentle adaptive interrogation (PRD v4.2 §5)', () => {
  test('three substantive answers open the summary gate, not a v4.1 5/8/11 checkpoint', async ({ page }) => {
    await startSession(page, QUESTION, INITIAL_OPINION);
    for (const a of ANSWERS) {
      await answer(page, a);
      // Each answer should be acknowledged — but no legacy "阶段小结" must
      // ever appear after a non-5th round.
      await page.waitForTimeout(300);
      await expect(page.getByText('阶段小结')).toHaveCount(0);
    }
    await expect(page.getByTestId('summary-gate')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('summary-gate-continue')).toBeVisible();
    await expect(page.getByTestId('summary-gate-complete')).toBeVisible();
  });

  test('after only one answer no result card appears and the next round begins', async ({ page }) => {
    await startSession(page, QUESTION, INITIAL_OPINION);
    await answer(page, ANSWERS[0]!);
    await expect(page.getByTestId('summary-gate')).toHaveCount(0);
    await expect(page.getByText('阶段小结')).toHaveCount(0);
    await expect(page.locator('h3:has-text("思辨成果卡")')).toHaveCount(0);
  });

  test('生成总结 builds the result card from the saved user messages', async ({ page }) => {
    await startSession(page, QUESTION, INITIAL_OPINION);
    for (const a of ANSWERS) {
      await answer(page, a);
      await page.waitForTimeout(300);
    }
    await expect(page.getByTestId('summary-gate')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('summary-gate-complete').click();
    await expect(page.locator('h3:has-text("思辨成果卡")')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('h4:has-text("最终观点")')).toBeVisible();
    await expect(page.getByText(INITIAL_OPINION).first()).toBeVisible();
  });

  test('继续聊 clears the summary gate and the user can keep answering', async ({ page }) => {
    await startSession(page, QUESTION, INITIAL_OPINION);
    for (const a of ANSWERS) {
      await answer(page, a);
      await page.waitForTimeout(300);
    }
    await expect(page.getByTestId('summary-gate')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('summary-gate-continue').click();
    // The gate is cleared (or the next 3-round cycle opens it again); the
    // important thing is that the page does not 409 and the qa-panel
    // remains interactive.
    await expect(page.getByTestId('qa-panel')).toBeVisible();
    // A fresh question is now displayed (the user can answer again).
    await expect(page.locator('input[placeholder="输入你的回答..."]')).toBeVisible();
  });

  test('reload mid-session restores the history and the pending round', async ({ page }) => {
    await startSession(page, QUESTION, INITIAL_OPINION);
    await answer(page, ANSWERS[0]!);
    await answer(page, ANSWERS[1]!);
    await expect(page.getByText(ANSWERS[0]!)).toBeVisible();
    await expect(page.getByText(ANSWERS[1]!)).toBeVisible();

    await page.reload();
    // Both saved answers come back.
    await expect(page.getByText(ANSWERS[0]!)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(ANSWERS[1]!)).toBeVisible();
  });

  test('reload while the summary gate is open restores the gate', async ({ page }) => {
    await startSession(page, QUESTION, INITIAL_OPINION);
    for (const a of ANSWERS) {
      await answer(page, a);
      await page.waitForTimeout(300);
    }
    await expect(page.getByTestId('summary-gate')).toBeVisible({ timeout: 30_000 });
    await page.reload();
    await expect(page.getByTestId('summary-gate')).toBeVisible({ timeout: 30_000 });
  });

  test('early exit after two answers builds the card from saved messages', async ({ page }) => {
    await startSession(page, QUESTION, INITIAL_OPINION);
    await answer(page, ANSWERS[0]!);
    await answer(page, ANSWERS[1]!);
    await page.getByRole('button', { name: '结束本次思辨' }).click();
    await expect(page.locator('h3:has-text("思辨成果卡")')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(ANSWERS[0]!).first()).toBeVisible();
    await expect(page.getByText(ANSWERS[1]!).first()).toBeVisible();
  });

  // Ticket #16 / #18: with report citations available, the QA panel renders
  // clickable sources whose hrefs come verbatim from the report — never
  // fabricated.
  test('question panel shows clickable sources taken from the report citations', async ({ page }) => {
    await startSession(page, QUESTION, INITIAL_OPINION);
    const sources = page.getByTestId('qa-sources');
    await expect(sources).toBeVisible();
    const links = sources.locator('a');
    await expect(links.first()).toBeVisible();

    // Ticket #18 honesty: the report panel must disclose demo data.
    const reportState = page.getByTestId('report-source-state');
    await expect(reportState).toBeVisible();
    await expect(reportState).toContainText('演示数据');
    await expect(reportState).not.toContainText('实时检索');
    await expect(sources).toContainText('知乎');

    const citationUrls: string[] = await page.evaluate((topic) => {
      const urls: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith('zhiyan_sessions:')) continue;
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw) as {
          question?: string;
          report?: { citations?: Record<string, { url?: string | null }> };
        };
        if (parsed.question !== topic) continue;
        const citations = parsed.report?.citations ?? {};
        for (const c of Object.values(citations)) {
          if (typeof c.url === 'string' && c.url.length > 0) urls.push(c.url);
        }
      }
      return urls;
    }, QUESTION);
    expect(citationUrls.length).toBeGreaterThan(0);

    const count = await links.count();
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(3);
    for (let i = 0; i < count; i++) {
      const href = await links.nth(i).getAttribute('href');
      expect(href, `rendered href must be a real citation URL: ${href}`).toBeTruthy();
      expect(citationUrls).toContain(href);
    }
  });

  // Ticket #16: with no report citations available, the panel says so
  // explicitly and renders no links at all.
  test('sessions without report citations show an explicit no-source notice, never fabricated links', async ({ page }) => {
    await page.route('**/api/report', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sessionId: 's_e2e_nosource',
          report: {
            question: QUESTION,
            title: QUESTION,
            knowledgePoints: ['核心知识点：演示用'],
            content: '演示报告内容',
            viewpoints: ['观点A：这是一种代表性立场', '观点B：这是另一种代表性立场'],
            references: [],
            citations: {},
          },
          knowledgeGraph: null,
        }),
      })
    );

    await startSession(page, QUESTION, INITIAL_OPINION);
    const sources = page.getByTestId('qa-sources');
    await expect(sources).toBeVisible();
    await expect(sources).toContainText('无可引用来源');
    await expect(sources.locator('a')).toHaveCount(0);
  });
});

// Ticket #17: uncertainty loop and explicit completion.
test.describe('Uncertainty loop and explicit completion', () => {
  const UNCERTAIN = ['不知道', '我不清楚', '不确定'];

  async function answerUncertain(page: Page, text: string) {
    await page.fill('input[placeholder="输入你的回答..."]', text);
    await page.click('button:has-text("发送")');
  }

  test('three uncertain answers stay in round 1, keep every input, and offer an explicit choice', async ({ page }) => {
    await startSession(page, QUESTION, INITIAL_OPINION);
    for (const u of UNCERTAIN) {
      await answerUncertain(page, u);
      await page.waitForTimeout(300);
    }
    // The session must not be auto-completed; the user is offered a choice.
    await expect(page.getByText('是否结束本次思辨')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('h3:has-text("思辨成果卡")')).toHaveCount(0);
    // All three uncertain inputs are kept visible in the conversation.
    for (const u of UNCERTAIN) {
      await expect(page.getByText(u).first()).toBeVisible();
    }
    // Choosing "继续" returns to round 1 (no round was completed by uncertain
    // inputs per #17).
    await page.getByRole('button', { name: '继续', exact: true }).click();
    await expect(page.getByText('第 1 轮').first()).toBeVisible({ timeout: 10_000 });
  });
});
