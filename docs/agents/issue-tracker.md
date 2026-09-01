# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`
- **Read an issue**: `gh issue view <number> --comments`
- **List issues**: `gh issue list --state open`
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Repository: `huang-yi-dae/zhiyan`.

## Source of truth

GitHub Issues are the sole authority for a ticket's number, title, scope, dependency, and lifecycle state. Before planning or reporting ticket work, read the current issue with `gh issue view <number> --comments` (and use `gh issue list` to establish the open-ticket set).

`README.md`, handoff files, commit messages, and agent-run records are historical implementation evidence only. They must not be used to infer a current ticket number or status when they conflict with GitHub Issues.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.
