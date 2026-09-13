import { describe, it } from 'node:test';
import assert from 'node:assert';
import type { Source, Report, Session } from '../../src/lib/providers';
import {
  buildGraph,
  validateGraph,
  buildFallbackGraph,
  safeBuildGraph,
  safeBuildGraphAsync,
  sanitizeGraphLabel,
  isBlacklistedEntityLabel,
  isEntityNoise,
  generateEntityAssociationProfile,
  enrichGraphWithAssociationProfiles,
  type KnowledgeGraph,
  type GraphNodeType,
} from '../../src/lib/knowledge-graph';
import {
  buildGraphExtractionMessages,
  parseGraphExtractionResponse,
} from '../../src/lib/knowledge-graph-llm';

describe('Knowledge Graph Contract (KG-01, KG-02, KG-03)', () => {
  const makeSource = (
    id: string,
    type: Source['type'],
    title: string,
    excerpt: string,
    author = '测试作者'
  ): Source => ({
    id,
    type,
    author,
    title,
    url: 'https://example.com/source',
    excerpt,
  });

  const makeReport = (sources: Source[], question = 'AI 能够拥有真正的意识吗？'): Report => {
    const citations: Record<number, Source> = {};
    sources.forEach((s, i) => {
      citations[i + 1] = s;
    });
    return {
      question,
      title: question,
      knowledgePoints: ['图灵测试', '计算主义', '涌现现象'],
      content: '报告正文内容……',
      viewpoints: ['意识是计算涌现的必然结果', '生物基质是主观体验的必要前提'],
      references: sources,
      citations,
    };
  };

  describe('KG-01: Graph Data Contract & Controlled Extraction', () => {
    it('returns dynamically extracted nodes with contextual descriptions and correct types', () => {
      const sources = [
        makeSource('s1', 'zhihu', '人工神经网络的意识机制', '清华大学团队提出观点'),
        makeSource('s2', 'web', 'Computational Emergence in LLMs', 'A study on AI cognition', 'MIT Lab'),
        makeSource('s3', 'zhihu', '哲学视角的强人工智能', '心智哲学讨论'),
      ];
      const report = makeReport(sources);
      const graph = buildGraph(report, sources);

      assert.ok(graph.nodes.length >= 3, `Got ${graph.nodes.length} nodes dynamically extracted`);

      // Central node is topic
      assert.strictEqual(graph.nodes[0].id, 'n0');
      assert.strictEqual(graph.nodes[0].type, 'topic');
      assert.ok(graph.nodes[0].description.includes('核心研讨议题'));

      // All nodes have valid types: topic, concept, claim, or actor
      const validTypes: GraphNodeType[] = ['topic', 'concept', 'claim', 'actor'];
      for (const node of graph.nodes) {
        assert.ok(node.type && validTypes.includes(node.type), `Invalid node type: ${node.type}`);
        assert.ok(node.label.length > 0);
        assert.ok(node.description.length > 0);
      }
    });

    it('edges contain subject, predicate, object and direction', () => {
      const sources = [
        makeSource('s1', 'zhihu', '神经网络的计算涌现', '研究表明关联'),
        makeSource('s2', 'web', 'Turing Machine Limits', 'Theoretical boundaries'),
      ];
      const report = makeReport(sources);
      const graph = buildGraph(report, sources);

      assert.ok(graph.edges.length > 0);
      for (const edge of graph.edges) {
        assert.ok(edge.from && edge.to);
        assert.strictEqual(edge.subject, edge.from);
        assert.strictEqual(edge.object, edge.to);
        assert.ok(edge.predicate && edge.predicate.length > 0);
        assert.ok(['supported', 'inferred', 'user_claimed'].includes(edge.type));
      }
    });

    it('supported edges strictly reference existing citations', () => {
      const sources = [
        makeSource('s1', 'zhihu', '意识涌现实验', '实证材料'),
        makeSource('s2', 'web', 'Cognition Study', 'Paper abstract'),
      ];
      const report = makeReport(sources);
      const graph = buildGraph(report, sources);

      const supported = graph.edges.filter((e) => e.type === 'supported');
      assert.ok(supported.length > 0, 'Must have at least one supported edge');

      for (const edge of supported) {
        assert.ok(typeof edge.citationId === 'number' && edge.citationId >= 1);
        assert.ok(report.citations[edge.citationId], `Citation [${edge.citationId}] must exist in report`);
      }
    });

    it('inferred and user_claimed edges do not fabricate citationIds', () => {
      const sources = [
        makeSource('s1', 'zhihu', '观点 A', '内容'),
        makeSource('s2', 'web', '观点 B', '内容'),
        makeSource('s3', 'zhihu', '观点 C', '内容'),
      ];
      const report = makeReport(sources);
      const graph = buildGraph(report, sources);

      const nonSupported = graph.edges.filter((e) => e.type !== 'supported');
      for (const edge of nonSupported) {
        assert.strictEqual(edge.citationId, undefined, 'Non-supported edge cannot have citationId');
      }
    });

    it('is completely deterministic for identical inputs', () => {
      const sources = [
        makeSource('s1', 'zhihu', '深度学习与认知科学', '论述'),
        makeSource('s2', 'web', 'Philosophy of Mind', 'Overview'),
      ];
      const r1 = makeReport(sources);
      const r2 = makeReport(sources);
      const g1 = buildGraph(r1, sources);
      const g2 = buildGraph(r2, sources);

      assert.deepStrictEqual(g1, g2);
    });
  });

  describe('KG-02: Accessible Force-Directed Layout & Integrity', () => {
    it('nodes and edges form a fully connected valid graph without orphan endpoints', () => {
      const sources = [
        makeSource('s1', 'zhihu', '通用人工智能路径', '科技分析'),
        makeSource('s2', 'web', 'AGI Safety Research', 'Safety guidelines'),
      ];
      const report = makeReport(sources);
      const graph = buildGraph(report, sources);

      const nodeMap = new Set(graph.nodes.map((n) => n.id));
      for (const edge of graph.edges) {
        assert.ok(nodeMap.has(edge.from), `From node ${edge.from} must exist in nodes`);
        assert.ok(nodeMap.has(edge.to), `To node ${edge.to} must exist in nodes`);
      }
    });

    it('validation succeeds for standard graph and catches invalid citations', () => {
      const sources = [makeSource('s1', 'zhihu', '技术发展', '内容')];
      const report = makeReport(sources);
      const graph = buildGraph(report, sources);

      const validation = validateGraph(graph, report);
      assert.strictEqual(validation.valid, true);

      // Mutate to an invalid citation
      const badGraph: KnowledgeGraph = {
        nodes: [...graph.nodes],
        edges: [
          ...graph.edges,
          {
            id: 'bad_edge',
            from: 'n0',
            to: graph.nodes[1]?.id ?? 'n1',
            label: '测试',
            type: 'supported',
            citationId: 9999, // Does not exist
          },
        ],
      };

      const badValidation = validateGraph(badGraph, report);
      assert.strictEqual(badValidation.valid, false);
      assert.ok(badValidation.reason?.includes('citation [9999]'));
    });
  });

  describe('KG-03: Graph Recovery, Fallback Degradation, and Non-blocking', () => {
    it('buildFallbackGraph produces a safe, structured fallback with truthful degradation flag', () => {
      const report = makeReport([], '空来源议题探讨');
      const fallback = buildFallbackGraph(report, '检索源为空或抽取解析异常');

      assert.strictEqual(fallback.isFallback, true);
      assert.ok(fallback.degradedReason?.includes('检索源为空'));
      assert.ok(fallback.nodes.length >= 1);
      assert.strictEqual(fallback.nodes[0].type, 'topic');

      const val = validateGraph(fallback, report);
      assert.strictEqual(val.valid, true);
    });

    it('safeBuildGraph degrades gracefully instead of throwing when inputs are corrupted', () => {
      const corruptedReport = {
        question: '测试议题',
        title: '测试标题',
        knowledgePoints: [],
        content: '',
        viewpoints: [],
        references: [],
        citations: {},
      } as unknown as Report;

      // Pass empty/corrupted sources
      const graph = safeBuildGraph(corruptedReport, []);
      assert.ok(graph);
      assert.ok(graph.nodes.length >= 1);
      assert.strictEqual(graph.nodes[0].id, 'n0');
    });

    it('preserves graph upon session restoration without regenerating', () => {
      const sources = [makeSource('s1', 'zhihu', '量子计算前沿', '最新突破')];
      const report = makeReport(sources);
      const originalGraph = buildGraph(report, sources);

      const session: Session = {
        id: 's_test_graph_recovery',
        question: report.question,
        initialOpinion: '我认为量子计算在五年内会有突破',
        report,
        knowledgeGraph: originalGraph,
        selectedViewpoint: null,
        messages: [],
        resultCard: null,
        completed: false,
        createdAt: 1000,
        updatedAt: 1000,
        excludedHistoryIds: [],
        reportSourceState: {
          zhihu: 'live',
          web: 'live',
        },
      };

      // Restore session simulated via JSON roundtrip
      const serialized = JSON.stringify(session);
      const restored = JSON.parse(serialized) as Session;

      assert.deepStrictEqual(restored.knowledgeGraph, originalGraph);
      assert.strictEqual(restored.knowledgeGraph?.nodes.length, originalGraph.nodes.length);
      assert.strictEqual(restored.reportSourceState?.zhihu, 'live');
    });
  });

  describe('KG-04: LLM Structured Knowledge Graph Extraction', () => {
    it('buildGraphExtractionMessages constructs structured system and user prompts', () => {
      const sources = [
        makeSource('s1', 'zhihu', '自适应学习系统演进', '实证表明个性化教学显著提升学习效率'),
        makeSource('s2', 'web', 'AI in Education Risks', 'Discussion on cognitive outsourcing and privacy'),
      ];
      const report = makeReport(sources, 'AI是否会重塑教育形态？');
      const messages = buildGraphExtractionMessages(report, sources);

      assert.strictEqual(messages.length, 2);
      assert.strictEqual(messages[0].role, 'system');
      assert.strictEqual(messages[1].role, 'user');
      assert.ok(messages[0].content.includes('知识图谱结构化抽取引擎') || messages[0].content.includes('结构化抽取引擎'));
      assert.ok(messages[0].content.includes('受控') || messages[0].content.includes('谓词'));
      assert.ok(messages[1].content.includes('AI是否会重塑教育形态？'));
      assert.ok(messages[1].content.includes('自适应学习系统演进'));
    });

    it('parseGraphExtractionResponse parses and validates high quality LLM response', () => {
      const sources = [
        makeSource('s1', 'zhihu', '自适应学习系统演进', '实证表明个性化教学提升效果'),
        makeSource('s2', 'web', '教育伦理与隐私风险', '算法偏见与认知惰性分析'),
      ];
      const report = makeReport(sources, 'AI是否会重塑教育形态？');

      const mockLLMJson = JSON.stringify({
        nodes: [
          {
            id: 'n0',
            label: 'AI重塑教育形态',
            type: 'topic',
            description: '核心讨论议题',
            sourceCitations: [],
          },
          {
            id: 'n1',
            label: '自适应学习系统',
            type: 'concept',
            description: '根据学生动态调整进度的AI算法',
            sourceCitations: [1],
          },
          {
            id: 'n2',
            label: '个性化教学效果',
            type: 'claim',
            description: '提升知识掌握与自主性',
            sourceCitations: [1],
          },
          {
            id: 'n3',
            label: '认知外包风险',
            type: 'claim',
            description: '长期依赖可能导致思维惰性',
            sourceCitations: [2],
          },
          {
            id: 'n4',
            label: '清华大学教育团队',
            type: 'actor',
            description: '实证研究发布机构',
            sourceCitations: [1],
          },
        ],
        edges: [
          {
            id: 'e1',
            from: 'n1',
            to: 'n2',
            predicate: '支持',
            label: '显著赋能',
            type: 'supported',
            citationId: 1,
            description: '自适应算法直接支持个性化教学',
          },
          {
            id: 'e2',
            from: 'n2',
            to: 'n3',
            predicate: '对比',
            label: '伴生风险',
            type: 'inferred',
            description: '教学效能与认知外包形成对立张力',
          },
          {
            id: 'e3',
            from: 'n0',
            to: 'n1',
            predicate: '依赖',
            label: '核心支柱',
            type: 'inferred',
            description: '教育重塑的核心技术支柱',
          },
          {
            id: 'e4',
            from: 'n4',
            to: 'n1',
            predicate: '主张',
            label: '研发推进',
            type: 'supported',
            citationId: 1,
            description: '团队主张推进自适应学习实践',
          },
        ],
      });

      const graph = parseGraphExtractionResponse(mockLLMJson, report);
      assert.ok(graph !== null, 'Graph parsing should succeed');
      assert.strictEqual(graph.isFallback, false);
      assert.strictEqual(graph.nodes.length, 5);
      assert.strictEqual(graph.nodes[0].id, 'n0');
      assert.strictEqual(graph.nodes[0].type, 'topic');

      const supported = graph.edges.filter((e) => e.type === 'supported');
      assert.strictEqual(supported.length, 2);
      assert.strictEqual(supported[0].citationId, 1);
    });

    it('parseGraphExtractionResponse handles markdown fences and downgrades non-existent citations', () => {
      const sources = [makeSource('s1', 'zhihu', '材料1', '内容1')];
      const report = makeReport(sources, '测试议题');

      const fencedLLMOutput = `\`\`\`json
{
  "nodes": [
    { "id": "n0", "label": "测试议题", "type": "topic", "description": "核心议题" },
    { "id": "n1", "label": "概念A", "type": "concept", "description": "描述A", "sourceCitations": [1, 999] },
    { "id": "n2", "label": "概念B", "type": "concept", "description": "描述B" }
  ],
  "edges": [
    { "id": "e1", "from": "n0", "to": "n1", "predicate": "支持", "label": "支持", "type": "supported", "citationId": 1 },
    { "id": "e2", "from": "n1", "to": "n2", "predicate": "影响", "label": "影响", "type": "supported", "citationId": 999 }
  ]
}
\`\`\``;

      const graph = parseGraphExtractionResponse(fencedLLMOutput, report);
      assert.ok(graph !== null);
      // Citation 999 should be sanitized out of node sourceCitations
      const n1 = graph.nodes.find((n) => n.id === 'n1');
      assert.deepStrictEqual(n1?.sourceCitations, [1]);

      // Edge e2 had non-existent citation 999, so it should be downgraded to inferred
      const e2 = graph.edges.find((e) => e.id === 'e2');
      assert.strictEqual(e2?.type, 'inferred');
      assert.strictEqual(e2?.citationId, undefined);
    });

    it('safeBuildGraphAsync uses LLM graph when provider succeeds and degrades cleanly on failure', async () => {
      const sources = [makeSource('s1', 'zhihu', '材料1', '内容1')];
      const report = makeReport(sources, '测试议题');

      const mockSuccessLLM = {
        generateStrategyQuestion: async () => '问题？',
        generateKnowledgeGraph: async () => ({
          nodes: [
            { id: 'n0', label: '测试议题', type: 'topic' as const, description: '议题' },
            { id: 'n1', label: 'LLM提取实体', type: 'concept' as const, description: '实体' },
          ],
          edges: [
            { id: 'e1', from: 'n0', to: 'n1', predicate: '支持' as const, label: '支持', type: 'inferred' as const, description: '关联' },
          ],
          isFallback: false,
        }),
      };

      const g1 = await safeBuildGraphAsync(report, sources, mockSuccessLLM);
      assert.strictEqual(g1.isFallback, false);
      assert.strictEqual(g1.nodes[1].label, 'LLM提取实体');

      // When LLM throws, degrades to deterministic safeBuildGraph
      const mockThrowingLLM = {
        generateStrategyQuestion: async () => '问题？',
        generateKnowledgeGraph: async () => {
          throw new Error('LLM timeout');
        },
      };

      const g2 = await safeBuildGraphAsync(report, sources, mockThrowingLLM);
      assert.ok(g2);
      assert.strictEqual(g2.nodes[0].id, 'n0');
    });
  });

  describe('KG-05: Blacklist Filter for Entity Noise Removal', () => {
    it('rejects question and contrast fragments without cutting Chinese words', () => {
      assert.strictEqual(sanitizeGraphLabel('是否有点'), null);
      assert.strictEqual(sanitizeGraphLabel('而不是诸葛亮'), null);
      assert.strictEqual(sanitizeGraphLabel('诸葛亮'), '诸葛亮');
    });

    it('does not promote a source nickname into a graph concept', () => {
      const source = makeSource('s1', 'zhihu', '人工智能治理机制', '模型治理需要可验证的评估标准。', '贝蒙斯坦');
      const report = makeReport([source]);
      const graph = buildGraph(report, [source]);

      assert.ok(!graph.nodes.some((node) => node.label === '贝蒙斯坦'));
      assert.ok(graph.nodes.some((node) => node.label === '人工智能治理机制' && node.type === 'concept'));
    });

    it('keeps an institutional source author as an actor without misclassifying its title', () => {
      const source = makeSource('s1', 'web', '人工智能治理机制', '模型治理需要可验证的评估标准。', '清华大学研究团队');
      const report = makeReport([source]);
      const graph = buildGraph(report, [source]);

      assert.ok(graph.nodes.some((node) => node.label === '清华大学研究团队' && node.type === 'actor'));
      assert.ok(graph.nodes.some((node) => node.label === '人工智能治理机制' && node.type === 'concept'));
    });

    it('correctly detects collective composite mentions as noise', () => {
      const compositeExamples = [
        '邓煜等菲奖得主',
        '陶哲轩等学者',
        '张三等专家',
        '李四等3人',
        '某学者等院士',
        '等菲奖得主',
      ];
      for (const item of compositeExamples) {
        const check = isBlacklistedEntityLabel(item);
        assert.strictEqual(check.isNoise, true, `Expected "${item}" to be flagged as noise`);
        assert.strictEqual(check.category, 'collective');
        assert.strictEqual(isEntityNoise(item), true);
        assert.strictEqual(sanitizeGraphLabel(item), null, `sanitizeGraphLabel should reject "${item}"`);
      }
    });

    it('correctly detects outline enumeration and placeholder labels as noise', () => {
      const enumExamples = [
        '观点 3',
        '观点3',
        '观点一',
        '观点 A',
        '论点 1',
        '核心观点 2',
        '分论点 3',
        '知识点 1',
        '论据 2',
        '证据 1',
        '第1点',
      ];
      for (const item of enumExamples) {
        const check = isBlacklistedEntityLabel(item);
        assert.strictEqual(check.isNoise, true, `Expected "${item}" to be flagged as noise`);
        assert.strictEqual(check.category, 'enumeration');
        assert.strictEqual(isEntityNoise(item), true);
        assert.strictEqual(sanitizeGraphLabel(item), null, `sanitizeGraphLabel should reject "${item}"`);
      }
    });

    it('correctly detects temporal news urgency adverbs as noise', () => {
      const temporalExamples = [
        '刚刚',
        '刚才',
        '日前',
        '近日',
        '突发',
        '重磅',
        '最新消息',
        '最新',
      ];
      for (const item of temporalExamples) {
        const check = isBlacklistedEntityLabel(item);
        assert.strictEqual(check.isNoise, true, `Expected "${item}" to be flagged as noise`);
        assert.strictEqual(check.category, 'temporal');
        assert.strictEqual(isEntityNoise(item), true);
        assert.strictEqual(sanitizeGraphLabel(item), null, `sanitizeGraphLabel should reject "${item}"`);
      }
    });

    it('correctly detects editorial and publishing boilerplate as noise', () => {
      const editorialExamples = [
        '全文完',
        '责任编辑',
        '参考资料',
        '相关阅读',
        '延伸阅读',
        '版权所有',
      ];
      for (const item of editorialExamples) {
        const check = isBlacklistedEntityLabel(item);
        assert.strictEqual(check.isNoise, true, `Expected "${item}" to be flagged as noise`);
        assert.strictEqual(check.category, 'editorial');
        assert.strictEqual(isEntityNoise(item), true);
      }
    });

    it('allows valid domain entities to pass through cleanly', () => {
      const validEntities = [
        '邓煜',
        '菲尔兹奖',
        '自适应学习系统',
        '清华大学教育团队',
        '认知外包风险',
        '人工智能意识涌现',
        '高等教育',
      ];
      for (const entity of validEntities) {
        assert.strictEqual(isEntityNoise(entity), false, `Expected "${entity}" NOT to be noise`);
        const sanitized = sanitizeGraphLabel(entity);
        assert.ok(sanitized, `Expected "${entity}" to pass sanitizeGraphLabel, got ${sanitized}`);
      }
    });

    it('filters out noise entities when parsing LLM response', () => {
      const report = makeReport([], '核心议题：AI与教育');
      const mockLLMJson = JSON.stringify({
        nodes: [
          { id: 'n0', label: 'AI与教育', type: 'topic', description: '核心议题' },
          { id: 'n1', label: '邓煜等菲奖得主', type: 'actor', description: '菲奖得主集体' },
          { id: 'n2', label: '观点 3', type: 'claim', description: '第三个观点' },
          { id: 'n3', label: '刚刚', type: 'concept', description: '时效修饰词' },
          { id: 'n4', label: '自适应学习系统', type: 'concept', description: '专业概念' },
          { id: 'n5', label: '清华大学团队', type: 'actor', description: '实证研究团队' },
          { id: 'n6', label: '是否有点', type: 'concept', description: '残缺疑问短语' },
          { id: 'n7', label: '而不是诸葛亮', type: 'claim', description: '残缺转折短语' },
        ],
        edges: [
          { id: 'e1', from: 'n0', to: 'n4', predicate: '依赖', type: 'inferred', description: '依赖机理' },
          { id: 'e2', from: 'n5', to: 'n4', predicate: '主张', type: 'inferred', description: '团队主张' },
        ],
      });

      const parsed = parseGraphExtractionResponse(mockLLMJson, report);
      assert.ok(parsed);
      const labels = parsed.nodes.map((n) => n.label);
      assert.ok(!labels.includes('邓煜等菲奖得主'), 'Must not include 邓煜等菲奖得主');
      assert.ok(!labels.includes('观点 3'), 'Must not include 观点 3');
      assert.ok(!labels.includes('刚刚'), 'Must not include 刚刚');
      assert.ok(!labels.includes('否有点'), 'Must not corrupt 是否有点 into 否有点');
      assert.ok(!labels.includes('而不是诸葛亮'), 'Must reject contrast fragments');
      assert.ok(labels.includes('自适应学习系统'), 'Must keep valid concept 自适应学习系统');
      assert.ok(labels.includes('清华大学团队'), 'Must keep valid actor 清华大学团队');
    });
  });

  describe('KG-06: Entity Association Profile Generation', () => {
    it('generates rich associationProfile for topic, actor, concept, and claim nodes', () => {
      const sources = [
        makeSource('s1', 'zhihu', '自适应教育系统实证研究', '研究表明算法导致个性化掌握度提升，文献支撑丰富', '清华大学研究团队'),
        makeSource('s2', 'web', '认知外包争议剖析', '讨论长期依赖算法所带来的认知钝化与自主性下降'),
      ];
      const report = makeReport(sources, 'AI是否会改变教育？');
      const graph = buildGraph(report, sources);

      // Verify all nodes have associationProfile populated
      assert.ok(graph.nodes.length >= 3);
      for (const node of graph.nodes) {
        assert.ok(
          typeof node.associationProfile === 'string' && node.associationProfile.length > 10,
          `Node ${node.id} (${node.label}) should have a meaningful associationProfile, got: ${node.associationProfile}`
        );
      }

      // Verify topic node association profile highlights hub nature and citations
      const topicNode = graph.nodes.find((n) => n.id === 'n0');
      assert.ok(topicNode);
      assert.ok(topicNode.associationProfile?.includes('核心议题枢纽'));
      assert.ok(topicNode.associationProfile?.includes('思辨论证网络'));

      // Verify actor node or concept node reflects relational semantics
      const nonTopicNodes = graph.nodes.filter((n) => n.id !== 'n0');
      for (const node of nonTopicNodes) {
        assert.ok(
          node.associationProfile?.startsWith('【'),
          `associationProfile should start with type bracket: ${node.associationProfile}`
        );
        assert.ok(
          node.associationProfile?.includes('拓扑') || node.associationProfile?.includes('关联'),
          `associationProfile should mention topology or relation: ${node.associationProfile}`
        );
      }
    });

    it('preserves existing custom associationProfile or enriches it dynamically', () => {
      const nodes = [
        { id: 'n0', label: '核心议题', type: 'topic' as const, description: '议题' },
        {
          id: 'n1',
          label: '自适应算法',
          type: 'concept' as const,
          description: '算法',
          associationProfile: '已有专业关联分析：作为基底机制驱动全流程。',
        },
        { id: 'n2', label: '认知风险', type: 'claim' as const, description: '风险论断' },
      ];
      const edges = [
        {
          id: 'e1',
          from: 'n0',
          to: 'n1',
          predicate: '依赖' as const,
          label: '依赖',
          type: 'supported' as const,
          citationId: 1,
          description: '议题依赖算法',
        },
        {
          id: 'e2',
          from: 'n1',
          to: 'n2',
          predicate: '导致' as const,
          label: '导致',
          type: 'inferred' as const,
          description: '算法导致风险',
        },
      ];
      const inputGraph = { nodes, edges };
      const enriched = enrichGraphWithAssociationProfiles(inputGraph);

      // n1 should keep its existing custom profile
      assert.strictEqual(
        enriched.nodes[1].associationProfile,
        '已有专业关联分析：作为基底机制驱动全流程。'
      );

      // n2 should have a freshly synthesized profile
      assert.ok(enriched.nodes[2].associationProfile);
      assert.ok(enriched.nodes[2].associationProfile.includes('研报核心观点'));
      assert.ok(enriched.nodes[2].associationProfile.includes('自适应算法'));
    });
  });
});
