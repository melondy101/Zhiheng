import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  generateStoryRun,
  makeStoryChoice,
  completeStory,
  endStoryEarly,
  bridgeStoryToInterrogation,
} from '../../src/lib/story-run';
import type { Report, Session, Viewpoint } from '../../src/lib/providers';

const mockReport: Report = {
  title: '人工智能是否会全面替代知识工作者',
  question: '人工智能是否会全面替代知识工作者？',
  content: '随着大语言模型和具身智能的发展，关于知识工作者是否会被替代的讨论日益白热化。',
  knowledgePoints: [
    '知识复用与例行化：规则明确的知识工作易被自动化',
    '情境判断与责任承担：涉及价值排序和复杂责任的决策仍赖人类',
  ],
  viewpoints: [
    'AI将在5年内替代80%的基础脑力劳动',
    'AI是增强人类认知的副驾驶，而非替代者',
    '重构分配与劳动形态才是本质，替代是伪命题',
  ],
  references: [
    { id: 'ref-1', author: '智库研究', title: '劳动力市场自动化前瞻', excerpt: '自动化加速渗透知识密集型行业。', url: 'https://example.com/1', type: 'web' },
    { id: 'ref-2', author: '知乎答主', title: '程序员与分析师的亲身观察', excerpt: '一线实践中工具属性更为突出。', url: 'https://example.com/2', type: 'zhihu' },
  ],
  citations: {
    '1': { id: 'ref-1', author: '智库研究', title: '劳动力市场自动化前瞻', excerpt: '自动化加速渗透知识密集型行业。', url: 'https://example.com/1', type: 'web' },
    '2': { id: 'ref-2', author: '知乎答主', title: '程序员与分析师的亲身观察', excerpt: '一线实践中工具属性更为突出。', url: 'https://example.com/2', type: 'zhihu' },
  },
};

const mockViewpoint: Viewpoint = {
  id: 'v1',
  text: 'AI是增强人类认知的副驾驶，而非替代者',
  source: 'ai_suggested_and_selected',
};

describe('GalGame Story Run Engine (#G-00 through #G-05)', () => {
  it('generates a deterministic 3-act story grounded in report evidence', () => {
    const run = generateStoryRun('sess-1', mockReport, mockViewpoint, 'future_city');
    assert.strictEqual(run.sessionId, 'sess-1');
    assert.strictEqual(run.world, 'future_city');
    assert.strictEqual(run.status, 'in_progress');
    assert.strictEqual(run.acts.length, 3);
    assert.strictEqual(run.currentActIndex, 1);
    assert.strictEqual(run.chosenOptionIds.length, 0);

    for (const act of run.acts) {
      assert.ok(act.choices.length > 0);
      for (const choice of act.choices) {
        assert.ok(choice.options.length >= 2);
        for (const opt of choice.options) {
          assert.ok(opt.premise.length > 0);
          assert.ok(opt.benefit.length > 0);
          assert.ok(opt.cost.length > 0);
        }
      }
    }
  });

  it('records critical choices and advances acts sequentially', () => {
    let run = generateStoryRun('sess-1', mockReport, mockViewpoint, 'future_city');

    const act1Choice = run.acts[0].choices[0];
    const opt1 = act1Choice.options[0];
    run = makeStoryChoice(run, act1Choice.id, opt1.id);
    assert.strictEqual(run.chosenOptionIds.length, 1);
    assert.strictEqual(run.chosenOptionIds[0], opt1.id);
    assert.strictEqual(run.currentActIndex, 2);

    const act2Choice = run.acts[1].choices[0];
    const opt2 = act2Choice.options[1];
    run = makeStoryChoice(run, act2Choice.id, opt2.id);
    assert.strictEqual(run.chosenOptionIds.length, 2);
    assert.strictEqual(run.currentActIndex, 3);

    const act3Choice = run.acts[2].choices[0];
    const opt3 = act3Choice.options[0];
    run = makeStoryChoice(run, act3Choice.id, opt3.id);
    assert.strictEqual(run.chosenOptionIds.length, 3);

    run = completeStory(run);
    assert.strictEqual(run.status, 'completed');
    assert.ok(run.outcomeNarrative);
    assert.ok(run.outcomeNarrative.length > 20);
    assert.ok(run.reflectionSummary);
    assert.ok(run.reflectionSummary.length > 20);
  });

  it('handles early termination cleanly', () => {
    let run = generateStoryRun('sess-2', mockReport, mockViewpoint, 'fantasy_realm');
    run = endStoryEarly(run);
    assert.strictEqual(run.status, 'ended_early');
  });

  it('bridges story choices into interrogation state and cognitive trajectory', () => {
    let run = generateStoryRun('sess-3', mockReport, mockViewpoint, 'future_city');
    const act1Choice = run.acts[0].choices[0];
    run = makeStoryChoice(run, act1Choice.id, act1Choice.options[0].id);
    run = completeStory(run);

    const session: Session = {
      id: 'sess-3',
      question: mockReport.question,
      initialOpinion: null,
      report: mockReport,
      selectedViewpoint: mockViewpoint,
      mode: 'story',
      storyRun: run,
      messages: [],
      resultCard: null,
      completed: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const bridged = bridgeStoryToInterrogation(session);
    assert.strictEqual(bridged.mode, 'deep');
    assert.strictEqual(bridged.phase, 'interrogation');
    assert.ok(bridged.selectedViewpoint);
    assert.ok(bridged.selectedViewpoint.text.includes('基于剧情推演'));
  });
});
