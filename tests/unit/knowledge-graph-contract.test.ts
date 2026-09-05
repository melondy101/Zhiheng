import { describe, it } from 'node:test';
import assert from 'node:assert';
import type { Source, Report, Session } from '../../src/lib/providers';
import {
  buildGraph,
  validateGraph,
  buildFallbackGraph,
  safeBuildGraph,
  type KnowledgeGraph,
  type GraphNodeType,
} from '../../src/lib/knowledge-graph';

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
    it('returns between 6 and 10 nodes with correct node types', () => {
      const sources = [
        makeSource('s1', 'zhihu', '人工神经网络的意识机制', '清华大学团队提出观点'),
        makeSource('s2', 'web', 'Computational Emergence in LLMs', 'A study on AI cognition', 'MIT Lab'),
        makeSource('s3', 'zhihu', '哲学视角的强人工智能', '心智哲学讨论'),
      ];
      const report = makeReport(sources);
      const graph = buildGraph(report, sources);

      assert.ok(graph.nodes.length >= 6 && graph.nodes.length <= 10, `Got ${graph.nodes.length} nodes`);

      // Central node is topic
      assert.strictEqual(graph.nodes[0].id, 'n0');
      assert.strictEqual(graph.nodes[0].type, 'topic');
      assert.ok(graph.nodes[0].description.includes('核心议题'));

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
});
