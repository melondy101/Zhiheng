import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  KNOWLEDGE_BASE_ITEMS,
  InMemoryKnowledgeBaseProvider,
  PgVectorKnowledgeBaseProvider,
  cosineSimilarity,
  getKnowledgeBaseItemForStrategy,
  STRATEGY_TO_KB_ITEM_ID,
} from '../../src/lib/knowledge-base';
import type { SqlExecutor } from '../../src/lib/db/sql-executor';
import { buildReport } from '../../src/lib/report-builder';
import type { Source } from '../../src/lib/providers';

describe('M2 Knowledge Base: Data Integrity', () => {
  it('contains valid structured items across all 4 categories', () => {
    assert.ok(KNOWLEDGE_BASE_ITEMS.length >= 15, 'Should have at least 15 curated knowledge base items');
    
    const categories = new Set(KNOWLEDGE_BASE_ITEMS.map((item) => item.category));
    assert.ok(categories.has('philosophy'), 'Must contain philosophy items');
    assert.ok(categories.has('debate'), 'Must contain debate items');
    assert.ok(categories.has('logic'), 'Must contain logic items');
    assert.ok(categories.has('domain'), 'Must contain domain items');

    for (const item of KNOWLEDGE_BASE_ITEMS) {
      assert.ok(item.id.trim().length > 0, `Item ${item.id} must have non-empty id`);
      assert.ok(item.topic.trim().length > 0, `Item ${item.id} must have topic`);
      assert.ok(item.title.trim().length > 0, `Item ${item.id} must have title`);
      assert.ok(item.summary.trim().length > 0, `Item ${item.id} must have summary`);
      assert.ok(item.content.trim().length > 0, `Item ${item.id} must have content`);
      assert.ok(item.tags.length > 0, `Item ${item.id} must have at least one tag`);
      assert.ok(item.suggestedQuestions.length > 0, `Item ${item.id} must have suggested questions`);
    }
  });

  it('verifies unique IDs across all items', () => {
    const ids = new Set<string>();
    for (const item of KNOWLEDGE_BASE_ITEMS) {
      assert.ok(!ids.has(item.id), `Duplicate knowledge base id: ${item.id}`);
      ids.add(item.id);
    }
  });
});

describe('M2 Knowledge Base: InMemory Retrieval Provider', () => {
  const provider = new InMemoryKnowledgeBaseProvider();

  it('searches by keyword and returns relevant items with positive scores', async () => {
    const results = await provider.search('苏格拉底 反诘法');
    assert.ok(results.length > 0, 'Should find results for 苏格拉底');
    assert.strictEqual(results[0].item.id, 'philo-socratic-elenchus');
    assert.ok(results[0].score > 0, 'Score should be positive');
  });

  it('searches by fallacy tags / fallacy names', async () => {
    const results = await provider.search('稻草人 歪曲论点');
    assert.ok(results.length > 0, 'Should find straw man item');
    assert.strictEqual(results[0].item.id, 'logic-straw-man');
    assert.strictEqual(results[0].item.category, 'logic');
  });

  it('filters results by category', async () => {
    const results = await provider.search('检验', { category: 'philosophy' });
    assert.ok(results.length > 0);
    for (const res of results) {
      assert.strictEqual(res.item.category, 'philosophy');
    }
  });

  it('handles empty query gracefully with category fallback', async () => {
    const results = await provider.search('', { category: 'debate', limit: 3 });
    assert.ok(results.length > 0);
    assert.ok(results.length <= 3);
    for (const res of results) {
      assert.strictEqual(res.item.category, 'debate');
    }
  });

  it('retrieves single item by id', async () => {
    const item = await provider.getItem('debate-toulmin-model');
    assert.ok(item !== null);
    assert.strictEqual(item?.topic, '图尔敏论证六要素模型');

    const nonExistent = await provider.getItem('non-existent-id');
    assert.strictEqual(nonExistent, null);
  });

  it('lists items by category and listAll', async () => {
    const logicItems = await provider.listByCategory('logic');
    assert.ok(logicItems.length >= 5);
    for (const item of logicItems) {
      assert.strictEqual(item.category, 'logic');
    }

    const all = await provider.listAll();
    assert.strictEqual(all.length, KNOWLEDGE_BASE_ITEMS.length);
  });
});

describe('M2 Knowledge Base: Cosine Similarity', () => {
  it('computes exact similarity for identical and orthogonal vectors', () => {
    const vecA = [1, 0, 0];
    const vecB = [1, 0, 0];
    const vecC = [0, 1, 0];
    const vecD = [-1, 0, 0];

    assert.strictEqual(Math.round(cosineSimilarity(vecA, vecB) * 1000) / 1000, 1);
    assert.strictEqual(Math.round(cosineSimilarity(vecA, vecC) * 1000) / 1000, 0);
    assert.strictEqual(Math.round(cosineSimilarity(vecA, vecD) * 1000) / 1000, -1);
  });

  it('handles empty or mismatched vectors safely without throwing', () => {
    assert.strictEqual(cosineSimilarity([], []), 0);
    assert.strictEqual(cosineSimilarity([1, 2], [1, 2, 3]), 0);
  });
});

describe('M2 Knowledge Base: Strategy Mapping', () => {
  it('maps all standard and deep interrogation strategies to curated knowledge base items', () => {
    const strategies = Object.keys(STRATEGY_TO_KB_ITEM_ID);
    assert.ok(strategies.includes('M1_evidence'));
    assert.ok(strategies.includes('M2_premise'));
    assert.ok(strategies.includes('M4_steelman'));
    assert.ok(strategies.includes('M6_reversal'));
    assert.ok(strategies.includes('M8_contradiction'));

    for (const strat of strategies) {
      const item = getKnowledgeBaseItemForStrategy(strat);
      assert.ok(item !== null, `Strategy ${strat} should resolve to a valid KB item`);
      assert.ok(item?.title.length > 0);
    }
  });
});

describe('M2 Knowledge Base: PgVector Provider Degradation & Seam', () => {
  it('falls back seamlessly to in-memory when executor is null', async () => {
    const pgProvider = new PgVectorKnowledgeBaseProvider(null);
    const results = await pgProvider.search('滑坡谬误');
    assert.ok(results.length > 0);
    assert.strictEqual(results[0].item.id, 'logic-slippery-slope');
  });

  it('falls back gracefully to in-memory when database query throws', async () => {
    const failingExecutor: SqlExecutor = {
      async query() {
        throw new Error('Database connection timeout');
      },
    };
    const pgProvider = new PgVectorKnowledgeBaseProvider(failingExecutor);
    const results = await pgProvider.search('黑格尔');
    assert.ok(results.length > 0);
    assert.strictEqual(results[0].item.id, 'philo-hegel-dialectic');
  });
});

describe('M2 Knowledge Base: Report Builder Integration', () => {
  it('integrates kbSources into report references with correct citation type and numbering', async () => {
    const zhihuSources: Source[] = [
      {
        id: 'zh_1',
        type: 'zhihu',
        author: '知乎答主',
        title: '知乎讨论',
        url: 'https://zhihu.com/question/1',
        excerpt: '知乎讨论内容摘要',
      },
    ];
    const webSources: Source[] = [];
    const kbSources: Source[] = [
      {
        id: 'kb_philo-socratic-elenchus',
        type: 'knowledge_base',
        author: '哲学思辨知识库',
        title: '苏格拉底反诘法',
        url: null,
        excerpt: '通过层层剖析概念定义寻找反例。',
        category: 'philosophy',
        topic: '苏格拉底反诘法',
      },
    ];

    const result = await buildReport({
      question: '如何看待人工智能的道德责任？',
      zhihuSources,
      webSources,
      kbSources,
    });

    assert.ok(result.report);
    assert.strictEqual(result.report.references.length, 2);
    
    // Check citation types
    const kbRef = result.report.references.find((r) => r.type === 'knowledge_base');
    assert.ok(kbRef !== undefined, 'Report must contain knowledge_base reference');
    assert.strictEqual(kbRef?.title, '苏格拉底反诘法');

    // Check progress stages emitted
    const stages = result.progress.map((p) => p.stage);
    assert.ok(stages.includes('kb_search'), 'Progress must include kb_search stage');
  });
});
