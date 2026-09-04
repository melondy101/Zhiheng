// Ticket T2 (PRD v4.2 §3): the multiple-viewpoint synthesis contract.
//
// The red lines this file exists to hold:
//   - a viewpoint is never a source title and never a lift from an excerpt;
//   - evidence always points at citations that really exist;
//   - a viewpoint with no valid evidence is dropped, not padded;
//   - one material yields one viewpoint — a second is never invented;
//   - the deterministic fallback discloses that it is material-based.
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  MAX_EVIDENCE_SUMMARY_CHARS,
  MAX_SYNTHESIS_VIEWPOINTS,
  buildFallbackSynthesis,
  buildSynthesisMessages,
  firstSentence,
  isLiftedFromMaterial,
  normalizeForComparison,
  parseSynthesisResponse,
  toSynthesisSources,
  type SynthesisSource,
} from '../../src/lib/report-synthesis';
import type { Source } from '../../src/lib/providers';

const SOURCES: SynthesisSource[] = [
  {
    citationId: 1,
    title: 'AI 会取代程序员吗',
    excerpt: '多数从业者认为短期内不会，因为需求理解与系统设计难以自动化。',
    kindLabel: '知乎社区材料',
  },
  {
    citationId: 2,
    title: '自动化对软件岗位的影响',
    excerpt: '历史数据显示自动化会改变岗位结构，但总量未必下降。',
    kindLabel: '外部检索材料',
  },
];

const VALID_RESPONSE = JSON.stringify({
  viewpoints: [
    {
      conclusion: '短期内 AI 无法独立承担需求理解，因此不会整体取代程序员。',
      evidence: [{ summary: '从业者普遍认为需求理解与系统设计难以自动化。', citationIds: [1] }],
    },
    {
      conclusion: '自动化更可能重塑岗位结构而非减少岗位总量。',
      evidence: [{ summary: '历史数据表明岗位结构会变，总量未必下降。', citationIds: [2] }],
    },
  ],
});

describe('parseSynthesisResponse — strict validation', () => {
  it('accepts a well-formed response and preserves citation ids', () => {
    const result = parseSynthesisResponse(VALID_RESPONSE, SOURCES);
    assert.ok(result, 'a valid response must be accepted');
    assert.strictEqual(result.viewpoints.length, 2);
    assert.deepStrictEqual(result.viewpoints[0]!.evidence[0]!.citationIds, [1]);
    assert.deepStrictEqual(result.viewpoints[1]!.evidence[0]!.citationIds, [2]);
  });

  it('strips a markdown code fence before parsing', () => {
    const result = parseSynthesisResponse(`\`\`\`json\n${VALID_RESPONSE}\n\`\`\``, SOURCES);
    assert.ok(result, 'fenced JSON is still valid JSON');
    assert.strictEqual(result.viewpoints.length, 2);
  });

  it('rejects a conclusion that is exactly a source title', () => {
    const response = JSON.stringify({
      viewpoints: [
        {
          conclusion: 'AI 会取代程序员吗',
          evidence: [{ summary: '依据。', citationIds: [1] }],
        },
      ],
    });
    assert.strictEqual(parseSynthesisResponse(response, SOURCES), null);
  });

  it('rejects a conclusion lifted verbatim out of an excerpt', () => {
    const response = JSON.stringify({
      viewpoints: [
        {
          conclusion: '因为需求理解与系统设计难以自动化',
          evidence: [{ summary: '依据。', citationIds: [1] }],
        },
      ],
    });
    assert.strictEqual(parseSynthesisResponse(response, SOURCES), null);
  });

  it('rejects a conclusion that merely swallows a whole excerpt', () => {
    const response = JSON.stringify({
      viewpoints: [
        {
          conclusion: '多数从业者认为短期内不会，因为需求理解与系统设计难以自动化。总之。',
          evidence: [{ summary: '依据。', citationIds: [1] }],
        },
      ],
    });
    assert.strictEqual(parseSynthesisResponse(response, SOURCES), null);
  });

  it('drops citation ids that do not exist and deduplicates the rest', () => {
    const response = JSON.stringify({
      viewpoints: [
        {
          conclusion: '工程实践中的隐性知识是自动化的主要障碍。',
          evidence: [{ summary: '依据。', citationIds: [1, 1, 99, -3, '2'] }],
        },
      ],
    });
    const result = parseSynthesisResponse(response, SOURCES);
    assert.ok(result);
    assert.deepStrictEqual(
      result.viewpoints[0]!.evidence[0]!.citationIds,
      [1],
      'only real, de-duplicated citation ids survive'
    );
  });

  it('drops evidence with no valid citation and then the whole viewpoint', () => {
    const response = JSON.stringify({
      viewpoints: [
        {
          conclusion: '一个没有任何可追溯依据的断言。',
          evidence: [{ summary: '依据。', citationIds: [77] }, { summary: '' }],
        },
      ],
    });
    assert.strictEqual(
      parseSynthesisResponse(response, SOURCES),
      null,
      'a viewpoint with no evidence-backed citation must not survive'
    );
  });

  it('keeps surviving viewpoints when only some are invalid', () => {
    const response = JSON.stringify({
      viewpoints: [
        { conclusion: 'AI 会取代程序员吗', evidence: [{ summary: 'x', citationIds: [1] }] },
        {
          conclusion: '自动化更多改变岗位结构而非总量。',
          evidence: [{ summary: '历史数据支持。', citationIds: [2] }],
        },
      ],
    });
    const result = parseSynthesisResponse(response, SOURCES);
    assert.ok(result);
    assert.strictEqual(result.viewpoints.length, 1, 'the title-only viewpoint is dropped');
    assert.strictEqual(result.viewpoints[0]!.conclusion, '自动化更多改变岗位结构而非总量。');
  });

  it('rejects malformed, empty, or over-long payloads', () => {
    assert.strictEqual(parseSynthesisResponse('not json', SOURCES), null);
    assert.strictEqual(parseSynthesisResponse('[]', SOURCES), null);
    assert.strictEqual(parseSynthesisResponse('null', SOURCES), null);
    assert.strictEqual(parseSynthesisResponse('{"viewpoints":[]}', SOURCES), null, 'no viewpoints');
    assert.strictEqual(
      parseSynthesisResponse(JSON.stringify({ viewpoints: [] }), SOURCES),
      null,
      'no viewpoints'
    );
    const overlong = JSON.stringify({
      viewpoints: [
        { conclusion: '观'.repeat(500), evidence: [{ summary: 'x', citationIds: [1] }] },
      ],
    });
    assert.strictEqual(parseSynthesisResponse(overlong, SOURCES), null, 'conclusion too long');
  });

  it('rejects an over-long evidence summary', () => {
    const response = JSON.stringify({
      viewpoints: [
        {
          conclusion: '一个明确的判断。',
          evidence: [{ summary: 'x'.repeat(MAX_EVIDENCE_SUMMARY_CHARS + 1), citationIds: [1] }],
        },
      ],
    });
    assert.strictEqual(parseSynthesisResponse(response, SOURCES), null);
  });

  it('never returns more than the capped number of viewpoints', () => {
    const viewpoints = Array.from({ length: 8 }, (_, i) => ({
      conclusion: `第 ${i + 1} 个彼此不同的明确判断。`,
      evidence: [{ summary: '依据。', citationIds: [1] }],
    }));
    const result = parseSynthesisResponse(
      JSON.stringify({ viewpoints }),
      SOURCES
    );
    assert.ok(result);
    assert.strictEqual(result.viewpoints.length, MAX_SYNTHESIS_VIEWPOINTS);
  });
});

describe('isLiftedFromMaterial / normalizeForComparison', () => {
  it('compares ignoring whitespace and punctuation', () => {
    assert.strictEqual(normalizeForComparison('A，B。 C'), normalizeForComparison(' A B C '));
  });

  it('flags a title match and an excerpt containment', () => {
    assert.strictEqual(isLiftedFromMaterial('AI 会取代程序员吗', SOURCES), true);
    assert.strictEqual(isLiftedFromMaterial('历史数据显示自动化会改变岗位结构', SOURCES), true);
    assert.strictEqual(isLiftedFromMaterial('隐性知识是自动化的主要障碍', SOURCES), false);
  });
});

describe('buildFallbackSynthesis — deterministic, material-based, honest', () => {
  const toSources = (sources: Source[]): SynthesisSource[] => toSynthesisSources(sources);

  const oneSource: Source[] = [
    {
      id: 'zh_1',
      type: 'zhihu',
      author: '张三',
      title: 'AI 会取代程序员吗',
      url: 'https://www.zhihu.com/q/1',
      excerpt: '多数从业者认为短期内不会。因为需求理解与系统设计难以自动化。',
    },
  ];

  it('produces exactly one viewpoint for one material', () => {
    const result = buildFallbackSynthesis('测试问题', toSources(oneSource));
    assert.ok(result);
    assert.strictEqual(result.viewpoints.length, 1, 'a second viewpoint is never fabricated');
  });

  it('the conclusion is neither the source title nor a bare excerpt truncation', () => {
    const result = buildFallbackSynthesis('测试问题', toSources(oneSource))!;
    const conclusion = result.viewpoints[0]!.conclusion;
    assert.notStrictEqual(conclusion, 'AI 会取代程序员吗', '观点不得是来源标题');
    assert.notStrictEqual(conclusion, oneSource[0]!.excerpt, '观点不得是摘录原文');
    assert.ok(conclusion.includes('[1]'), '观点必须标注来源');
    assert.ok(!conclusion.endsWith('…'), '观点不得是截断的摘录');
  });

  it('the raw excerpt stays in the evidence, and the citation id is real', () => {
    const result = buildFallbackSynthesis('测试问题', toSources(oneSource))!;
    const evidence = result.viewpoints[0]!.evidence;
    assert.strictEqual(evidence.length, 1);
    assert.deepStrictEqual(evidence[0]!.citationIds, [1]);
    assert.ok(evidence[0]!.summary.includes('多数从业者认为短期内不会'));
  });

  it('one viewpoint per material, capped, each with its own citation', () => {
    const sources: Source[] = [1, 2, 3, 4].map((n) => ({
      id: `s_${n}`,
      type: 'web' as const,
      author: null,
      title: `材料 ${n}`,
      url: null,
      excerpt: `第 ${n} 条材料的论述内容。`,
    }));
    const result = buildFallbackSynthesis('测试问题', toSources(sources))!;
    assert.strictEqual(result.viewpoints.length, MAX_SYNTHESIS_VIEWPOINTS);
    const ids = result.viewpoints.flatMap((vp) => vp.evidence.flatMap((e) => e.citationIds));
    assert.deepStrictEqual(ids, [1, 2, 3], 'evidence stays attributed to its own citation');
  });

  it('a material with no excerpt still yields an attributed, non-fabricated viewpoint', () => {
    const sources: Source[] = [
      { id: 's1', type: 'web', author: null, title: '无摘要材料', url: null, excerpt: null },
    ];
    const result = buildFallbackSynthesis('测试问题', toSources(sources))!;
    assert.strictEqual(result.viewpoints.length, 1);
    assert.ok(result.viewpoints[0]!.conclusion.includes('没有可引用的摘要'));
    assert.deepStrictEqual(result.viewpoints[0]!.evidence[0]!.citationIds, [1]);
  });

  it('returns null when there is no material at all', () => {
    assert.strictEqual(buildFallbackSynthesis('测试问题', []), null);
  });

});

  it('无来源时返回 null 而非虚构综合', () => {
    assert.strictEqual(buildFallbackSynthesis('测试问题', []), null);
  });

describe('buildSynthesisMessages', () => {
  it('asks for 1–3 core viewpoints and exhaustive direct support under each viewpoint', () => {
    const messages = buildSynthesisMessages({ question: '测试问题', sources: SOURCES });
    assert.strictEqual(messages.length, 2);
    assert.strictEqual(messages[0]!.role, 'system');
    const user = messages[1]!.content;
    assert.ok(user.includes('测试问题'));
    assert.ok(user.includes('[1]'), 'materials are numbered');
    assert.ok(user.includes('[2]'));
    assert.ok(user.includes('不得直接照抄或截断材料摘录'), 'the prompt states the red line');
    assert.ok(user.includes('所有直接支持该观点的材料'), 'the prompt requires complete support coverage');
    assert.ok(user.includes('1 到 3 条'), 'the prompt limits the report to 1–3 core viewpoints');
    assert.ok(!user.includes('}],"summary"'), 'the report no longer asks for a standalone synthesis conclusion');
  });

  it('rejects a standalone summary field because the report has no final verdict section', () => {
    const viewpoints = JSON.parse(VALID_RESPONSE).viewpoints;
    assert.strictEqual(
      parseSynthesisResponse(JSON.stringify({ summary: '不应出现的结论。', viewpoints }), SOURCES),
      null
    );
  });
});

describe('firstSentence', () => {
  it('returns the first complete sentence', () => {
    assert.strictEqual(firstSentence('第一句。第二句。'), '第一句。');
    assert.strictEqual(firstSentence('没有标点的整段'), '没有标点的整段');
    assert.strictEqual(firstSentence('第一行\n第二行'), '第一行');
  });
});
