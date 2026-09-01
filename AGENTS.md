## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues for `huang-yi-dae/zhiyan`. See `docs/agents/issue-tracker.md`.

### Triage labels

Uses the default five-label triage vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout. See `docs/agents/domain.md`.

## 主控流程（持续交付批次 #19–#26 的硬约束）

- 主控是唯一可合并到 `integration` 分支的角色；Builder / Reviewer / Finalizer 不得 push、PR、合并、关 issue
- 一个 ticket = 一个独立 worktree；worktree 必须从当前 `integration` HEAD 拉新分支；不得复用或删除历史 worktree
- Builder 最多 2 次实现尝试；Finalizer 最多 1 次修复尝试；超出必须升级主控到人工决策
- Reviewer 必须独立跑门禁（typecheck/lint/test/build）并独立读 diff；不接受 Builder/Finalizer 自述为证据
- 凭据处理：`.env.local` 是唯一外部凭据源；worktree 不复制凭据；测试时设 `DOTENV_CONFIG_PATH` 指向主仓 `.env.local`
- 真实服务未配置（任一 `ZHIHU_ACCESS_SECRET` / `LLM_API_KEY` / `DATABASE_URL` 缺失）时，合并结论只能写"代码与 fake/integration 测试通过、真实接入待受控环境验收"，不得声称真实接入完成
- 完成票的 handoff 必须写到 `.scratch/agent-runs/ticket-NN/HANDOFF.md`；控制证据写到 `.scratch/agent-runs/control/HANDOFF.md`
- 凭据绝不在 commit、handoff、控制台输出任何位置以明文出现；只报告布尔（CONFIGURED / EMPTY_OR_MISSING）

## 当前阶段状态（截至 2026-09-01）

- 已有实现证据：`#19 #20 #21 #22`（历史内部编号）、GitHub #23（移除历史材料并再生成，integration `81771a1`）与 GitHub #30（服务端/浏览器存储边界修复，已关闭）。
- M1 总控为 **GitHub #26**；在真实 Zhihu、LLM、Neon 与 Vercel 验收有明确通过或受控阻塞结论，且现有质量门禁全绿前，不得开始或合并 M1 生产代码。
- 刘看山反馈属于 P2，已拆为 **GitHub #47/#48**，不阻塞 M1。
- 上次同步：2026-09-01（M1 设计、依赖与 GitHub 映射已对齐）
- 详细控制证据：`.scratch/agent-runs/control/HANDOFF.md`

## 质量门禁（不可绕过）

- `npm run typecheck` / `npm run lint` / `npm test` / `npm run build` / `npm run test:e2e` 必须全绿才能合并
- 主控在 integration worktree 上独立复验五步门禁；不允许复用 Builder / Finalizer / Reviewer 的"通过"结论

## Claude Code 专用子 agent

项目级定义位于 `.claude/agents/`，工作流细节位于 `.claude/skills/`。主控负责选择、编排和最终结论；子 agent 不替代上面的分支、凭据、门禁或 handoff 约束。

- `scoped-implementer`：仅用于目标、允许范围和验收标准都明确的局部实现。它承担 Builder 的实现工作，但不能 push、PR、合并或自行扩大需求。
- `test-evidence`：实现后独立检查改动和验收条件，运行最小相关验证；它不修改生产代码，不能以实现者自述替代实际输出。
- `adversarial-reviewer`：对非平凡 diff 做只读、独立审查，重点检查 provider 合约、来源标识与降级、session 持久化、状态机、错误路径及测试缺口。它是现有 Reviewer 门禁的补充，不降低任何强制检查。
- `learning-curator`：仅在任务已有验证证据或 Codex 反馈时用于复盘。它只能在 `agent-system/experience-candidates/` 创建候选经验卡，绝不自动修改 `AGENTS.md`、`.claude/agents/`、`.claude/skills/`、业务代码、权限或部署设置。

### 默认调用顺序

对边界清晰的 ticket：主控先明确验收条件 → `scoped-implementer` 实现 → `test-evidence` 给出独立证据 → 对跨层或高风险改动调用 `adversarial-reviewer` → 主控按质量门禁和必要的 Codex 验证作结论。架构、认证、迁移、外部服务接入、需求不清的任务不得下放给 `scoped-implementer`，而应由主控先澄清或升级。

### 调用方式

主控可在自然语言中明确指定：`使用 scoped-implementer 完成 <范围>；验收条件是 <条件>；禁止 <边界>`。完成后再指定：`使用 test-evidence 独立验证当前 diff 和这些验收条件`，以及需要时：`使用 adversarial-reviewer 审查当前 diff`。

任务结束时，主控应把可复现的验证结果与 Codex 反馈写入 `.scratch/agent-runs/.../HANDOFF.md`。仅在出现重复失败模式或单次高影响事件时，再调用 `learning-curator`；候选经验的评测、批准与晋升方法见 `agent-system/README.md`。
