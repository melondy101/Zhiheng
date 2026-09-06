import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  CHARACTERS,
  CHARACTER_IDS,
  formatCharacterQuestion,
  getCharacterPromptGuidance,
  isCharacterId,
} from '../../src/lib/character';

describe('Fun Mode Character Config (#F-01, #F-02)', () => {
  it('defines the three required characters with complete personas', () => {
    assert.deepStrictEqual(CHARACTER_IDS, ['relaxed_friend', 'ancient_scholar', 'anime_partner']);
    for (const id of CHARACTER_IDS) {
      const config = CHARACTERS[id];
      assert.ok(config);
      assert.strictEqual(config.id, id);
      assert.ok(config.name.length > 0);
      assert.ok(config.systemTone.length > 10);
      assert.ok(config.questionStyle.length > 10);
      assert.ok(config.examplePrefixes.length >= 3);
    }
  });

  it('validates character ID guard function', () => {
    assert.strictEqual(isCharacterId('relaxed_friend'), true);
    assert.strictEqual(isCharacterId('ancient_scholar'), true);
    assert.strictEqual(isCharacterId('anime_partner'), true);
    assert.strictEqual(isCharacterId('robot'), false);
    assert.strictEqual(isCharacterId(null), false);
  });

  it('formats character questions without altering the core logic question', () => {
    const rawQuestion = '如果关键数据被篡改，这一结论是否依然成立？';
    const formatted = formatCharacterQuestion('ancient_scholar', rawQuestion, 1);
    assert.ok(formatted.includes(rawQuestion));
    assert.ok(formatted.startsWith('【古风辩友】'));
  });

  it('provides LLM guidance that strictly forbids modifying the underlying logic question', () => {
    const guidance = getCharacterPromptGuidance('relaxed_friend');
    assert.ok(guidance.includes('严禁'));
    assert.ok(guidance.includes('轻松朋友'));
  });
});
