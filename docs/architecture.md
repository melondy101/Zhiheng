# 知研 — 架构说明

> 给接手这个项目的工程师。读完应该知道：模块怎么拆、数据怎么走、扩展点在哪里。

## 1. 顶层分层

```
┌────────────────────────────────────────────────────────────┐
│                     Pages (App Router)                      │
│  page.tsx · layout.tsx · components/                        │
└─────────────────────┬──────────────────────────────────────┘
                      │
        ┌─────────────┼─────────────┐
        ↓             ↓             ↓
   ┌────────┐  ┌──────────┐  ┌────────────┐
   │  API   │  │  Client  │  │ Components │
   │ Routes │  │   Hooks  │  │ (RSC+CC)   │
   └────┬───┘  └────┬─────┘  └────────────┘
        │           │
        └─────┬─────┘
              ↓
   ┌──────────────────────────────────────┐
   │  Providers (lib/providers.ts 接口)   │
   │  ─────────────────────────────────  │
   │  Retrieval | LLM | Storage |          │
   │  Rendering | Identity                 │
   └──────────────────────────────────────┘
              │
        ┌─────┴──────────────────────┐
        ↓                            ↓
   浏览器 localStorage         服务器 fixture 数据
```

## 2. Provider 合约

所有 Provider 在 `src/lib/providers.ts` 中以纯 TypeScript interface 定义，**无副作用、无运行时依赖**。这保证客户端/服务端可共享，且新实现（Neon、OpenAI）可热替换。

### 2.1 RetrievalProvider

```typescript
interface RetrievalProvider {
  generateReport(
    question: string,
    onProgress?: (progress: ReportProgress) => void
  ): Promise<Report>;
}
```

**实现链**（API route `/api/report` 中组装）：
1. `ZhihuSearchProvider.search(question)` → 3-5 来源，type='zhihu'
2. `WebSearchProvider.search(question)` → 2-3 来源，type='web'
3. `HistorySearchProvider.search(question, excludedHistoryIds)` → 0-3 来源，type='personal_history'（来自 BrowserStorageProvider.listSessions）
4. 三个并行（Promise.all）
5. `buildReport({ question, zhihuSources, webSources, historySources, onProgress })` → 合并去重、编号、构建正文
6. `buildGraph(report, sources)` → 知识图谱

**降级链**（每个 Search Provider 内部）：
```
live API  ──┐
            ├─→ 抛异常
fresh cache ┘            ← #22：fresh cache 仅在 live 不可用或显式离线策略时使用，
                          │  绝不被 24h TTL 自动短路；配置有效时 live 永远先尝试
            │
stale cache ┘            ← stale cache 携带原始 updatedAt 与 `stale: true`
            │
demo fixture ┘
```

每次调用都会标记 `source: 'live' | 'cache' | 'demo'`，UI 显示。
#22 进一步要求：fresh / stale cache 回退路径下的 `Source.stale` 必须显式为 `false` / `true`，不得为 `undefined`（实现见 `src/lib/search-providers.ts`）。

### 2.2 LLMProvider

```typescript
interface LLMProvider {
  generateQuestion(session: Session): Promise<string>;
  generateStrategyQuestion(strategy: StrategyId, session: Session): Promise<string>;
}
```

**策略选择与生成分离**：
- 策略：`src/lib/strategy-engine.ts` 决定下一轮用哪个策略（M1/M2/M4/M6/M5）
- 生成：LLM 只在 `pickNextStrategy()` 给出的策略范围内出题
- Fallback：`src/lib/llm-fallback.ts` 的 `withFallback()` 包一层 — 失败重试 1 次，再使用策略模板

**#25 护栏（独立 contract 函数，不可只靠 system prompt）**：
- `src/lib/openai-llm-provider.ts` 导出 `assertNonJudgingQuestion(text)`，被 `isValidQuestionText` 通过 `try/catch` 消费为单一真相
- `JUDGMENT_PATTERNS` 8 条 + `VERDICT_PATTERNS` 4 条覆盖"该观点错误/正确/你应该放弃/结论是/评分/评级/你必须接受拒绝"等裁决家族
- 不合格输出 throw → `withFallback` 触发一次重试后切策略模板；轮次、用户消息不丢失
- 测试不调用真实模型；fake transport 可注入；凭据配置后真实 LLM 仍受同一护栏约束

### 2.3 StorageProvider

```typescript
interface StorageProvider {
  saveSession(session: Session): Promise<void>;
  loadSession(id: string): Promise<Session | null>;
  listSessions(): Promise<Session[]>;
  deleteSession(id: string): Promise<void>;
}
```

MVP 实现：`BrowserStorageProvider`（localStorage，key 前缀 `zhiyan_sessions:`）。
**生产替代**：Neon PostgreSQL adapter（#21 已实现），session 一行 + messages JSONB 列；匿名所有权通过 `x-zhiyan-owner` 头 + 服务端 `OwnerStorageScope` 隔离不同设备记录。
**#21 持久化语义**：
- 已完成会话只读：服务端 `mayWriteSession` 守卫阻止覆盖
- 画像删除 tombstone：`deletedAt != null` 阻止旧证据自动重建
- DB 不可用时降级 localStorage 并显式返回 `storage: 'unavailable'`，绝不伪称远端保存

**#24 持久化检索来源状态（已合并）**：
- `Session.reportSourceState: SessionReportSourceState` 把 `{ zhihu, web, zhihuUpdatedAt?, webUpdatedAt?, zhihuStale?, webStale? }` 写入 session 行本身
- `/api/report` 在 `saveSession` 前通过 `buildSessionSourceState()` 持久化；`KnowledgeGraph.sourceState` 同时透传相同字段
- 客户端恢复优先级：`session.reportSourceState` → legacy side-key（`zhiyan_report_state:<id>`）→ `未披露` 兜底；side-key 不再是跨设备真相
- 跨浏览器恢复：同 `sessionId` 在第二个浏览器只需 GET `/api/session?id=...`，无需本地 side-key 即可恢复 badge
- owner 隔离：陌生 `sessionId` 直接 404，绝不串号
- migration 幂等：`reportSourceState` 存储在 session 行的 JSONB `data` 列中，无需 schema 变更；现有 `CREATE TABLE/INDEX IF NOT EXISTS` 语句在 `src/lib/db/migrations.ts` 保持幂等
- 无 DB 降级：`/api/health` 暴露 `remotePersistence: boolean`；ReportPanel 在 `remotePersistence === false` 时显式标注 "本地存储：未同步到远端"，绝不伪称远端保存

### 2.4 RenderingProvider / IdentityProvider

`StaticReportRenderer` 当前是 `structuredClone()` — 保持数据不可变。`AnonymousIdentityProvider` 返回固定 `anon` 身份。两者未来用于 SSR/Neon 时扩展。

## 3. 状态机

### 3.1 页面级（page.tsx）

```
home ──[handleStart]──→ session (loading=false, report set)
                            │
                            ├─[!selectedViewpoint & !completed]──→ StanceSelector
                            │
                            ├─[selectedViewpoint & !completed]──→ QAPanel
                            │     │
                            │     ├─[每轮 handleSendAnswer]──→ 新 user message
                            │     │     │
                            │     │     └─[3+ 不确定] OR [用户点退出]
                            │     │                              ↓
                            │     └─[自动完成]──→ buildResultCard
                            │                              ↓
                            └─[completed]────────→ ResultCardView
```

**关键不变量**：
- 任何时刻只有一个 report 状态
- session 持久化在每次 `setSession` 之后立即 `saveSession`
- URL 携带 `?session=<id>`，刷新时从 BrowserStorageProvider 恢复

### 3.2 诘问引擎（strategy-engine.ts）

```
Round 1: M1_evidence    (证据追问)
Round 2: M2_premise     (前提追问)
Round 3: M4_steelman    (钢铁人反驳)
Round 4: M6_reversal    (立场反转)
Round 5: M5_restate     (观点重述)
       └─[checkpoint]──→ 用户选择"继续"或"结束"
Round 6+: 旋转选择 (M1/M2/M4/M6)，不立即重复
       └─每 3 轮 checkpoint (5, 8, 11, 14…)
```

策略历史持久化在 `session._strategyHistory`（运行时属性）。
**用户主动退出任何时候可用** — `handleCompleteNow()`。

## 4. 数据模型（核心字段）

```typescript
interface Session {
  id: string;
  question: string;
  initialOpinion: string | null;
  report: Report | null;
  knowledgeGraph: KnowledgeGraph | null;
  selectedViewpoint: Viewpoint | null;
  messages: Message[];          // role: 'user' | 'assistant'
  resultCard: ResultCard | null;
  completed: boolean;
  createdAt: number;
  updatedAt: number;
  excludedHistoryIds?: string[];
  reportSourceState?: { zhihu: SourceState; web: SourceState; zhihuUpdatedAt?: number; webUpdatedAt?: number; zhihuStale?: boolean; webStale?: boolean };
}

interface Viewpoint {
  id: string;
  text: string;
  source: 'user_authored' | 'ai_suggested_and_selected' | 'ai_authored';
  selectedAt?: number;
}

interface Report {
  question: string;
  title: string;
  knowledgePoints: string[];
  content: string;             // 含 [N] 引用标记
  viewpoints: string[];        // 旧版纯文本
  structuredViewpoints?: Viewpoint[];  // #8 新版带 provenance
  references: Source[];
  citations: Record<number, Source>;
}

interface Source {
  id: string;
  type: 'zhihu' | 'web' | 'ai_synthesis' | 'personal_history';
  author: string | null;       // null = 缺失，绝不编造
  title: string | null;
  url: string | null;
  excerpt: string | null;
  sourceSessionId?: string;
}
```

## 5. 成果卡 6 段

`buildDetailedResultCard(session)` 严格从 `session.messages.filter(m => m.role === 'user')` 派生：

1. **初始表达** — `session.initialOpinion`（用户在报告前输入）
2. **起始立场** — `session.selectedViewpoint`（AI 建议被选 / 用户自写）
3. **新增证据** — 中间轮的 user message
4. **观点修正** — 相邻 user message 文本不同 → 修正对
5. **最终观点** — 最后一个 user message
6. **未解决问题** — 当前为空数组（未来由 LLM 提取）

每段都有可追溯的 `messageId`（点击可定位原消息）。
**强约束**：assistant 消息**绝不**出现在 user 字段（构建器只过滤 `role === 'user'`）。

## 6. 简化画像

`src/lib/lifecycle.ts`:
- `buildProfileFromSession()` 从已 completed session 提取 2 个 conclusion：
  - `interest`（来自 selectedViewpoint）
  - `thinking_style`（基于最后消息长度）
- 每个 conclusion 字段：field, value, confidence, sourceSessionId, sourceMessageId, updatedAt
- 删除语义：`deletedAt != null` 阻止 `updateProfile()` 自动重建

## 7. 扩展接口（不实现，留空位）

- **ModeConfig** (`quick` / `deep` / `fun` / `galgame`) — `strategy-engine` 接受配置化的 `allowedStrategies`
- **完整用户画像** — `lifecycle.ts` 已有骨架，加更多 `field` 类型
- **ZhihuOAuthProvider** — `IdentityProvider` 接口预留
- **Neon 存储** — `StorageProvider` 接口已稳定

## 8. 测试结构

```
tests/
├── unit/providers.test.ts         # 113 tests, 29 suites
│   - FixtureRetrievalProvider
│   - FixtureLLMProvider
│   - BrowserStorageProvider
│   - AnonymousIdentityProvider
│   - StaticReportRenderer
│   - buildResultCard / buildDetailedResultCard
│   - HotlistProvider
│   - ZhihuSearchProvider / WebSearchProvider
│   - ReportBuilder
│   - HistorySearchProvider
│   - buildGraph
│   - buildStructuredViewpoints
│   - pickNextStrategy / isCheckpointRound
│   - withFallback / isUncertainAnswer
│   - isReadOnly / continueFromCompleted
│   - buildProfileFromSession / updateProfile
│   - DEMO_FIXTURES
└── e2e/
    ├── golden-path.spec.ts        # 最小闭环
    └── demo-golden-path.spec.ts   # 3 个演示主题
```

## 9. 性能与降级目标（PRD 10.6）

- 2 秒内出现可见进度反馈 ✓（`loading` 状态）
- 尽量 15 秒内完成报告正文 ✓（fixture 延迟 200-500ms + 50ms 构建）
- 20 秒仍未完成 → 缓存降级 ✓（searchWithTimeout 5s）
- LLM 失败 → 重试一次 + 策略模板 ✓（`withFallback`）
- 知识图谱允许正文后异步完成 ✓（API 路由 try/catch 包装）

## 10. 已知技术债

- `next` + `react` types 在某些 tsc 调用中报 `JSX.IntrinsicElements` 警告 — 预存
- Builder/Finalizer 工作流未在 `package.json` 中 script 化
- 3 主题 fixtures 数据有限 — 真实录制前需扩展
