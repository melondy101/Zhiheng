// E2E test for history remove and regenerate flow (ticket #23).
//
// Golden Path:
// 1. Start a session → report includes personal_history sources from localStorage
// 2. ReportPanel shows "本报告引用 N 条个人历史" list
// 3. Uncheck one history source
// 4. Click "重新生成报告" → API called with excludedHistoryIds
// 5. New report excludes that source but keeps the others
// 6. Original session still readable in localStorage (no deletion)
import { test, expect, type Page } from '@playwright/test';

const QUESTION = 'AI是否会取代程序员？';
const INITIAL_OPINION = '我认为AI是辅助工具而非取代者';

// Pre-populate localStorage with sessions that will be found by history search
async function seedHistorySessions(page: Page) {
  const sessions = [
    {
      id: 's_history_1',
      question: 'AI是否会改变教育行业？',
      initialOpinion: 'AI辅助学习是趋势',
      completed: true,
      createdAt: Date.now() - 86400000,
      updatedAt: Date.now() - 86400000,
      messages: [],
      report: {
        question: 'AI是否会改变教育行业？',
        title: 'AI是否会改变教育行业？',
        knowledgePoints: [],
        content: '演示内容',
        viewpoints: [],
        references: [],
        citations: {},
      },
      selectedViewpoint: null,
      resultCard: null,
      excludedHistoryIds: [],
    },
    {
      id: 's_history_2',
      question: 'AI与艺术家创造力的关系',
      initialOpinion: 'AI不会取代艺术家',
      completed: true,
      createdAt: Date.now() - 172800000,
      updatedAt: Date.now() - 172800000,
      messages: [],
      report: {
        question: 'AI与艺术家创造力的关系',
        title: 'AI与艺术家创造力的关系',
        knowledgePoints: [],
        content: '演示内容',
        viewpoints: [],
        references: [],
        citations: {},
      },
      selectedViewpoint: null,
      resultCard: null,
      excludedHistoryIds: [],
    },
  ];

  await page.goto('/');
  // Inject sessions into localStorage before starting
  await page.evaluate((items) => {
    for (const session of items) {
      localStorage.setItem(`zhiyan_sessions:${session.id}`, JSON.stringify(session));
    }
  }, sessions);
}

test.describe('History remove and regenerate (#23)', () => {
  test.beforeEach(async ({ page }) => {
    // Seed localStorage with history sessions
    await seedHistorySessions(page);
  });

  test('shows personal_history list in report panel after session start', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('知研');

    await page.fill('textarea#question', QUESTION);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/session=\w+/);

    // Wait for report to render
    await expect(page.locator('h2')).toContainText(QUESTION, { timeout: 15000 });

    // The personal_history section should appear in the references
    // (HistorySearchProvider returns sessions matching keywords "AI")
    const personalHistorySection = page.locator('h4:has-text("本报告引用")');
    await expect(personalHistorySection).toBeVisible({ timeout: 10000 });
  });

  test('unchecking a history source and regenerating produces a report that excludes it', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('知研');

    await page.fill('textarea#question', QUESTION);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/session=\w+/);
    await expect(page.locator('h2')).toContainText(QUESTION, { timeout: 15000 });

    // Wait for personal_history section to appear
    const personalHistorySection = page.locator('h4:has-text("本报告引用")');
    await expect(personalHistorySection).toBeVisible({ timeout: 10000 });

    // Capture the initial list of history source checkboxes
    const historyCheckboxes = page.locator(
      'input[id^="history-toggle-"]'
    );
    const initialCount = await historyCheckboxes.count();
    expect(initialCount).toBeGreaterThan(0);

    // Capture which session IDs are initially checked
    const initialCheckedIds: string[] = [];
    for (let i = 0; i < initialCount; i++) {
      const checked = await historyCheckboxes.nth(i).isChecked();
      if (checked) {
        const id = await historyCheckboxes.nth(i).getAttribute('id');
        initialCheckedIds.push(id ?? '');
      }
    }
    expect(initialCheckedIds.length).toBeGreaterThan(0);

    // Uncheck the first history source
    const firstCheckboxId = await historyCheckboxes.first().getAttribute('id');
    const sessionIdToExclude = firstCheckboxId?.replace('history-toggle-', '');
    await historyCheckboxes.first().uncheck();

    // Verify the "重新生成报告" button appears after unchecking
    const regenerateButton = page.getByRole('button', { name: '重新生成报告' });
    await expect(regenerateButton).toBeVisible();

    // Intercept the /api/report call to capture excludedHistoryIds
    let capturedExcludedIds: string[] = [];
    await page.route('**/api/report', async (route) => {
      const requestBody = route.request().postData();
      if (requestBody) {
        const parsed = JSON.parse(requestBody);
        if (parsed.excludedHistoryIds !== undefined) {
          capturedExcludedIds = parsed.excludedHistoryIds;
        }
      }
      // Continue with the actual request (it will use fixture/demo data)
      await route.continue();
    });

    // Click "重新生成报告"
    await regenerateButton.click();

    // Wait for new report to load
    await expect(page.locator('h2')).toContainText(QUESTION, { timeout: 20000 });

    // Verify the excludedHistoryIds was sent in the API call
    expect(capturedExcludedIds).toContain(sessionIdToExclude);

    // Verify the unchecked source no longer appears in the history list
    const updatedCheckboxes = page.locator('input[id^="history-toggle-"]');
    const updatedCount = await updatedCheckboxes.count();
    // The excluded history source must be absent from the regenerated report.
    const updatedIds: string[] = [];
    for (let i = 0; i < updatedCount; i++) {
      const id = await updatedCheckboxes.nth(i).getAttribute('id');
      updatedIds.push(id ?? '');
    }
    expect(updatedIds).not.toContain(`history-toggle-${sessionIdToExclude}`);
  });

  test('original session is preserved in localStorage after regenerate', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('知研');

    await page.fill('textarea#question', QUESTION);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/session=\w+/);
    await expect(page.locator('h2')).toContainText(QUESTION, { timeout: 15000 });

    // Get the current session ID from URL
    const url = page.url();
    const sessionIdMatch = url.match(/session=([^&]+)/);
    expect(sessionIdMatch).not.toBeNull();
    const sessionId = sessionIdMatch![1];

    // Verify the session exists in localStorage before any exclusion
    const sessionBefore = await page.evaluate(
      (id) => localStorage.getItem(`zhiyan_sessions:${id}`),
      sessionId
    );
    expect(sessionBefore).not.toBeNull();

    // Wait for history section and uncheck a source
    const personalHistorySection = page.locator('h4:has-text("本报告引用")');
    await expect(personalHistorySection).toBeVisible({ timeout: 10000 });

    const historyCheckboxes = page.locator('input[id^="history-toggle-"]');
    const count = await historyCheckboxes.count();
    if (count > 0) {
      await historyCheckboxes.first().uncheck();

      const regenerateButton = page.getByRole('button', { name: '重新生成报告' });
      await expect(regenerateButton).toBeVisible();
      await regenerateButton.click();

      // Wait for new report
      await expect(page.locator('h2')).toContainText(QUESTION, { timeout: 20000 });
    }

    // Original session still exists in localStorage (not deleted)
    const sessionAfter = await page.evaluate(
      (id) => localStorage.getItem(`zhiyan_sessions:${id}`),
      sessionId
    );
    expect(sessionAfter).not.toBeNull();
    const parsedSession = JSON.parse(sessionAfter!);
    // The session object should still be valid
    expect(parsedSession.id).toBe(sessionId);
    expect(parsedSession.report).toBeTruthy();
  });

  test('empty history shows explicit empty state, not fabricated references', async ({ page }) => {
    // Clear localStorage to ensure no history sessions
    await page.goto('/');
    await page.evaluate(() => {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith('zhiyan_sessions:')) keysToRemove.push(key);
      }
      for (const key of keysToRemove) localStorage.removeItem(key);
    });

    // Also mock API to return a report with no personal_history sources
    await page.route('**/api/report', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sessionId: 's_e2e_nohistory',
          report: {
            question: QUESTION,
            title: QUESTION,
            knowledgePoints: ['核心知识'],
            content: '报告内容',
            viewpoints: [],
            references: [
              {
                id: 'zhihu_1',
                type: 'zhihu',
                author: '知乎作者',
                title: '知乎回答',
                url: 'https://www.zhihu.com/answer/123',
                excerpt: '这是知乎回答的摘要',
                sourceSessionId: undefined,
                provenance: undefined,
              },
            ],
            citations: {
              1: {
                id: 'zhihu_1',
                type: 'zhihu',
                author: '知乎作者',
                title: '知乎回答',
                url: 'https://www.zhihu.com/answer/123',
                excerpt: '这是知乎回答的摘要',
              },
            },
          },
          knowledgeGraph: null,
        }),
      })
    );

    await page.fill('textarea#question', QUESTION);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/session=\w+/);
    await expect(page.locator('h2')).toContainText(QUESTION, { timeout: 15000 });

    // personal_history section should not appear when there are no history sources
    const personalHistorySection = page.locator('h4:has-text("本报告引用")');
    await expect(personalHistorySection).toHaveCount(0);

    // The zhihu source should still be visible
    await expect(page.getByText('知乎回答', { exact: true })).toBeVisible();
  });
});
