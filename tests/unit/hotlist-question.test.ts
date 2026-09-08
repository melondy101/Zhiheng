import { describe, it } from 'node:test';
import assert from 'node:assert';
import { hotlistBackground, makeHotlistCoreQuestion } from '../../src/lib/hotlist-question';

describe('makeHotlistCoreQuestion', () => {
  it('keeps a headline that is already one clear question', () => {
    assert.strictEqual(makeHotlistCoreQuestion('吃白菜真的能减肥吗？'), '吃白菜真的能减肥吗？');
  });

  it('moves a declarative headline into background and asks one verification question', () => {
    const title = '美国副总统万斯自称吃白菜减肥成功';
    const question = makeHotlistCoreQuestion(title);
    assert.strictEqual(question, '围绕“美国副总统万斯自称吃白菜减肥成功”，其中最值得核实的核心说法是什么？');
    assert.strictEqual(hotlistBackground(title, question), '热榜背景：美国副总统万斯自称吃白菜减肥成功');
  });
});
