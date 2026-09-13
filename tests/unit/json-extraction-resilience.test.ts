// O-3: JSON extraction resilience for LLM responses.
//
// Background: `generateCustomCompletion` / `generateQuestionRewrite` outputs are
// consumed by JSON.parse, but neither requested server-side JSON mode, and the
// only cleanup was stripping a markdown code fence. Measured against six shapes
// real models emit, 4 were silently discarded — the request spent tokens and
// latency, then fell back to the local heuristic with no user-visible signal.
//
// Two fixes, both covered here:
//   1. extractJsonObject tolerates prose, reasoning tags and trailing commas;
//   2. the provider now asks for response_format json_object on these calls.
//
// The extractor strips packaging only. It must never invent or repair meaning,
// so malformed input still returns null and the caller still degrades honestly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractJsonObject,
  parseQuestionRewriteResponse,
} from '../../src/lib/question-rewriter';

const PAYLOAD =
  '{"subtitle":"效率与归属的拉扯","rewrittenQuestion":"远程办公常态化后，协作的隐性成本由谁承担？"}';
const ORIGINAL = '远程办公是否应该成为常态';

/** Shapes observed from real providers that previously broke JSON.parse. */
const DIRTY_SHAPES: Array<[label: string, raw: string]> = [
  ['纯净 JSON', PAYLOAD],
  ['markdown 代码块', '```json\n' + PAYLOAD + '\n```'],
  ['前置解释文字', '好的，以下是结果：\n' + PAYLOAD],
  ['思维链标签在前', '<think>用户想改写问题</think>\n' + PAYLOAD],
  ['后置补充说明', PAYLOAD + '\n\n希望对你有帮助！'],
  ['前后都有杂文', '分析如下。\n' + PAYLOAD + '\n以上。'],
];

test('extractJsonObject 能从各种包装中取出 JSON 负载', () => {
  for (const [label, raw] of DIRTY_SHAPES) {
    const extracted = extractJsonObject(raw);
    assert.ok(extracted, `${label}: 未能提取到 JSON`);
    const parsed = JSON.parse(extracted) as { subtitle?: string };
    assert.equal(parsed.subtitle, '效率与归属的拉扯', `${label}: 负载内容不正确`);
  }
});

test('extractJsonObject 容忍结尾多余逗号', () => {
  const extracted = extractJsonObject('{"subtitle":"效率","rewrittenQuestion":"谁承担？",}');
  assert.ok(extracted);
  const parsed = JSON.parse(extracted) as { subtitle?: string };
  assert.equal(parsed.subtitle, '效率');
});

test('extractJsonObject 正确处理字符串内部的花括号', () => {
  const raw = '{"subtitle":"含{符号}的标题","rewrittenQuestion":"这样的}问题该怎么看？"}';
  const extracted = extractJsonObject(raw);
  assert.ok(extracted);
  const parsed = JSON.parse(extracted) as { subtitle?: string };
  assert.equal(parsed.subtitle, '含{符号}的标题');
});

test('extractJsonObject 对无效输入返回 null 而不是猜测', () => {
  for (const bad of ['', '   ', '完全没有 JSON 的一段话', '{未闭合的对象', 'null', '[1,2,3]']) {
    assert.equal(extractJsonObject(bad), null, `不应从 ${JSON.stringify(bad)} 中提取出对象`);
  }
});

test('脏输出经解析后，LLM 的改写结果确实被采用（而非静默回退启发式）', () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    for (const [label, raw] of DIRTY_SHAPES) {
      const result = parseQuestionRewriteResponse(raw, ORIGINAL, 'v2');
      const serialized = JSON.stringify(result);
      assert.ok(
        serialized.includes('隐性成本') || serialized.includes('效率与归属'),
        `${label}: LLM 结果被丢弃，回退到了启发式改写`
      );
    }
  } finally {
    console.warn = warn;
  }
});

test('无法解析时仍诚实降级为启发式结果，不抛出异常', () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    const result = parseQuestionRewriteResponse('这里根本没有任何结构化内容', ORIGINAL, 'v2');
    assert.ok(result, '应返回启发式结果而不是抛出');
    assert.equal(typeof result.rewrittenQuestion, 'string');
    assert.ok(result.rewrittenQuestion.length > 0);
  } finally {
    console.warn = warn;
  }
});
