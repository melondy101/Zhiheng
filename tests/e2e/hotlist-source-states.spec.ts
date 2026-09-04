import { test, expect, type Page } from '@playwright/test';

// Ticket T1 (PRD v4.2 §2.3): the home page must state the hotlist's real
// source and, for cache results, the real update time.
//
// The webServer pins ZHIHU_ACCESS_SECRET='' and DATABASE_URL=''
// (playwright.config.js), so the un-mocked route honestly answers `demo`.
// The cache / stale-cache / live states are produced by intercepting
// /api/hotlist with page.route — never by faking the UI.
const SNAPSHOT_AT = new Date('2026-09-02T09:35:00').getTime();

function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const items = (prefix: string) =>
  [1, 2, 3].map((n) => ({
    id: `${prefix}-${n}`,
    title: `${prefix}热榜条目${n}`,
    url: 'https://www.zhihu.com/question/live',
  }));

async function serveHotlist(page: Page, body: unknown) {
  await page.route('**/api/hotlist', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    })
  );
}

test.describe('hotlist source states on the home page (PRD v4.2 §2.3)', () => {
  test('no secret and no cache → the hotlist is disclosed as demo data', async ({ page }) => {
    await page.goto('/');

    const state = page.getByTestId('hotlist-source-state');
    await expect(state).toBeVisible();
    await expect(state).toHaveText('演示数据');
    // The demo hotlist is still rendered, so the disclosure is about the
    // source, not an empty section.
    await expect(page.locator('h2:has-text("知乎热榜")')).toBeVisible();
  });

  test('a live response shows 实时热榜', async ({ page }) => {
    await serveHotlist(page, { items: items('live'), source: 'live', updatedAt: Date.now() });
    await page.goto('/');

    const state = page.getByTestId('hotlist-source-state');
    await expect(state).toHaveText('实时热榜');
    await expect(page.getByText('live热榜条目1')).toBeVisible();
  });

  test('a fresh cache response shows 缓存 · 更新于 <time> exactly once', async ({ page }) => {
    await serveHotlist(page, { items: items('cache'), source: 'cache', updatedAt: SNAPSHOT_AT });
    await page.goto('/');

    const expected = `缓存 · 更新于 ${formatTime(SNAPSHOT_AT)}`;
    const state = page.getByTestId('hotlist-source-state');
    await expect(state).toHaveText(expected);
    // The update time must not be duplicated by a second element (#T1).
    const rendered = await state.textContent();
    const occurrences = (rendered ?? '').split(formatTime(SNAPSHOT_AT)).length - 1;
    expect(occurrences).toBe(1);
  });

  test('a stale cache response shows 缓存已过期 · 更新于 <time>', async ({ page }) => {
    await serveHotlist(page, {
      items: items('stale'),
      source: 'cache',
      stale: true,
      updatedAt: SNAPSHOT_AT,
    });
    await page.goto('/');

    const state = page.getByTestId('hotlist-source-state');
    await expect(state).toHaveText(`缓存已过期 · 更新于 ${formatTime(SNAPSHOT_AT)}`);
    await expect(state).not.toHaveText(/实时热榜/);
    await expect(page.getByText('stale热榜条目1')).toBeVisible();
  });
});
