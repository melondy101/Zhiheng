// D-2: strategy rotation must keep covering the pool after the opening plan.
//
// Background: once the planned 5- (or 8-) round sequence finished, the rotation
// only skipped the immediately preceding strategy. That made it oscillate
// between the first two entries forever. Measured over 20 rounds, standard mode
// reached 2 of 5 strategies with 12 ABAB segments — M6_reversal and
// M5_system2 were unreachable after round 5, so the philosophical frameworks
// wired to them (罗尔斯无知之幕 / 意外后果法则) never surfaced in long sessions.
//
// These tests pin the fixed behaviour: full pool coverage, no ABAB oscillation,
// bounded gaps between repeats, and that `isApplicable` is actually consulted.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pickFromRotation,
  pickNextStrategy,
  recordStrategy,
  STRATEGIES,
} from '../../src/lib/strategy-engine';
import type { StrategyId } from '../../src/lib/strategy-engine';
import type { Session } from '../../src/lib/providers';

function makeSession(mode?: 'deep'): Session {
  return {
    id: 's_rotation',
    question: 'q',
    messages: [],
    completed: false,
    mode,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } as unknown as Session;
}

/** Drive `rounds` picks through the real engine, threading history properly. */
function runRounds(rounds: number, mode?: 'deep'): StrategyId[] {
  let session = makeSession(mode);
  const sequence: StrategyId[] = [];
  for (let i = 0; i < rounds; i++) {
    const strategy = pickNextStrategy(session, i);
    sequence.push(strategy);
    session = recordStrategy(session, strategy);
  }
  return sequence;
}

/** Count ABAB oscillation segments — the exact symptom of the old bug. */
function countOscillations(sequence: StrategyId[]): number {
  let count = 0;
  for (let i = 0; i + 3 < sequence.length; i++) {
    if (sequence[i] === sequence[i + 2] && sequence[i + 1] === sequence[i + 3]) count++;
  }
  return count;
}

test('standard 模式：第 5 轮后仍覆盖全部 5 个轮换策略', () => {
  const tail = runRounds(30).slice(5);
  const distinct = new Set(tail);
  assert.equal(
    distinct.size,
    5,
    `轮换塌缩，只用到 ${distinct.size} 种：${[...distinct].join(', ')}`
  );
});

test('deep 模式：第 5 轮后仍覆盖全部 8 个轮换策略', () => {
  const tail = runRounds(30, 'deep').slice(5);
  const distinct = new Set(tail);
  assert.equal(
    distinct.size,
    8,
    `轮换塌缩，只用到 ${distinct.size} 种：${[...distinct].join(', ')}`
  );
});

test('两种模式都不出现 ABAB 来回震荡', () => {
  for (const mode of [undefined, 'deep'] as const) {
    const tail = runRounds(30, mode).slice(5);
    assert.equal(
      countOscillations(tail),
      0,
      `${mode ?? 'standard'} 模式出现 ABAB 震荡`
    );
  }
});

test('同一策略的重复间隔不小于池容量，避免短期重复', () => {
  for (const [mode, poolSize] of [[undefined, 5], ['deep', 8]] as const) {
    const tail = runRounds(30, mode).slice(5);
    const lastSeen = new Map<StrategyId, number>();
    tail.forEach((id, index) => {
      const previous = lastSeen.get(id);
      if (previous !== undefined) {
        assert.ok(
          index - previous >= poolSize,
          `${mode ?? 'standard'}: ${id} 在第 ${previous} 与 ${index} 轮间隔仅 ${index - previous}`
        );
      }
      lastSeen.set(id, index);
    });
  }
});

test('pickFromRotation 会真正调用 isApplicable 闸门', () => {
  const session = makeSession();
  const order: StrategyId[] = ['M1_evidence', 'M2_premise', 'M4_steelman'];
  const original = STRATEGIES.M1_evidence.isApplicable;
  let consulted = false;
  STRATEGIES.M1_evidence.isApplicable = () => {
    consulted = true;
    return false; // 声明为不可用
  };
  try {
    const picked = pickFromRotation(order, [], session);
    assert.ok(consulted, 'isApplicable 未被调用（仍是死代码）');
    assert.notEqual(picked, 'M1_evidence', '被标记为不可用的策略仍被选中');
  } finally {
    STRATEGIES.M1_evidence.isApplicable = original;
  }
});

test('全部策略都不可用时安全回退，不抛异常', () => {
  const session = makeSession();
  const order: StrategyId[] = ['M1_evidence', 'M2_premise'];
  const saved = order.map((id) => STRATEGIES[id].isApplicable);
  order.forEach((id) => {
    STRATEGIES[id].isApplicable = () => false;
  });
  try {
    const picked = pickFromRotation(order, ['M1_evidence'], session);
    assert.ok(order.includes(picked), '应从原始顺序中兜底选取');
  } finally {
    order.forEach((id, i) => {
      STRATEGIES[id].isApplicable = saved[i]!;
    });
  }
});

test('开局计划序列保持不变（不因轮换改动而回归）', () => {
  assert.deepEqual(runRounds(5), [
    'M1_evidence',
    'M2_premise',
    'M4_steelman',
    'M6_reversal',
    'M5_restate',
  ]);
});

test('recordStrategy returns an immutable, serializable strategy history', () => {
  const original = makeSession();
  const afterFirst = recordStrategy(original, 'M1_evidence');
  const afterSecond = recordStrategy(afterFirst, 'M2_premise');

  assert.equal(original.strategyHistory, undefined, 'recordStrategy must not mutate its input session');
  assert.deepEqual(afterFirst.strategyHistory, ['M1_evidence']);
  assert.deepEqual(afterSecond.strategyHistory, ['M1_evidence', 'M2_premise']);

  const restored = JSON.parse(JSON.stringify(afterSecond)) as Session;
  assert.deepEqual(restored.strategyHistory, ['M1_evidence', 'M2_premise']);
  assert.equal(pickNextStrategy(restored, 5), 'M4_steelman');
});
