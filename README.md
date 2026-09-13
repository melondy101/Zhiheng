# 知研 (Zhiyan) — AI 时代的思辨陪练

> 知乎黑客松 MVP · Next.js 15 + React 19

让 AI 通过追问帮助人类打磨观点，而非替用户思考。报告、引用、知识图谱、温和自适应思辨、三轮定向关口与可追溯成果卡 — 完整可演示。

> 独立开发、已部署的原型：AI 提供证据与追问结构，但不替用户裁决观点；真实服务不可用时，界面会诚实区分缓存、fixture 与本地降级。<br>
> *An independently built thinking companion that helps people examine ideas without deciding for them.*

[在线体验](https://zhiheng-4yvv7zg1f-2014596548-3040s-projects.vercel.app) · [产品设计](./docs/prd/2026-09-13-zhiyan-design-v5.0.md) · [架构说明](docs/architecture.md)

---

## 快速开始

```bash
# 安装依赖
npm install

# 开发模式
npm run dev
# → http://localhost:3000

# 生产构建
npm run build
npm start

# 质量门禁
npm run typecheck   # TypeScript 严格模式
npm test            # 单元与集成测试
npm run test:e2e    # E2E（含 LLM 失败降级 Golden Path）
npm run check       # 全量门禁
```

> **端口说明**：应用默认监听 `3000`；Playwright/E2E 使用 `3001`，请不要把两个端口混写。
> **凭据**：`.env.local` 须包含 `ZHIHU_ACCESS_SECRET` + `LLM_API_KEY` + `LLM_MODEL` 才走真实 Provider；缺失时自动降级到 fixture，且 UI/源标签绝不标 live。`DATABASE_URL` 缺失则降级 localStorage。短链分享需要 `SINK_BASE_URL` + `SINK_API_KEY` + `SHARE_BASE_URL`；不配 Sink 仍可生成普通分享长链接。邮件认证可任选 SMTP（至少 `SMTP_USER` + `SMTP_PASS`）或 Resend（`RESEND_API_KEY` + `RESEND_FROM_EMAIL`）；两者同时配置时 SMTP 优先。

## 部署

现有 Vercel 部署流程与 [`vercel.json`](vercel.json) 保持不变。CloudBase 云托管（CloudRun）部署使用根目录 [`Dockerfile`](Dockerfile)，容器监听 `3000`；首次部署、变量清单和受控验收边界见 [CloudBase 云托管部署说明](docs/cloudbase-cloudrun.md)。

## 演示路径

启动 dev server 后，浏览器打开 `http://localhost:3000`，按以下任一路径走完：

1. **首页** → 输入问题，或点击知乎热榜 Top 10；热榜标题会拆成单一核心问题，原标题保留为背景（带 live/cache/demo 状态徽章）
2. **报告生成** → 知乎 + 全网并行检索（live-first；失败按 fresh cache → stale cache → demo 降级）；引用区对 Provider null 元数据自动显示"（无摘要）"占位而非字面 `null`
3. **观点引导** → 选 3 个 AI 建议之一 / 自写
4. **历史材料管理**（GitHub #23，integration `81771a1`） → 报告"本报告引用 N 条个人历史"列表；勾掉单项 → 点"重新生成报告"→ 新报告排除该条、保留其余；原 session 不删；空状态显示"暂无任何引用材料"
5. **温和自适应思辨** → 意图分流（用户提问时先直接回答+温和追问；用户作答时先承接+策略追问）→ 每 3 轮出现继续/总结选择；LLM 在配置有效时按真实模型出题，否则稳定走策略模板（不替用户裁决）
6. **成果卡** → 6 段可追溯（初始表达/起始立场/新增证据/观点修正/你最后表达的观点/未解决问题）；它不把用户原话伪装成 AI 总结
7. **刷新页面** → 重新打开成果卡（localStorage 或 Neon 跨设备恢复，owner header 隔离）
8. **公开分享** → 分享按钮生成链接；打开 `/share/[id]` 无需登录即可查看成果卡。当前已生成用于分享的 Markdown 内容；Markdown 文件和知识图谱 PNG 的下载入口、PDF 导出仍未接入成果卡界面。

**三个预置主题**（可在 `src/lib/demo-sources.ts` 找到，fixture 降级时强制使用）：
- `AI是否会取代人类创造力`（AI/技术）
- `远程工作是否应该成为常态`（社会/生活）
- `35岁程序员是否应该转管理`（职场/教育/个人选择）

## 核心架构

```
┌──────────────────┐   ┌────────────────┐
│  Pages (App Dir) │ ←→│   API Routes   │ ← 13+ 个 API 路由模块
│  Home / Session  │   └────────┬───────┘
└────────┬─────────┘            ↓
         ↓              ┌────────────────┐
   ┌──────────────┐     │   Providers    │ ← 6 类稳定接口
   │  Components  │ ←→  │  (lib/)        │
   └──────────────┘     └────────────────┘
```

详细架构、数据流、Provider 合约、扩展接口 → [docs/architecture.md](docs/architecture.md)

## API 速查

| 方法 | 路径 | 用途 |
|------|------|------|
| GET  | `/api/health` | 健康检查 |
| GET  | `/api/hotlist` | 知乎热榜 Top 10（含 live/cache/demo 状态） |
| GET | `/api/zhihu/quota` | 当前讨论后问题推荐与回答摘要所需的知乎额度（未配置时明确不可用） |
| GET/POST | `/api/auth/zhihu/*` | OAuth 绑定状态与仅由用户主动发起的创作、关注、收藏读取；收藏内容必须点选收藏夹 |
| POST | `/api/recommendations/questions/profile` | 已绑定知乎 OAuth 的用户按本人公开画像获取待回答问题 |
| POST | `/api/report` | 生成研究报告（并行搜索 + 知识图谱） |
| POST | `/api/interrogate` | 诘问（策略引擎 + LLM fallback） |
| GET/POST | `/api/session` | 会话加载/保存 |
| POST | `/api/share` | 保存成果 Markdown 并生成公开分享链接 |
| GET | `/api/share?id={shareId}` | 读取公开分享内容（无需登录） |
| POST | `/api/recommendations` | 基于报告引用生成相关推荐；站内搜索按顺序执行，避免短时限流 |

## Provider 边界

`src/lib/providers.ts` 定义共享接口与状态契约：`Session`、`Message`、`Report`、`ReportSynthesis`、`ReportViewpoint`、`Source`、`InterrogationState` 等；`src/lib/` 下各模块按职责实现 retrieval / report / session / feedback / storage / knowledge graph 等能力。

## 已知限制

- **真实 Provider 凭据**：`.env.local` 缺失时 Zhihu/LLM/Neon 仍诚实降级到 fixture；真实接入验收尚未在已部署环境中证实
- **演示数据**：3 个预置主题（AI 创造力、远程工作、35 岁程序员）保留确定性 fixture 用于演示和 CI
- **持久化**：`localStorage` 仍可用（无 DB）；`#21` 已实现 Neon adapter，凭据缺失时明确降级并不伪称远端保存
- **温和思辨覆盖**：当前已实现意图分流与 3 轮定向关口；完整 8 策略 + 19 陷阱检测未实现
- **报告 source state 跨浏览器恢复**：历史内部 ticket #24 已合并 — `Session.reportSourceState` 是权威来源，跨浏览器刷新后 badge 由持久化 Session 恢复（不再依赖 side-key）；知识图谱同源披露 provenance；无 DB 时 UI 显式标注"本地存储：未同步到远端"
- **LLM 真实接入验收**：尚待主控在受控环境亲自执行；fake/integration 测试已覆盖全部降级分支
- **LLM 输出质量**：模型综合观点必须有可追溯证据，且不能只是复述原问题；不合格结果会被拒绝并显示材料而非伪造观点

## 项目结构

```
src/
├── app/
│   ├── api/          # 13+ 个 API 路由模块（health/hotlist/interrogate/profile/report/session/share/...）
│   ├── components/   # HomePage, ReportPanel, QAPanel, ResultCardView, KnowledgeGraphView, SessionFeedbackCue...
│   ├── page.tsx      # 主页面状态机 (home/session)
│   └── layout.tsx
├── lib/              # retrieval / report / session / feedback / storage / knowledge graph 等实现
tests/
├── unit/             # 单元/集成测试
├── integration/      # retrieval-api / report-api / session-api / storage-degradation ...
├── e2e/              # hotlist / gentle / history / golden path
└── e2e-llm/          # llm-failure-golden-path.spec.ts
docs/
├── prd/              # 产品设计文档
├── implementation-v4.2.md # v4.2 实现映射与偏差
├── agents/           # Agent 操作规范
└── zhihu-api/        # 知乎开放平台 API 参考
```

## 文档导航

- [产品设计 v5.0](./docs/prd/2026-09-13-zhiyan-design-v5.0.md) — 当前产品设计基线与实现边界
- [v4.2 实现说明](./docs/implementation-v4.2.md) — PRD 逐项实现映射与已知偏差
- [M1 交付 Backlog](docs/prd/2026-09-01-zhiyan-m1-delivery-backlog.md) — 历史交付映射与依赖
- [架构说明](docs/architecture.md) — Provider 合约、数据流、状态机
- [刘看山反馈资源策略](docs/assets/feedback-cue-assets.md) — `SessionFeedbackCue` 资源来源、加载与降级（#50）
- [Agent 规范](AGENTS.md) — 项目内 AI 协作规则
