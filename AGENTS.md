## 项目协作规则

- 当前仓库以当前分支与工作区为准；不依赖历史 GitHub Issue、旧 `integration` 分支或历史 worktree 状态。
- `.env.local` 是唯一的外部凭据来源。不得提交、复制或在日志、文档、handoff 中输出明文凭据；只报告 `CONFIGURED` 或 `EMPTY_OR_MISSING`。
- 修改实现后至少运行与改动相关的 typecheck 和自动化测试；跨层改动再补 lint、build 或 E2E。不要把未运行的门禁说成已通过。
- 真实外部服务未在受控环境验证时，只能说明代码与 fake/integration 测试结果，不得宣称生产接入完成。
- 不用 `git reset --hard`、强制推送或覆盖用户已有改动。提交前运行 `git diff --check`，并保留无关的工作区变更。

## 文档边界

- `README.md` 面向使用者；`docs/architecture.md` 记录实现契约；带日期的 `docs/prd/` 与 `docs/superpowers/specs/` 是历史设计依据。
- 文档以当前代码为准；新增 API、环境变量、持久化结构或用户流程时，同步更新面向使用者与架构的说明。
