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

  // Ticket #18 negative sensitivity: the result card must never appear
  // before the user reaches an explicit end (checkpoint end / decision gate /
  // exit button). After only one answer the session must be in round 2 with
  // no card and no premature checkpoint.
  test('after the first answer no result card appears and round 2 begins', async ({ page }) => {
    await startSession(page, QUESTION, INITIAL_OPINION);

    await answerRound(page, 1, ANSWERS[0]!);

    await expect(page.getByText('前提追问')).toBeVisible();
    await expect(page.getByText('第 2 轮').first()).toBeVisible();
    await expect(page.locator('h3:has-text("思辨成果卡")')).toHaveCount(0);
    await expect(page.getByText('阶段小结')).toHaveCount(0);
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
    // Ticket #16: the round 6 question is context-driven — it quotes the
    // user's round 5 answer (the latest answer) instead of the old
    // round-fixed template text.
    await expect(page.getByText('你提到"第五个回答：综合以上讨论').first()).toBeVisible();
    await expect(page.getByText('这个主张有具体的数据或例子支持吗').first()).toBeVisible();
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
    // result card. The restored question is the context-driven round 6
    // question (#16).
    await expect(page.getByText('第 6 轮').first()).toBeVisible();
    await expect(page.getByText('你提到"第五个回答：综合以上讨论').first()).toBeVisible();
    await expect(page.getByText('这个主张有具体的数据或例子支持吗').first()).toBeVisible();
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

  // Ticket #16: with report citations available, the question panel renders
  // clickable sources whose hrefs come verbatim from the report — never
  // fabricated.
  test('question panel shows clickable sources taken from the report citations', async ({ page }) => {
    await startSession(page, QUESTION, INITIAL_OPINION);

    await expect(page.getByText('证据追问')).toBeVisible();
    const sources = page.getByTestId('qa-sources');
    await expect(sources).toBeVisible();
    const links = sources.locator('a');
    await expect(links.first()).toBeVisible();

    // Ticket #18 honesty: the report panel must disclose that this MVP's
    // report is generated from demo data — never labeled as real-time.
    const reportState = page.getByTestId('report-source-state');
    await expect(reportState).toBeVisible();
    await expect(reportState).toContainText('演示数据');
    await expect(reportState).not.toContainText('实时检索');

    // Ticket #18: each rendered source carries its honest type label.
    await expect(sources).toContainText('知乎');

    // Every rendered link must point at a URL that exists in the mirrored
    // report citations.
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
    // Serve a citation-less report so the session starts without any sources.
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

    await expect(page.getByText('证据追问')).toBeVisible();
    const sources = page.getByTestId('qa-sources');
    await expect(sources).toBeVisible();
    await expect(sources).toContainText('无可引用来源');
    await expect(sources.locator('a')).toHaveCount(0);
  });
});

// Ticket #17: uncertainty loop, explicit completion and result card retry.
test.describe('Uncertainty loop and explicit completion', () => {
  const UNCERTAIN = ['不知道', '我不清楚', '不确定'];

  async function answerUncertain(page: Page, text: string) {
    await page.fill('input[placeholder="输入你的回答..."]', text);
    await page.click('button:has-text("发送")');
  }

  test('three uncertain answers stay in round 1, keep every input, and offer an explicit choice', async ({ page }) => {
    await startSession(page, QUESTION, INITIAL_OPINION);

    // 1st uncertain answer: the round must NOT advance, the input must stay
    // visible, and the question must be narrowed (a rewrite of the current
    // question, not fixed text).
    await answerUncertain(page, UNCERTAIN[0]!);
    await expect(page.getByText('第 1 轮').first()).toBeVisible();
    await expect(page.getByText('证据追问')).toBeVisible();
    await expect(page.getByText(UNCERTAIN[0]!).first()).toBeVisible();
    await expect(page.getByText(/缩小/).first()).toBeVisible();
    await expect(page.getByText(/先聚焦/).first()).toBeVisible();

    // 2nd uncertain answer: still round 1, two directions offered.
    await answerUncertain(page, UNCERTAIN[1]!);
    await expect(page.getByText('第 1 轮').first()).toBeVisible();
    await expect(page.getByText(UNCERTAIN[1]!).first()).toBeVisible();
    await expect(page.getByText('方向 A').first()).toBeVisible();
    await expect(page.getByText('方向 B').first()).toBeVisible();

    // 3rd uncertain answer: an explicit 继续/结束 choice — never an automatic
    // result card, never a discarded input.
    await answerUncertain(page, UNCERTAIN[2]!);
    await expect(page.getByText(UNCERTAIN[2]!).first()).toBeVisible();
    await expect(page.getByRole('button', { name: '继续' })).toBeVisible();
    await expect(page.getByRole('button', { name: '结束并生成成果卡' })).toBeVisible();
    await expect(page.locator('h3:has-text("思辨成果卡")')).toHaveCount(0);
    await expect(page.locator('input[placeholder="输入你的回答..."]')).toHaveCount(0);

    // Refresh: the decision gate and all three inputs are restored.
    await page.reload();
    await expect(page.getByRole('button', { name: '继续' })).toBeVisible();
    await expect(page.getByRole('button', { name: '结束并生成成果卡' })).toBeVisible();
    for (const u of UNCERTAIN) {
      await expect(page.getByText(u).first()).toBeVisible();
    }

    // Choose "continue": a fresh question in the same round, streak reset.
    await page.getByRole('button', { name: '继续' }).click();
    await expect(page.getByText('第 1 轮').first()).toBeVisible();
    await expect(page.getByText('证据追问')).toBeVisible();
    await expect(page.locator('input[placeholder="输入你的回答..."]')).toHaveCount(1);

    // Answer substantively and finish the normal five-round flow.
    await answerRound(page, 1, ANSWERS[0]!);
    for (let i = 1; i < 5; i++) {
      await answerRound(page, i + 1, ANSWERS[i]!);
    }
    await expect(page.getByText('阶段小结')).toBeVisible();
    await page.getByRole('button', { name: '结束并生成成果卡' }).click();
    await expect(page.locator('h3:has-text("思辨成果卡")')).toBeVisible({ timeout: 10000 });

    // Every answer — the three uncertain inputs and the five substantive
    // ones — is traceable in the result card.
    for (const u of UNCERTAIN) {
      await expect(page.getByText(u).first()).toBeVisible();
    }
    for (const a of ANSWERS) {
      await expect(page.getByText(a).first()).toBeVisible();
    }
  });

  test('choosing "end" at the decision gate completes explicitly and the card traces the uncertain inputs', async ({ page }) => {
    await startSession(page, QUESTION, INITIAL_OPINION);

    for (const u of UNCERTAIN) {
      await answerUncertain(page, u);
    }
    await expect(page.getByRole('button', { name: '结束并生成成果卡' })).toBeVisible();

    await page.getByRole('button', { name: '结束并生成成果卡' }).click();
    await expect(page.locator('h3:has-text("思辨成果卡")')).toBeVisible({ timeout: 10000 });

    // The card is built from the saved conversation only: the three uncertain
    // inputs are kept traceable and the unanswered question is listed.
    await expect(page.locator('h4:has-text("保留的不确定回答")')).toBeVisible();
    await expect(page.locator('h4:has-text("未解决问题")')).toBeVisible();
    for (const u of UNCERTAIN) {
      await expect(page.getByText(u).first()).toBeVisible();
    }

    // Reload: the completed session still shows the card with every input.
    await page.reload();
    await expect(page.locator('h3:has-text("思辨成果卡")')).toBeVisible({ timeout: 10000 });
    for (const u of UNCERTAIN) {
      await expect(page.getByText(u).first()).toBeVisible();
    }
  });

  test('a failed completion shows a retry entry and never damages the saved session', async ({ page }) => {
    await startSession(page, QUESTION, INITIAL_OPINION);
    await answerRound(page, 1, ANSWERS[0]!);
    await expect(page.getByText('前提追问')).toBeVisible();

    // Fail every completion attempt with a 500 until the interception is removed.
    await page.route('**/api/interrogate', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'boom' }) })
    );
    await page.getByRole('button', { name: '结束本次思辨' }).click();

    // The failure is visible and offers a retry entry; no card is produced.
    await expect(page.getByTestId('complete-error')).toBeVisible();
    await expect(page.getByRole('button', { name: '重试生成成果卡' })).toBeVisible();
    await expect(page.locator('h3:has-text("思辨成果卡")')).toHaveCount(0);
    // The saved session is intact: the answer is still there and not completed.
    await expect(page.getByText(ANSWERS[0]!).first()).toBeVisible();
    const mirrored = await page.evaluate(() => {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith('zhiyan_sessions:')) continue;
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw) as { completed?: boolean; messages?: unknown[] };
        if (Array.isArray(parsed.messages) && parsed.messages.length > 0) return parsed;
      }
      return null;
    });
    expect(mirrored).not.toBeNull();
    expect(mirrored!.completed).toBe(false);

    // Retry succeeds and the card appears.
    await page.unroute('**/api/interrogate');
    await page.getByRole('button', { name: '重试生成成果卡' }).click();
    await expect(page.locator('h3:has-text("思辨成果卡")')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(ANSWERS[0]!).first()).toBeVisible();
  });
});
