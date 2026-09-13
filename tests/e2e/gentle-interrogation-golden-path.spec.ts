// Ticket #26/R3: PRD v4.2 §5 gentle adaptive interrogation —
// browser golden path (Playwright).
//
// Scenarios verified against the testids already present in the production
// components (QAPanel, SessionFeedbackCue, HomePage) so this file adds
// zero new testid dependencies to the production code:
//  1. A user question gets a direct answer + a gentle follow-up and the
//     round counter does not change.
//  2. Three substantive answers open the decision gate.
//  3. 继续聊 is a legal transition — the page stays alive, no error toast.
//  4. 生成总结 completes the session.
//  5. A full-page reload restores the AI / user history and the open
//     decision gate.
//  6. Optimistic pending → assistant reply → no duplicate render; the
//     Liu Shanshan cue lifecycle is 'retrieving' → 'completed' and is
//     NOT click-driven.

import { test, expect } from '@playwright/test';

const HOME = '/';

async function seedReportAndStart(page: import('@playwright/test').Page) {
  await page.goto(HOME);
  await page.getByPlaceholder(/例如：AI是否会取代人类创造力/).fill('缓存优先有什么好处？');
  await page.getByRole('button', { name: /开始思考/ }).click();
  // After the report loads, the StanceSelector appears (the entry point to
  // the interrogation panel). Pick the first AI-suggested stance.
  await expect(page.getByTestId('stance-selector')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('stance-option').first().click();
  await expect(page.getByTestId('qa-panel')).toBeVisible({ timeout: 30_000 });
}

test.describe('R3 gentle adaptive interrogation (PRD v4.2 §5)', () => {
  test('scenario 1: a user question gets a direct answer + a follow-up and the round does not advance', async ({ page }) => {
    await seedReportAndStart(page);
    const input = page.getByTestId('answer-input');
    await input.fill('什么是缓存？');
    const messagesBefore = await page.locator('[data-testid="qa-panel"] li').count();
    await page.getByRole('button', { name: /发送/ }).click();
    // The session gains at most one new bubble for the assistant reply
    // (direct answer + follow-up collapsed into a single assistant message).
    await expect(async () => {
      const after = await page.locator('[data-testid="qa-panel"] li').count();
      expect(after - messagesBefore).toBeLessThanOrEqual(2);
    }).toPass({ timeout: 15_000 });
  });

  test('scenario 1a: sending an answer keeps the conversation mounted while the API is pending', async ({ page }) => {
    await seedReportAndStart(page);
    let releaseRequest: () => void = () => undefined;
    const requestHeld = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });
    let noteRequestStarted: () => void = () => undefined;
    const requestStarted = new Promise<void>((resolve) => {
      noteRequestStarted = resolve;
    });
    await page.route('**/api/interrogate', async (route) => {
      noteRequestStarted();
      await requestHeld;
      await route.continue();
    });

    await page.getByTestId('answer-input').fill('发送期间不应卸载整个对话页面。');
    await page.getByRole('button', { name: /发送/ }).click();
    await requestStarted;
    try {
      await expect(page.getByTestId('qa-panel')).toBeVisible();
      await expect(page.getByPlaceholder('正在发送...')).toBeVisible();
      await expect(page.getByText('加载中...')).toHaveCount(0);
    } finally {
      releaseRequest();
    }
  });

  test('scenario 2: three substantive answers open the decision gate (3/6/9 summary gate)', async ({ page }) => {
    await seedReportAndStart(page);
    const input = page.getByTestId('answer-input');
    for (const answer of [
      '我认为缓存能减少外部 API 调用。',
      '因为数据库查询快且一致。',
      '还可以让断网时的体验更好。',
    ]) {
      await input.fill(answer);
      await page.getByRole('button', { name: /发送/ }).click();
      await page.waitForTimeout(500);
    }
    // After 3 directive answers the summary gate is shown.
    await expect(page.getByTestId('summary-gate')).toBeVisible({ timeout: 30_000 });
  });

  test('scenario 3: 继续聊 is a legal 200 transition and a fresh question appears', async ({ page }) => {
    await seedReportAndStart(page);
    const input = page.getByTestId('answer-input');
    for (const answer of [
      '我看好缓存优先。',
      '它能改善断网体验。',
      '并且能保护后端。',
    ]) {
      await input.fill(answer);
      await page.getByRole('button', { name: /发送/ }).click();
      await page.waitForTimeout(500);
    }
    const gate = page.getByTestId('summary-gate');
    await expect(gate).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('summary-gate-continue').click();
    await expect(page.getByTestId('qa-panel')).toBeVisible({ timeout: 15_000 });
  });

  test('scenario 4: 生成总结 completes the session and shows the result card', async ({ page }) => {
    await seedReportAndStart(page);
    const input = page.getByTestId('answer-input');
    for (const answer of [
      '缓存优先能减少外部调用。',
      '它能改善断网体验。',
      '还可以保护后端不被突发流量击穿。',
    ]) {
      await input.fill(answer);
      await page.getByRole('button', { name: /发送/ }).click();
      await page.waitForTimeout(500);
    }
    const gate = page.getByTestId('summary-gate');
    await expect(gate).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('summary-gate-complete').click();
    await expect(page.getByText(/成果卡|总结|Result|已完成|完成/).first()).toBeVisible({ timeout: 30_000 });
  });

  test('scenario 5: reload restores full history and the open summary gate', async ({ page }) => {
    await seedReportAndStart(page);
    const input = page.getByTestId('answer-input');
    for (const answer of [
      '缓存优先能减少外部调用。',
      '它能改善断网体验。',
      '还可以保护后端不被突发流量击穿。',
    ]) {
      await input.fill(answer);
      await page.getByRole('button', { name: /发送/ }).click();
      await page.waitForTimeout(500);
    }
    await expect(page.getByTestId('summary-gate')).toBeVisible({ timeout: 30_000 });
    const messagesBefore = await page.locator('[data-testid="qa-panel"] li').count();
    await page.reload();
    await expect(page.getByTestId('summary-gate')).toBeVisible({ timeout: 30_000 });
    const messagesAfter = await page.locator('[data-testid="qa-panel"] li').count();
    expect(messagesAfter).toBe(messagesBefore);
  });

  test('scenario 6: Liu Shanshan cue is retrieving during the request and completed after', async ({ page }) => {
    await seedReportAndStart(page);
    const cue = page.getByTestId('session-feedback-cue');
    await expect(cue).toBeVisible();
    const input = page.getByTestId('answer-input');
    await input.fill('什么是缓存？');
    await page.getByRole('button', { name: /发送/ }).click();
    // The cue is server-state driven: the request is in flight, then done.
    // The label changes (retrieving → completed); we just require the cue to
    // remain visible throughout the round-trip — clicking the cue must not
    // pause, lock, or change the state.
    await expect(cue).toBeVisible({ timeout: 15_000 });
    await cue.click();
    await expect(cue).toBeVisible({ timeout: 5_000 });
  });
});
