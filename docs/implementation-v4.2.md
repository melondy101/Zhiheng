# 知研——实现文档（v4.2）

> 版本：v4.2
> 日期：2026-09-13
> 对应 PRD：[2026-09-02-zhiyan-design-v4.2.md](./2026-09-02-zhiyan-design-v4.2.md)
> 状态：基于代码审计的实现记录，标注了与 spec 的已知偏差

---

## 0. 文档目的

本文档记录 v4.2 PRD 各章节在代码库中的实际落点，包括关键文件、数据流、测试覆盖，以及实现与 spec 的已知偏差。它**不是** PRD 重述：凡是 spec 原文，以 PRD 为准；本文只写“代码实际做了什么”。

---

## 1. PRD § → 实现文件映射

| PRD § | 主题 | 主要实现文件 |
|--------|-------|---------------------|
| §2 | 热榜持久化缓存 | `src/lib/zhihu-retrieval.ts`（`LiveHotlistProvider.fetchHotlistFromSnapshot`），`src/lib/db/hotlist-snapshot-store.ts`，`src/app/api/hotlist/route.ts`，`src/lib/hotlist-route-wiring.ts`，`src/lib/hotlist-refresh-limiter.ts`，`src/lib/hotlist-providers.ts`（客户端 legacy） |
| §3 | 报告观点化 | `src/lib/report-builder.ts`（`buildReport`），`src/lib/report-synthesis.ts`（验证+解析），`src/app/api/report/route.ts`（并行检索） |
| §4.1 | 消息归属与持久化 | `src/lib/providers.ts`（`Message` 接口 + `isRoundAnswer`），`src/lib/interrogation-orchestrator.ts`（持久化写入），`src/app/api/interrogate/route.ts` |
| §4.2 | 即时发送体验 | `src/app/page.tsx`（乐观插入、`applyInterrogateResponse` 协调、失败重试） |
| §4.3 | 刘看山状态 | `src/lib/feedback-cue-state.ts`（`deriveFeedbackCueState`），`src/app/components/SessionFeedbackCue.tsx` |
| §5 | 温和自适应思辨 | `src/lib/gentle-interrogation.ts`（意图分类 + `generateGentleResponse`），`src/lib/interrogation-orchestrator.ts`（`handleInterrogate` 中 `answer` 分支） |
| §7 | 交付拆分 | 跟踪至 `src/lib/hotlist-route-wiring.ts`（T1），`src/lib/report-builder.ts`（T2），`src/app/page.tsx` + `src/lib/session-recovery.ts`（T3），`src/lib/gentle-interrogation.ts` + `src/lib/interrogation-orchestrator.ts`（T4） |

---

## 2. 按区域的实现说明

### §2 热榜：持久化缓存与诚实降级

**两条代码路径**（位于 `LiveHotlistProvider.fetchHotlist()`，`src/lib/zhihu-retrieval.ts`）：

1. **有 `snapshotStore`**：`fetchHotlistFromSnapshot()` 以**缓存优先**运行。它检查持久化快照的 `updatedAt` 是否仍在**同一个北京时间整点槽**内（`isHotlistSnapshotFresh()`）。若未过期 → 直接返回缓存，不调用外部 API。若过期或缺失 → 调用 live，成功则持久化，失败则返回过期快照或 demo。
2. **无 `snapshotStore`**（无 `DATABASE_URL`）：后备路径跳过数据库缓存，请求变为 fresh live attempt（若配置 secret），否则回退 demo。

**`/api/hotlist` 路由**（`src/app/api/hotlist/route.ts`）通过 `loadHotlistForRoute()` 组合 store + provider，并支持 `?refresh=true` / `?force=true` 手动刷新，同时通过 `src/lib/hotlist-refresh-limiter.ts` 对每个 owner 实施每小时 10 次上限。

**首页表达**：`src/app/components/HomePage.tsx` 的 `sourceLabel()` 将 source/cache/demo 映射为 PRD §2.3 措辞：`实时热榜`、`缓存 · 更新于 ...`、`缓存已过期 · 更新于 ...`、`演示数据`。

**偏差：TTL 是北京时间整点槽，不是固定 6 小时**
PRD §2.2 写固定 6 小时；实现按 `getBeijingHourSlot()` 判定 freshness，同一整点槽内都算 fresh。一次成功的 08:00 抓取在 08:59 前都算新鲜，09:00 立刻过期。

**为什么**：知乎热榜 API 限额约 100 次/天，整点刷新（24 次/天）既远低于限额，也与热榜的自然更新节奏一致。固定 6 小时虽然更宽松，但不能保证在整点更新时返回新鲜快照。

**相关测试**：`tests/unit/hotlist-snapshot-cache.test.ts`、`tests/unit/hotlist-resolver.test.ts`、`tests/unit/hotlist-source-label.test.ts`、`tests/integration/hotlist-route-wiring.test.ts`。

---

### §3 报告：多观点 + 按观点组织证据

**数据流**：

1. **并行检索**（`src/app/api/report/route.ts`）：`Promise.all([zhihuProvider.search(), webProvider.search(), historyProvider.search(), kbProvider.search()])`。每个 provider 内部走 live → cache → demo，且不抛出。
2. **报告构建**（`src/lib/report-builder.ts` 的 `buildReport()`）：合并去重来源，构建引用，调用 `buildSynthesis()` 生成结构化观点。
3. **综合生成与验证**（`src/lib/report-synthesis.ts`）：
   - LLM 返回结构化 JSON；
   - `parseSynthesisResponse()` 做严格校验：结论不能是材料标题/摘要复述（`isLiftedFromMaterial`），不能复述问题（`isQuestionRestatement`），evidence summary 必须与被引用材料有可追溯文本重叠（`isEvidenceTraceable`），`citationIds` 只能指向真实引用。
   - 验证失败 → `synthesis: null`，UI 走诚实降级，不会把无效输出伪装成观点。
4. **降级行为**：
   - LLM 未配置 → `synthesis: null`，诊断信息明确说明未配置秘钥；
   - LLM 失败/超时/格式异常 → `synthesis: null` + `classifyLLMError()` 诊断；
   - 测试模式（无 llmProvider）→ 使用确定性材料立场作为 fallback synthesis。

**偏差：综合结论是结构化 viewpoints，不是独立自由文本段落**
PRD §3.3 用“综合结论”段落表达观点比较；实现改为每个 `ReportViewpoint.evidence` 承载支撑材料，最终 `synthesis.viewpoints` 直接表达可讨论判断。这样做是为了让每个观点的出处都可追踪，避免一个无法落款的“综合结论”段落。

---

### §4 会话：完整历史、即时回显与真实状态

**消息归属与持久化**
`src/lib/providers.ts` 定义 `Message` 与 `isRoundAnswer()`；所有 assistant 文本和用户输入都通过 `src/lib/interrogation-orchestrator.ts` 持久化到 session。刷新或恢复后，完整消息列表从持久化 session 恢复，不会只看到当前待答问题。

**乐观发送与失败重试**
`src/app/page.tsx` 的 `handleSendAnswer()` 在用户点击发送后立即插入一条 `status='pending'` 的 optimistic message；`applyInterrogateResponse()` 根据服务端返回决定是确认、标记 failed，还是保留 pending。用户可点击 failed 消息重试（`handleRetryMessage()`）。

**会话恢复**
`src/lib/session-recovery.ts` 的 `pickRecoverySession()` 实现“server 优先 → newer wins → completed 不降级”的恢复规则；`page.tsx` 在 `?session=` 恢复流程中组合 local/remote，并重新持久化到浏览器。

---

### §5 温和自适应思辨

**意图分流**
`src/lib/gentle-interrogation.ts` 的 `classifyIntent()` 区分 `question` / `response`：
- 用户提问 → 先直接回答，再给一句温和追问；
- 用户作答 → 承接观点，再按策略追问。

**三轮关口**
`directiveRound` 只对实质性回答递增；`shouldSuggestSummary()` 在 `directiveRound > 0 && directiveRound % 3 === 0` 时返回 `true`，UI 显示“继续聊 / 生成总结”。用户可随时 `action='complete'` 主动结束。

**语气护栏**
`generateGentleResponse()` 控制语气与追问长度；LLM 失败时使用 `withFallback()` 提供的模板，并记录 `usedFallback`。

---

### §4.3 刘看山状态

`src/lib/feedback-cue-state.ts` 的 `deriveFeedbackCueState()` 从现有状态派生：`loading` → `retrieving`，`completed` → `completed`，会话中 M4/M6 → `challenging`，其余策略 → `questioning`。

**偏差：粒度只到策略级别，没有“正在组织回答 / 等待输入”的细分**。当前实现依赖已持久化的 strategy state，是一种务实选择；若未来要增加“thinking/idle”细分，需要在 orchestration state 中新增时机字段。

---

## 3. 与 spec 的已知偏差

1. **热榜 TTL = 北京时间整点槽，不是固定 6 小时**。详见 §2。
2. **综合结论为结构化 viewpoints，不是独立自由文本段落**。详见 §3。
3. **刘看山状态粒度较粗**：只有 `questioning` / `challenging`，没有“正在组织”与“等待输入”的细分。详见 §4.3。
4. **旧版 checkpoint 分支仍保留在代码中**，但 gentle pathway 已不再产生，仅用于兼容 pre-gentle session 的恢复。
5. **客户端 hotlist provider 仍为 24 小时 TTL**：`src/lib/hotlist-providers.ts` 是浏览器端 legacy 路径，真实热榜已由服务端 `/api/hotlist` 主导。

---

## 4. 测试覆盖

| 验证目标 | 关键测试文件 |
|----------|---------------|
| 热榜 cache-first、source label、手动刷新限流 | `tests/unit/hotlist-snapshot-cache.test.ts`、`tests/unit/hotlist-resolver.test.ts`、`tests/unit/hotlist-source-label.test.ts`、`tests/integration/hotlist-route-wiring.test.ts` |
| 报告观点验证、evidence traceability | `tests/unit/report-synthesis.test.ts`、`tests/integration/report-synthesis-api.test.ts` |
| 乐观消息协调、重试、恢复 | `tests/unit/optimistic-reconcile.test.ts`、`tests/unit/session-recovery.test.ts` |
| 会话状态恢复 | `tests/unit/session-recovery.test.ts`、`tests/integration/storage-degradation.test.ts` |
| 反馈提示状态派生 | `tests/unit/feedback-cue-state.test.ts`、`tests/unit/session-feedback-cue.test.tsx` |
| 温和思辨、意图分类、round 推进 | `tests/unit/round-progression.test.ts`、`tests/integration/interrogate-intent.test.ts`、`tests/e2e/gentle-interrogation-golden-path.spec.ts` |

---

## 5. 尚未实现的 v4.2 相关项

- **成果卡与会话保存的独立显式步骤**：当前是持续持久化，没有单独的“保存”动作。
- **批量视角推理**：PRD 建议多轮调用生成视角再合并；当前为单轮 synthesis + strict validation。
- **完整 8 策略 + 19 陷阱检测**：当前只实现 M1/M2/M4/M6/M5 子集。

---

*文档版本：v4.2 | 最后更新：2026-09-13*
