import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  extractCognitiveTrajectory,
  TRAJECTORY_TYPE_LABELS,
} from '../../src/lib/cognitive-trajectory';
import type { Session, Viewpoint } from '../../src/lib/providers';

const viewpoint: Viewpoint = {
  id: 'v1',
  text: '远程办公提升了绝大多数团队的整体协同效率',
  source: 'user_authored',
};

describe('Cognitive Trajectory Extraction (#D-03)', () => {
  it('extracts initial stance from selectedViewpoint', () => {
    const session: Session = {
      id: 'sess-cog-1',
      question: '远程办公利弊几何？',
      initialOpinion: null,
      report: null,
      selectedViewpoint: viewpoint,
      messages: [],
      resultCard: null,
      completed: false,
      createdAt: 1000,
      updatedAt: 1000,
    };

    const events = extractCognitiveTrajectory(session);
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].type, 'claim');
    assert.strictEqual(events[0].text, viewpoint.text);
    assert.strictEqual(TRAJECTORY_TYPE_LABELS[events[0].type], '核心主张');
  });

  it('maps strategy questions and user answers to trajectory nodes without judgment', () => {
    const session: Session = {
      id: 'sess-cog-2',
      question: '远程办公利弊几何？',
      initialOpinion: null,
      report: null,
      selectedViewpoint: viewpoint,
      messages: [
        {
          id: 'q1',
          role: 'assistant',
          text: '有哪些可复现的量化依据支持这一结论？',
          strategy: 'M1_evidence',
          timestamp: 2000,
        },
        {
          id: 'a1',
          role: 'user',
          text: '多项跨国科技公司的产出数据显示代码提交量与任务闭环速度均上升了15%。',
          round: 1,
          strategy: 'M1_evidence',
          timestamp: 3000,
        },
        {
          id: 'q2',
          role: 'assistant',
          text: '该产出数据是否隐含了员工主动延长有效工作时间的假设？',
          strategy: 'M2_premise',
          timestamp: 4000,
        },
        {
          id: 'a2',
          role: 'user',
          text: '基于当前调查，确实这可能忽视了无边界加班对可持续性的潜在负面冲击。',
          round: 2,
          strategy: 'M2_premise',
          timestamp: 5000,
        },
      ],
      resultCard: null,
      completed: false,
      createdAt: 1000,
      updatedAt: 5000,
    };

    const events = extractCognitiveTrajectory(session);
    assert.strictEqual(events.length, 3);
    assert.strictEqual(events[0].type, 'claim');
    assert.strictEqual(events[1].type, 'evidence');
    assert.strictEqual(events[1].sourceMessageId, 'a1');
    assert.strictEqual(events[2].type, 'premise');
    assert.strictEqual(events[2].sourceMessageId, 'a2');
  });

  it('tracks uncertainty acknowledge non-judgmentally', () => {
    const session: Session = {
      id: 'sess-cog-3',
      question: '远程办公利弊几何？',
      initialOpinion: null,
      report: null,
      selectedViewpoint: viewpoint,
      messages: [
        {
          id: 'q1',
          role: 'assistant',
          text: '核心事实争议点是什么？',
          strategy: 'M1_evidence',
          timestamp: 2000,
        },
        {
          id: 'a1',
          role: 'user',
          text: '不清楚，这个问题目前没有权威定论。',
          uncertain: true,
          round: 1,
          strategy: 'M1_evidence',
          timestamp: 3000,
        },
      ],
      resultCard: null,
      completed: false,
      createdAt: 1000,
      updatedAt: 3000,
    };

    const events = extractCognitiveTrajectory(session);
    assert.strictEqual(events.length, 2);
    assert.strictEqual(events[1].type, 'unresolved_question');
    assert.strictEqual(events[1].label, '不确定性记录');
  });
});
