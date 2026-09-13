import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectEngagement,
  nextQuestioningIntensity,
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

test('会话从最低强度起步，连续具体回答才逐级升高，回避立即降级', () => {
  const detailed = [
    '我认为需要同时比较短期效率、长期组织学习和执行成本，不能只看其中一个指标。',
    '还应收集不同团队规模的案例，并检验沟通成本是否会改变这个判断。',
  ];

  assert.equal(nextQuestioningIntensity(undefined, []), 'gentle');
  assert.equal(nextQuestioningIntensity('gentle', detailed), 'standard');
  assert.equal(nextQuestioningIntensity('standard', [...detailed, '我会补充一个反例，并说明它是否足以推翻原来的结论。']), 'challenging');
  assert.equal(nextQuestioningIntensity('challenging', [...detailed, '不知道']), 'standard');
});
