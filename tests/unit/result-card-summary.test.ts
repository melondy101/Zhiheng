// Unit tests for the AI-authored initial/final position summary builder and
// validator (result-card-summary.ts). The validator must never partially
// trust a malformed section: an item with an out-of-range id, empty
// sourceMessageIds, or overlong text is discarded to null, independently for
// `initial` and `final`.
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  buildSummaryMessages,
  parseSummaryResponse,
  INITIAL_OPINION_ID,
  MAX_SUMMARY_TEXT_CHARS,
} from '../../src/lib/result-card-summary';

const ANSWERS = [
  { id: 'u_1', text: '摄影术诞生时绘画并未消亡，反而催生了印象派等新表达形式。' },
  { id: 'u_2', text: '综合来看，我认为AI将重塑而非取代人类创造力。' },
];

describe('buildSummaryMessages', () => {
  it('includes the initial opinion placeholder id when initialOpinion is present', () => {
    const messages = buildSummaryMessages('我最初觉得AI会取代人类', ANSWERS);
    const user = messages.find((m) => m.role === 'user')!.content;
    assert.match(user, new RegExp(INITIAL_OPINION_ID));
    assert.match(user, /u_1/);
    assert.match(user, /u_2/);
  });

  it('omits the initial opinion id from valid ids when there is no initial opinion', () => {
    const messages = buildSummaryMessages(null, ANSWERS);
    const user = messages.find((m) => m.role === 'user')!.content;
    assert.doesNotMatch(user, new RegExp(`\\[${INITIAL_OPINION_ID}\\]`));
  });
});

describe('parseSummaryResponse', () => {
  it('accepts a well-formed response with valid ids for both halves', () => {
    const raw = JSON.stringify({
      initial: { text: '用户最初认为AI会取代人类。', sourceMessageIds: [INITIAL_OPINION_ID] },
      final: { text: '用户最终认为AI会重塑而非取代人类创造力。', sourceMessageIds: ['u_2'] },
    });
    const result = parseSummaryResponse(raw, '我最初觉得AI会取代人类', ANSWERS);
    assert.ok(result);
    assert.strictEqual(result!.initial?.text, '用户最初认为AI会取代人类。');
    assert.deepStrictEqual(result!.initial?.sourceMessageIds, [INITIAL_OPINION_ID]);
    assert.strictEqual(result!.final?.text, '用户最终认为AI会重塑而非取代人类创造力。');
    assert.deepStrictEqual(result!.final?.sourceMessageIds, ['u_2']);
  });

  it('discards an item referencing an id outside the valid set', () => {
    const raw = JSON.stringify({
      initial: { text: '总结文本', sourceMessageIds: ['u_999'] },
      final: { text: '总结文本', sourceMessageIds: ['u_2'] },
    });
    const result = parseSummaryResponse(raw, null, ANSWERS);
    assert.ok(result);
    assert.strictEqual(result!.initial, null);
    assert.ok(result!.final);
  });

  it('discards an item with empty sourceMessageIds', () => {
    const raw = JSON.stringify({
      initial: null,
      final: { text: '总结文本', sourceMessageIds: [] },
    });
    const result = parseSummaryResponse(raw, null, ANSWERS);
    assert.ok(result);
    assert.strictEqual(result!.final, null);
  });

  it('discards an item whose text exceeds the max length', () => {
    const overlong = '总'.repeat(MAX_SUMMARY_TEXT_CHARS + 1);
    const raw = JSON.stringify({
      initial: null,
      final: { text: overlong, sourceMessageIds: ['u_2'] },
    });
    const result = parseSummaryResponse(raw, null, ANSWERS);
    assert.ok(result);
    assert.strictEqual(result!.final, null);
  });

  it('discards an item with empty text', () => {
    const raw = JSON.stringify({
      initial: { text: '   ', sourceMessageIds: ['u_1'] },
      final: null,
    });
    const result = parseSummaryResponse(raw, null, ANSWERS);
    assert.ok(result);
    assert.strictEqual(result!.initial, null);
  });

  it('keeps one valid half even when the other half is null', () => {
    const raw = JSON.stringify({
      initial: null,
      final: { text: '用户最终认为AI会重塑而非取代人类创造力。', sourceMessageIds: ['u_1', 'u_2'] },
    });
    const result = parseSummaryResponse(raw, null, ANSWERS);
    assert.ok(result);
    assert.strictEqual(result!.initial, null);
    assert.ok(result!.final);
  });

  it('returns null for unparseable JSON', () => {
    const result = parseSummaryResponse('not json at all', null, ANSWERS);
    assert.strictEqual(result, null);
  });

  it('returns null when no JSON object is present in prose wrapping', () => {
    const result = parseSummaryResponse('好的，以下是结果：抱歉我无法完成', null, ANSWERS);
    assert.strictEqual(result, null);
  });

  it('discards an item that mixes a valid id with a fabricated id', () => {
    const raw = JSON.stringify({
      initial: null,
      final: { text: '总结文本', sourceMessageIds: ['u_2', 'u_fabricated'] },
    });
    const result = parseSummaryResponse(raw, null, ANSWERS);
    assert.ok(result);
    assert.strictEqual(result!.final, null);
  });
});
