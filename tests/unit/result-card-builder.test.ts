// Ticket #17: unit tests for the result card builder over a real multi-round
// conversation — evidence/revision/final-position correctness, honest
// emptiness when evidence is missing, and the simple card shape used by the
// server-side complete action.
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  buildDetailedResultCard,
  buildSimpleResultCard,
} from '../../src/lib/result-card-builder';
import type { Message, Session } from '../../src/lib/providers';

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 's_card',
    question: '测试问题：这个观点的依据是什么？',
    initialOpinion: null,
    report: null,
    selectedViewpoint: null,
    messages: [],
    resultCard: null,
    completed: false,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function userMessage(text: string, timestamp: number, uncertain = false): Message {
  return {
    id: `u_${timestamp}`,
    role: 'user',
    text,
    timestamp,
    ...(uncertain ? { uncertain: true } : {}),
  };
}

const STANCE = { id: 'v1', text: '我认为AI会增强而非取代创造力', source: 'ai_suggested_and_selected' as const };

describe('buildDetailedResultCard (#17 multi-round correctness)', () => {
  const multiRound = makeSession({
    initialOpinion: '我最初觉得AI会取代人类',
    selectedViewpoint: STANCE,
    messages: [
      userMessage('摄影术诞生时绘画并未消亡，反而催生了印象派等新表达形式。', 1),
      userMessage('不知道', 2, true),
      userMessage('我的前提其实变了：技术进步会扩大而不是压缩人类的表达空间。', 3),
      userMessage('我也不确定', 4, true),
      userMessage('综合来看，我认为AI将重塑而非取代人类创造力。', 5),
    ],
    interrogation: {
      round: 3,
      strategy: 'M4_steelman',
      assistantQuestion: '针对你的说法，请尝试用最强的一种对立观点重新论证。哪种反驳最难回应？',
      usedFallback: false,
      pendingCheckpoint: false,
      uncertainStreak: 0,
    },
  });

  it('collects substantive non-final answers as new evidence, excluding uncertain inputs', () => {
    const card = buildDetailedResultCard(multiRound);
    assert.deepStrictEqual(
      card.newEvidence.map((e) => e.text),
      [
        '摄影术诞生时绘画并未消亡，反而催生了印象派等新表达形式。',
        '我的前提其实变了：技术进步会扩大而不是压缩人类的表达空间。',
      ]
    );
  });

  it('traces every evidence item to its message id', () => {
    const card = buildDetailedResultCard(multiRound);
    assert.deepStrictEqual(card.newEvidence.map((e) => e.messageId), ['u_1', 'u_3']);
  });

  it('computes stance revisions from the substantive answers only', () => {
    const card = buildDetailedResultCard(multiRound);
    assert.deepStrictEqual(
      card.stanceRevisions.map((r) => [r.from.text, r.to.text]),
      [
        [
          '摄影术诞生时绘画并未消亡，反而催生了印象派等新表达形式。',
          '我的前提其实变了：技术进步会扩大而不是压缩人类的表达空间。',
        ],
        [
          '我的前提其实变了：技术进步会扩大而不是压缩人类的表达空间。',
          '综合来看，我认为AI将重塑而非取代人类创造力。',
        ],
      ]
    );
  });

  it('uses the last substantive answer as the final position, never an uncertain input', () => {
    const card = buildDetailedResultCard(multiRound);
    assert.ok(card.finalPosition);
    assert.strictEqual(card.finalPosition!.text, '综合来看，我认为AI将重塑而非取代人类创造力。');
    assert.strictEqual(card.finalPosition!.messageId, 'u_5');
  });

  it('keeps every uncertain input traceable in the card', () => {
    const card = buildDetailedResultCard(multiRound);
    assert.deepStrictEqual(
      card.uncertainAnswers.map((a) => a.text),
      ['不知道', '我也不确定']
    );
    assert.deepStrictEqual(card.uncertainAnswers.map((a) => a.messageId), ['u_2', 'u_4']);
  });

  it('lists the pending unanswered question as unresolved', () => {
    const card = buildDetailedResultCard(multiRound);
    assert.deepStrictEqual(card.unresolved, [
      '针对你的说法，请尝试用最强的一种对立观点重新论证。哪种反驳最难回应？',
    ]);
  });

  it('messageIds still trace every user input, including uncertain ones', () => {
    const card = buildDetailedResultCard(multiRound);
    assert.deepStrictEqual(card.messageIds, ['u_1', 'u_2', 'u_3', 'u_4', 'u_5']);
  });

  it('an input flagged uncertain never counts as new evidence even when long', () => {
    const session = makeSession({
      messages: [
        userMessage('第一个实质性回答，包含具体数据。', 1),
        userMessage('我真的不知道该怎么回答这个问题了。', 2, true),
        userMessage('第二个实质性回答，给出明确结论。', 3),
      ],
    });
    const card = buildDetailedResultCard(session);
    assert.deepStrictEqual(card.newEvidence.map((e) => e.text), [
      '第一个实质性回答，包含具体数据。',
    ]);
    assert.deepStrictEqual(card.uncertainAnswers.map((a) => a.text), [
      '我真的不知道该怎么回答这个问题了。',
    ]);
    assert.strictEqual(card.finalPosition!.text, '第二个实质性回答，给出明确结论。');
  });
});

describe('buildDetailedResultCard (#17 honest emptiness)', () => {
  it('leaves evidence, revision and final-position sections empty when nothing substantive exists', () => {
    const card = buildDetailedResultCard(
      makeSession({ selectedViewpoint: STANCE, messages: [userMessage('不知道', 1, true)] })
    );
    assert.deepStrictEqual(card.newEvidence, []);
    assert.deepStrictEqual(card.stanceRevisions, []);
    assert.strictEqual(card.finalPosition, null);
    assert.deepStrictEqual(card.uncertainAnswers.map((a) => a.text), ['不知道']);
    assert.deepStrictEqual(card.unresolved, []);
    assert.ok(card.startingStance, 'the selected stance is still traced');
  });

  it('returns no unresolved questions without a pending question', () => {
    const card = buildDetailedResultCard(makeSession());
    assert.deepStrictEqual(card.unresolved, []);
  });

  it('does not fabricate content for an empty session', () => {
    const card = buildDetailedResultCard(makeSession());
    assert.strictEqual(card.initialExpression, null);
    assert.strictEqual(card.startingStance, null);
    assert.strictEqual(card.finalPosition, null);
    assert.deepStrictEqual(card.newEvidence, []);
    assert.deepStrictEqual(card.uncertainAnswers, []);
    assert.deepStrictEqual(card.messageIds, []);
  });
});

describe('buildSimpleResultCard (#17 server-side complete shape)', () => {
  it('projects the detailed card onto the persisted ResultCard shape', () => {
    const session = makeSession({
      initialOpinion: '我最初觉得AI会取代人类',
      selectedViewpoint: STANCE,
      messages: [
        userMessage('第一个实质性回答，包含具体数据与例子。', 1),
        userMessage('综合来看，我认为AI将重塑而非取代人类创造力。', 2),
      ],
    });
    const card = buildSimpleResultCard(session);
    assert.strictEqual(card.sessionId, 's_card');
    assert.ok(card.initialStance);
    assert.strictEqual(card.initialStance!.text, '我最初觉得AI会取代人类');
    assert.ok(card.selectedStartingStance);
    assert.strictEqual(card.selectedStartingStance!.source, 'ai_suggested_and_selected');
    assert.strictEqual(card.finalPosition, '综合来看，我认为AI将重塑而非取代人类创造力。');
    assert.deepStrictEqual(card.messageIds, ['u_1', 'u_2']);
  });
});
