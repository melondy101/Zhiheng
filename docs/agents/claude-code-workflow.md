# Claude Code agent workflow

This document is the operational reference for the project-level Claude Code agents. Root `AGENTS.md` contains the rules that must be loaded every session; this document provides the reusable prompts and examples.

## Select the smallest suitable role

| Situation | Role | Required input | Output |
| --- | --- | --- | --- |
| A localized, approved change | `scoped-implementer` | scope, acceptance criteria, prohibited changes | changed files and executed checks |
| Evidence for a completed change | `test-evidence` | current diff and acceptance criteria | PASS, FAIL, or INCONCLUSIVE with reproduction |
| Independent review of a non-trivial diff | `adversarial-reviewer` | current diff and requirement | actionable findings or approval |
| Retrospective after verified work | `learning-curator` | run records and validation feedback | a candidate experience card, or no card |

Do not use a subagent to decide architecture, resolve an ambiguous requirement, authorize a release, merge branches, handle credentials, or make an external product claim. The main session owns those decisions.

## Standard handoff prompts

### Implementation

```text
Use scoped-implementer for this bounded task.
Goal: <observable behavior>
Scope: <files/modules that may change>
Acceptance criteria:
- <criterion>
Do not: <explicit exclusions>
Return the implementation-contract evidence report.
```

### Independent verification

```text
Use test-evidence to independently verify the current diff.
Acceptance criteria:
- <criterion>
Run the smallest meaningful checks first. Do not edit production code.
Return the verification-contract report and mark missing evidence INCONCLUSIVE.
```

### Diff review

```text
Use adversarial-reviewer to review the current diff independently.
Check the acceptance criteria and architecture invariants. Do not implement fixes.
Return only actionable findings with file/line evidence and a final verdict.
```

### Experience curation

```text
Use learning-curator to retrospect on these verified run records and Codex findings.
Create a candidate experience card only if a pattern is repeated or a single event is high impact.
Do not modify active instructions, agent definitions, skills, production code, or deployment settings.
```

## Learning lifecycle

1. Keep concrete test output and Codex feedback in the ticket handoff.
2. Curate only evidence-backed candidates in `agent-system/experience-candidates/`.
3. Evaluate one candidate change at a time with representative cases under `agent-system/evals/cases/`; keep some cases out of the curating context.
4. A human approves promotion to `experience-approved/`, then makes the narrow active-instruction change in a separately reviewable diff.
5. Revert a promoted rule if its quality or safety guard regresses.

Never automate promotion for permissions, secrets, authentication, destructive actions, deployment, data migrations, or external communication.
