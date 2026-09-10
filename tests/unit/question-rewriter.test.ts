import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  rewriteQuestionHeuristic,
  parseQuestionRewriteResponse,
  rewriteQuestionAndSubtitle,
  buildQuestionRewriteMessages,
} from '@/lib/question-rewriter';

describe('question-rewriter', () => {
  it('generates heuristic rewrite for empty input', () => {
    const res = rewriteQuestionHeuristic('');
    assert.strictEqual(res.subtitle, '深度议题探究');
    assert.strictEqual(res.original, '');
    assert.strictEqual(res.rewrittenQuestion, '');
    assert.ok(res.v1);
    assert.ok(res.v2);
  });

  it('generates accurate V2 factual rewrite for Vance sauerkraut example', () => {
    const res = rewriteQuestionHeuristic('为啥白宫开始流行吃酸菜了？万斯自称吃酸菜减重成功，酸菜真能减肥吗？', 'v2');
    assert.strictEqual(res.original, '为啥白宫开始流行吃酸菜了？万斯自称吃酸菜减重成功，酸菜真能减肥吗？');
    assert.strictEqual(res.subtitle, '发酵膳食与减重循证');
    assert.strictEqual(res.rewrittenQuestion, '美国副总统万斯自称吃酸菜减肥成功，可是吃酸菜真的能减肥吗？');
    assert.strictEqual(res.v2.rewrittenQuestion, '美国副总统万斯自称吃酸菜减肥成功，可是吃酸菜真的能减肥吗？');
    assert.ok(res.v1.rewrittenQuestion.includes('发酵膳食'));
  });

  it('generates heuristic rewrite and extracts short subtitle for standard question', () => {
    const res = rewriteQuestionHeuristic('AI是否具备真正的艺术创造力？', 'v2');
    assert.strictEqual(res.original, 'AI是否具备真正的艺术创造力？');
    assert.strictEqual(res.subtitle, '机器认知与创造力边界');
    assert.ok(res.rewrittenQuestion.includes('创造力'));
    assert.strictEqual(res.activeVersion, 'v2');
  });

  it('parses structured LLM JSON response with V2 and V1 successfully', () => {
    const raw = JSON.stringify({
      subtitle: '发酵膳食与减重循证',
      activeVersion: 'v2',
      v2: {
        rewrittenQuestion: '美国副总统万斯自称吃酸菜减肥成功，可是吃酸菜真的能减肥吗？',
        styleName: '第二版：事实锚定与自然思辨',
        description: '主体事实前置、去噱头降噪，经典知乎自然追问',
      },
      v1: {
        rewrittenQuestion: '围绕发酵膳食对体重管理的影响，其背后的生物代谢机制与循证医学支持度究竟如何？',
        styleName: '第一版：学术机制与深度探究',
        description: '深入因果底层机制、边界条件与多维推演',
      },
      rewrittenQuestion: '美国副总统万斯自称吃酸菜减肥成功，可是吃酸菜真的能减肥吗？',
      background: '美国副总统万斯称吃酸菜减重成功',
      focusSummary: '关注名人效应、肠道菌群与循证医学事实',
    });

    const parsed = parseQuestionRewriteResponse(raw, '为啥白宫开始流行吃酸菜了？万斯自称吃酸菜减重成功，酸菜真能减肥吗？', 'v2');
    assert.strictEqual(parsed.subtitle, '发酵膳食与减重循证');
    assert.strictEqual(parsed.rewrittenQuestion, '美国副总统万斯自称吃酸菜减肥成功，可是吃酸菜真的能减肥吗？');
    assert.strictEqual(parsed.v2.rewrittenQuestion, '美国副总统万斯自称吃酸菜减肥成功，可是吃酸菜真的能减肥吗？');
    assert.ok(parsed.v1.rewrittenQuestion.includes('发酵膳食'));
  });

  it('falls back to heuristic when LLM returns invalid JSON or errors', async () => {
    const faultyProvider = {
      generateQuestionRewrite: async () => {
        throw new Error('LLM timeout simulated');
      },
    };

    const res = await rewriteQuestionAndSubtitle('为啥白宫开始流行吃酸菜了？万斯自称吃酸菜减重成功，酸菜真能减肥吗？', faultyProvider as any);
    assert.strictEqual(res.subtitle, '发酵膳食与减重循证');
    assert.strictEqual(res.rewrittenQuestion, '美国副总统万斯自称吃酸菜减肥成功，可是吃酸菜真的能减肥吗？');
  });

  it('builds system prompt and user prompt accurately containing V2 and V1 requirements', () => {
    const messages = buildQuestionRewriteMessages('新能源车未来前景如何？');
    assert.strictEqual(messages.length, 2);
    assert.strictEqual(messages[0].role, 'system');
    assert.strictEqual(messages[1].role, 'user');
    assert.ok(messages[0].content.includes('第二版'));
    assert.ok(messages[0].content.includes('美国副总统万斯自称吃酸菜减肥成功'));
    assert.ok(messages[1].content.includes('新能源车未来前景如何？'));
  });
});
