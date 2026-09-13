import { test, expect, type Page } from '@playwright/test';

// #50 (#24-2): browser Golden Path for the 刘看山 SessionFeedbackCue.
// The cue must be DERIVED from the existing state machine: retrieval loading,
// normal questioning rounds (M1/M2/M5), adversarial rounds (M4/M6), and the
// explicit completion. It also proves the accessible fallbacks: reduced
// motion replaces GIF with glyph, and a failed asset still leaves equivalent text.

const QUESTION = 'AI是否会取代人类创造力？';
const INITIAL_OPINION = '我认为AI会增强而非取代创造力';

const ANSWERS = [
  '第一个回答：摄影术没有消灭绘画，反而催生了全新的艺术表达形式。',
  '第二个回答：我的前提是技术进步最终会扩大人类的表达空间。',
  '第三个回答：最强的反驳是AI批量生成内容会稀释创作的稀缺性。',
  '第四个回答：如果为相反立场辩护，我会说效率提升本身就是一种价值。',
  '第五个回答：综合以上讨论，我认为AI将重塑而非取代人类创造力。',
];

const cue = (page: Page) => page.getByTestId('session-feedback-cue');

async function startSession(page: Page) {
  await page.goto('/');
  await expect(page.locator('h1')).toContainText('知研');
  await page.click('summary:has-text("补充我的初步看法（可选）")');
  await page.fill('textarea#question', QUESTION);
  await page.fill('[data-testid="initial-opinion-input"]', INITIAL_OPINION);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/session=\w+/);
  // 无密钥的 E2E 环境下 FixtureLLMProvider 按设计不产出综合观点，
  // report-viewpoints-heading 不会渲染；用 stance-selector 作为
  // 「报告已就绪」的锚点，它正是下一步操作的前提。
  await expect(page.getByTestId('stance-selector')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('stance-option').first().click();
}

async function answerRound(page: Page, round: number, text: string) {
  await expect(page.getByText(`第 ${round} 轮`).first()).toBeVisible();
  await page.fill('[data-testid="answer-input"]', text);
  await page.getByTestId('send-answer-button').click();
}

test.describe('Feedback cue Golden Path: four derived states (#48)', () => {
  test('retrieving -> questioning -> challenging -> completed, and completion survives reload', async ({ page }) => {
    // Slow the report request so the retrieving cue is observable instead of
    // flashing past. This exercises the real browser→API data path.
    await page.route('**/api/report', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await route.continue();
    });

    await page.goto('/');
    await expect(page.locator('h1')).toContainText('知研');
    await page.click('summary:has-text("补充我的初步看法（可选）")');
    await page.fill('textarea#question', QUESTION);
    await page.fill('[data-testid="initial-opinion-input"]', INITIAL_OPINION);
    await page.click('button[type="submit"]');

    // 1) retrieving — visible while the report request is in flight.
    await expect(cue(page)).toHaveAttribute('data-cue-state', 'retrieving', { timeout: 5000 });
    await expect(cue(page)).toContainText('检索');
    await expect(page).toHaveURL(/session=\w+/);

    // No cue during stance selection (before a viewpoint is chosen).
    await expect(page.getByTestId('stance-selector')).toBeVisible({ timeout: 30_000 });
    await expect(cue(page)).toHaveCount(0);
    await page.getByTestId('stance-option').first().click();

    // 2) questioning — round 1 M1 evidence.
    await expect(cue(page)).toHaveAttribute('data-cue-state', 'questioning');
    await expect(cue(page)).toContainText('提问');
    await expect(page.getByText('证据追问')).toBeVisible();

    await answerRound(page, 1, ANSWERS[0]!);
    // round 2 M2 premise — still normal questioning.
    await expect(page.getByText('前提追问')).toBeVisible();
    await expect(cue(page)).toHaveAttribute('data-cue-state', 'questioning');

    await answerRound(page, 2, ANSWERS[1]!);
    // 3) challenging — round 3 M4 steel-man.
    await expect(page.getByText('钢铁人反驳')).toBeVisible();
    await expect(cue(page)).toHaveAttribute('data-cue-state', 'challenging');
    await expect(cue(page)).toContainText('反方挑战');

    await answerRound(page, 3, ANSWERS[2]!);
    // round 4 M6 reversal — still challenging.
    await expect(page.getByText('立场反转')).toBeVisible();
    await expect(cue(page)).toHaveAttribute('data-cue-state', 'challenging');

    // Early explicit completion via the QA panel exit action.
    await page.getByRole('button', { name: '结束本次思辨' }).click();
    // 4) completed — result card with the completed cue.
    await expect(page.locator('h3:has-text("思辨成果卡")')).toBeVisible({ timeout: 10000 });
    await expect(cue(page)).toHaveAttribute('data-cue-state', 'completed');
    await expect(cue(page)).toContainText('完成');

    // Completion semantics survive reload, cue included.
    await page.reload();
    await expect(page.locator('h3:has-text("思辨成果卡")')).toBeVisible({ timeout: 10000 });
    await expect(cue(page)).toHaveAttribute('data-cue-state', 'completed');
  });

  test('prefers-reduced-motion shows glyph fallback with text intact', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await startSession(page);

    await expect(cue(page)).toHaveAttribute('data-cue-state', 'questioning');
    // Reduced motion replaces GIF with decorative glyph.
    await expect(cue(page).getByTestId('session-feedback-cue-image')).toHaveCount(0);
    await expect(cue(page).getByTestId('session-feedback-cue-text-art')).toBeVisible();
    // Text remains perceivable.
    await expect(cue(page)).toContainText('刘看山正在向你提问');
  });

  test('failed image asset degrades to equivalent text (no broken image, no lost state)', async ({ page }) => {
    // Every cue asset fails to load.
    await page.route('**/feedback/official/*.gif', (route) => route.abort());
    await startSession(page);

    await expect(cue(page)).toHaveAttribute('data-cue-state', 'questioning');
    // The image is replaced by the decorative text glyph...
    await expect(cue(page).getByTestId('session-feedback-cue-image')).toHaveCount(0);
    await expect(cue(page).getByTestId('session-feedback-cue-text-art')).toBeVisible();
    // ...and the semantic text is fully intact.
    await expect(cue(page).getByTestId('session-feedback-cue-label')).toContainText('刘看山正在向你提问');
    await expect(cue(page).getByTestId('session-feedback-cue-description')).toBeVisible();
  });
});
