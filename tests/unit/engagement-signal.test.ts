import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectEngagement,
  resolveAdaptiveStrategy,
} from '../../src/lib/engagement-signal';

test('连续两次回避时，挑战型钢铁人追问降级为温和元认知追问', () => {
  const signal = detectEngagement(['暂时说不出更多依据', '我先不展开了']);
  const decision = resolveAdaptiveStrategy('M4_steelman', signal);

  assert.equal(signal.level, 'disengaged');
  assert.equal(decision.strategy, 'M7_metacognition');
  assert.equal(decision.mode, 'deescalated');
});

test('单次回避只提供脚手架，不替换原策略', () => {
  const signal = detectEngagement(['我认为需要比较长期影响', '暂时说不出更多依据']);
  const decision = resolveAdaptiveStrategy('M4_steelman', signal);

  assert.equal(signal.level, 'wavering');
  assert.equal(decision.strategy, 'M4_steelman');
  assert.equal(decision.mode, 'scaffolded');
});

test('正常连续回答保持原策略，绝不凭信号升级强度', () => {
  const signal = detectEngagement([
    '我会先区分短期效率和长期组织学习的影响。',
    '还需要检验不同团队规模和沟通成本是否会改变结论。',
  ]);
  const decision = resolveAdaptiveStrategy('M2_premise', signal);

  assert.equal(signal.level, 'engaged');
  assert.equal(decision.strategy, 'M2_premise');
  assert.equal(decision.mode, 'standard');
});
