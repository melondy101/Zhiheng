# 知研 — 架构说明

> 给接手这个项目的工程师。读完应该知道：模块怎么拆、数据怎么走、扩展点在哪里。

## 1. 顶层分层

```
┌────────────────────────────────────────────────────────────┐
│                     Pages (App Router)                      │
│  page.tsx · layout.tsx · components/ · share/[id]/page.tsx |
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

**API 路由**（`src/app/api/`）：
- `/health` — 健康检查
- `/hotlist` — 知乎热榜
- `/report` — 报告生成（检索链）
- `/interrogate` — 诘问引擎
- `/session` — 会话持久化
- `/share/[id]` — 公开分享（无需认证）
- `/recommendations` — 推荐问题列表
- `/profile` — 用户画像
- `/auth/*` — 邮箱认证（login/register/logout/me/send-code）

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

**相关推荐请求节流**：`/api/recommendations` 在报告面板渲染后，先检索一个相关话题，再按顺序检索至多三位已引用作者；不得用并发批量请求这四个站内搜索，以免触发知乎短时限流。该侧栏是非关键补充，不阻塞报告展示。

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
- Fallback：`src/lib/llm-fallback.ts` 的 `withFallback()` 包一层 — 失败重试 1 次，再使用策略模板；失败分类为 `timeout`、`network`、`http`、`invalid_response`、`invalid_synthesis` 或 `unknown`，UI 据此说明是响应慢、连接失败、服务拒绝还是返回内容未通过校验。

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

#### 正式化阶段：游客身份认领（设计决策）

MVP 的随机匿名 owner 仅用于演示期隔离，不能作为正式鉴权凭据。正式化时采用“游客先用、注册后认领”的身份模型：服务端签发并以 `HttpOnly`、`Secure`、`SameSite` Cookie 保存游客会话；所有会话、报告与画像先归该游客 identity。用户注册或登录后，服务端在一个事务中把当前游客 identity 的数据归属迁移或绑定到已验证的账户 identity，并使旧游客会话失效。

业务与存储仍只依赖稳定的 `ownerId` / identity scope，不把匿名 token 写入报告、消息或领域实体。账户态请求必须从服务端验证的登录会话解析 owner，不能信任客户端提交的 `x-zhiyan-owner`。未注册游客清除浏览器 Cookie、使用无痕窗口或更换设备前无法安全找回其数据；这是匿名体验的预期边界。

**排期约束**：在 Demo 的所有已承诺功能完成前，不实现 Cookie 会话、注册/登录或游客数据认领；当前匿名 owner 数据模型保持与未来账户数据模型兼容即可。身份正式化作为 Demo 收尾后的独立基础任务，且先于分享、跨设备和账户中心。

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

interface GraphNode {
  id: string;
  label: string;
  type: 'topic' | 'concept' | 'claim' | 'actor';
  description: string;
  associationProfile?: string; // 实体关联简介（拓扑承接、前置依赖或实证支撑定位）
  sourceCitations?: number[];
}

interface GraphEdge {
  id: string;
  from: string;
  to: string;
  subject: string;
  predicate: '支持' | '反驳' | '导致' | '依赖' | '影响' | '对比' | '构成' | '主张' | '相关';
  object: string;
  label: string;
  type: 'supported' | 'inferred' | 'user_claimed';
  citationId?: number;
  description?: string;
}
```

## 5. 成果卡 6 段

`buildDetailedResultCard(session)` 严格从 `session.messages.filter(m => m.role === 'user')` 派生：

1. **初始表达** — `session.initialOpinion`（用户在报告前输入）
2. **起始立场** — `session.selectedViewpoint`（AI 建议被选 / 用户自写）
3. **新增证据** — 中间轮的 user message
4. **观点修正** — 相邻 user message 文本不同 → 修正对
5. **你最后表达的观点** — 最后一个实质性 user message；它是可追溯的用户原话，不是 AI 自动总结
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
- **ZhihuOAuthProvider** — `src/lib/zhihu-oauth.ts` 提供 server-side OAuth 骨架：`state` 绑定当前会话、10 分钟有效且一次性消费；Token 只保存在进程内会话。`/api/auth/zhihu/start`、`callback`、`status` 与显式 `POST /data` 路由保留邮箱登录；创作、关注、收藏仅在授权用户主动请求时读取，且需要 `ZHIHU_ACCESS_SECRET`。读取 `favorite_contents` 时还必须由用户提交已选收藏夹的数字 `favlistUrlToken`。`GET /api/zhihu/quota` 仅查询 `creator` 与 `question_answers` 两组额度，用于讨论结束后的问题推荐与回答摘要的可用性披露。 `POST /api/recommendations/questions/profile` 仅在当前会话已绑定知乎 OAuth 后由用户主动调用：它暂时读取创作、关注、收藏列表，在内存中提炼主题，再调用主题问题推荐；不持久化原始数据，也不向问题推荐 API 转发 OAuth Token。
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
- LLM 失败 → 重试一次 + 策略模板；UI 按失败类别披露 ✓（`withFallback`）
- 图谱节点经标签清洗与黑名单过滤：基于正则与语义黑名单，剔除“邓煜等菲奖得主”等集合性修饰/代称、“观点 3”等占位/序号枚举、“刚刚/突发”等时效修饰副词、以及编务口语噪声；LLM 与确定性 fallback 共用规则 ✓
- 实体关联简介生成：图谱节点通过 `associationProfile` 动态合成结构化定位（核心议题枢纽、前置依赖、实证支撑与下游影响），并在详情面板与无障碍模式中展示 ✓
- 综合观点的每条证据必须能与其引用材料做词面追溯，且结论不能复述原问题 ✓
- 知识图谱允许正文后异步完成 ✓（API 路由 try/catch 包装）

## 10. 外部平台与数据库变更门禁

任何未来功能若需要变更 Neon、Vercel、外部模型供应商或数据库结构，必须在编码、迁移或平台操作**之前**向用户提交并获得确认的变更说明。说明至少包含：

- Neon 需要执行的操作（extension、表/索引、迁移、分支或连接配置）及数据/回滚影响；
- Vercel 需要执行的操作（环境变量、函数 runtime/region、部署环境与重新部署）；
- 新增或修改的表结构、迁移是否可逆、既有数据兼容性；
- 新增密钥、成本/配额、隐私边界与故障降级；
- 不执行平台变更时的本地或 fixture 降级行为。

知识库的语义检索是该门禁的首个适用场景：在启用 Neon `pgvector`、embedding 供应商或 Vercel 服务端检索前，先提供上述清单和执行顺序；未获确认不得操作外部平台或生产数据库。

### CloudBase 云托管运行时

CloudBase 云托管与 Vercel 是并列的部署目标，不迁移或替换任何 Provider。根目录 `Dockerfile` 从 Next.js standalone 输出启动 `server.js`，并显式携带 `public/` 与 `.next/static/`，以保证静态资源与样式可用；服务监听 `0.0.0.0:3000`。CloudBase 的环境变量名称、首次部署操作和真实 Provider 的受控验收边界见 [cloudbase-cloudrun.md](cloudbase-cloudrun.md)。`vercel.json` 与 Vercel 的原有构建流程保持不变。

## 11. 已知技术债

- `next` + `react` types 在某些 tsc 调用中报 `JSX.IntrinsicElements` 警告 — 预存
- Builder/Finalizer 工作流未在 `package.json` 中 script 化
- 3 主题 fixtures 数据有限 — 真实录制前需扩展
