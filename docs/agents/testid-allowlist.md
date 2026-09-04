# Testid allowlist (#26 / R3)

This file records the `data-testid` attributes that production components
expose to Playwright / E2E. New testids must be added here so the E2E
team has a single source of truth and the testid set is reviewed on each
release.

## Home (`src/app/page.tsx`)

- `storage-notice` — server storage disclosure (#21)

## HomePage (`src/app/components/HomePage.tsx`)

- `hotlist-source-state` — "实时热榜" / "缓存" / "缓存已过期" / "演示数据" (#26/R1, PRD v4.2 §2.3)

## StanceSelector (`src/app/components/StanceSelector.tsx`)

- `stance-selector` — root container
- `stance-option` — each AI-suggested stance button (#26/R3, used by `gentle-interrogation-golden-path.spec.ts` and `golden-path.spec.ts`)

## ReportPanel (`src/app/components/ReportPanel.tsx`)

- `report-source-state` — honest report provenance badge
- `report-synthesis` — structured multiple-viewpoint block (#26/R2, PRD v4.2 §3.3)
- `report-viewpoints-heading` — `核心观点` heading
- `report-viewpoints` — ordered list of viewpoints
- `report-viewpoint` — one viewpoint
- `report-viewpoint-conclusion` — conclusion text (must not equal source title)
- `report-viewpoint-evidence` — evidence list
- `report-synthesis-heading` — `综合结论` heading
- `report-synthesis-summary` — summary text
- `report-synthesis-legacy` — fallback notice when old report has no `synthesis` field

## QAPanel (`src/app/components/QAPanel.tsx`)

- `qa-panel` — root container (#26/R3, replaces the older qa-panel testid that was missing)
- `qa-sources` — `#16` evidence sources list
- `summary-gate` — three-round summary gate container (#26/R3, PRD v4.2 §5.3)
- `summary-gate-continue` — `继续聊` button (never 409)
- `summary-gate-complete` — `生成总结` button
- `decision-gate` — uncertainty decision gate (保留, #17)
- `complete-error` — explicit error after a failed `complete` action

## SessionFeedbackCue (`src/app/components/SessionFeedbackCue.tsx`)

- `session-feedback-cue` — root container
- `session-feedback-cue-image` — Liu Shanshan GIF
- `session-feedback-cue-text-art` — text-art fallback
- `session-feedback-cue-label` — state label
- `session-feedback-cue-description` — state description

## Rules

1. Testids are part of the public surface — renaming or removing any testid listed here is a breaking change for E2E and must update every E2E spec that uses it.
2. Production components must add a testid whenever the corresponding E2E scenario needs a stable selector (no `getByText` for a string that may be translated or rephrased).
3. i18n changes: any `getByText(/中文/)` selector in an E2E is fragile; the fix is to migrate to a `getByTestId` listed here.
