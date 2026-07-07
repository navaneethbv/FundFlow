# FundFlow Todos Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the feature roadmap from `todos.md` in one PR with milestone commits and a working app at every checkpoint.

**Architecture:** Keep personal finance calculations in small `lib/` modules with deterministic unit tests. Use Supabase-backed tables for user-owned persistent data, explicit grants plus RLS for browser-accessed tables, server-rendered pages for dashboard/review/observability surfaces, and focused client components only for forms and local interactions.

**Tech Stack:** Next.js 16 App Router, React 19, Supabase Auth/Postgres/RLS, Plaid data already stored in Postgres, Vitest, Tailwind 4, server-rendered SVG and existing UI primitives.

## Global Constraints

- One GitHub PR.
- Use milestone commits inside the PR.
- No new runtime dependencies unless absolutely required.
- New public Supabase tables must include explicit grants for `authenticated` and owner-scoped RLS.
- Never expose Plaid tokens, Supabase secret keys, raw bank payloads, or PII-heavy logs to the browser.
- Use deterministic non-LLM implementations unless the user opts in to AI.
- Verify with `npm run lint`, `npm test`, `npm run build`, and `npm audit --audit-level=high || true`.
- Do not use em dash characters in user-facing docs or code comments.

---

## File Map

- `supabase/migrations/0005_roadmap_features.sql`: persistent tables for merchant rules, manual accounts, net-worth snapshots, notifications, alert preferences, AI settings and insights, import review batches, household membership, and manual recurring items.
- `lib/goals.ts`: complete goal pace and summary helpers.
- `components/goals/GoalsManager.tsx`: edit, optimistic recovery, completion states.
- `lib/budget-insights.ts`: budget envelope math and pacing.
- `lib/cash-flow-forecast.ts`: 7, 14, and 30 day cash projection.
- `lib/recurring-calendar.ts`: upcoming recurring item calendar.
- `lib/merchant-rules.ts`: rule matching, display name cleanup, category override preview.
- `lib/anomalies.ts`: deterministic large transaction, category spike, and duplicate charge detection.
- `lib/net-worth.ts`: manual account and snapshot calculations.
- `lib/monthly-review.ts`: monthly review aggregate model.
- `lib/notifications.ts`: local notification generation.
- `lib/ai-insights.ts`: privacy-safe insight adapter with deterministic fallback.
- `lib/import-review.ts`: CSV import preview and approval helpers.
- `lib/households.ts`: household role helpers.
- `lib/observability.ts`: admin summaries for sync jobs, reports, audit events, and bank health.
- `app/dashboard/page.tsx`: wire insight cards into the dashboard.
- `app/review/page.tsx`: monthly review page.
- `app/observability/page.tsx`: admin-only observability dashboard.
- `components/dashboard/*`: new cards for budgets, forecast, recurring calendar, anomalies, notifications, net worth, and monthly review CTA.
- `components/settings/*`: alert, AI, merchant rule, manual account, and household controls where appropriate.
- `docs/browser-smoke.md`: browser E2E checklist for Plaid Sandbox and local UI smokes.
- `todos.md`: update checklist as items are completed.
- `tests/unit/*.test.ts`: deterministic math and UI source tests.
- `tests/integration/*.test.ts`: Supabase RLS and CRUD tests for new browser-written tables.

---

## Task 1: P0 Goals Production Pass

**Files:**
- Modify: `lib/goals.ts`
- Modify: `components/goals/GoalsManager.tsx`
- Modify: `components/dashboard/GoalsSummary.tsx`
- Modify: `tests/unit/goals-ui.test.ts`
- Create: `tests/unit/goals.test.ts`

**Interfaces:**
- Produces: `goalRemainingAmount(goal)`, `goalMonthlyPace(goal, today)`, `goalStatus(goal, today)`, `goalSummary(goals, today)`.
- Consumes: existing `Goal`, `goalProgressPct`, `formatCurrency`.

- [ ] Add failing tests for remaining amount, pace, completed status, overdue status, and sorted summary.
- [ ] Run `npm test -- tests/unit/goals.test.ts tests/unit/goals-ui.test.ts` and confirm failures.
- [ ] Implement goal helper functions in `lib/goals.ts`.
- [ ] Update `GoalsManager` with edit controls, rollback on failed create/update/delete/contribution, completed state, and clearer errors.
- [ ] Update dashboard goals summary with amount remaining, next target date, and monthly pace.
- [ ] Run focused tests and commit: `feat: complete goals management`.

## Task 2: Roadmap Schema

**Files:**
- Create: `supabase/migrations/0005_roadmap_features.sql`
- Create: `tests/integration/roadmap-rls.test.ts`

**Interfaces:**
- Produces tables: `merchant_rules`, `manual_accounts`, `net_worth_snapshots`, `notifications`, `alert_preferences`, `ai_settings`, `ai_insights`, `import_review_batches`, `import_review_rows`, `households`, `household_members`, `manual_recurring_items`.

- [ ] Write integration tests that assert each new user-owned table is owner-isolated.
- [ ] Run the integration test and confirm it skips or fails for missing tables.
- [ ] Create the migration with explicit `grant select, insert, update, delete on public.<table> to authenticated;`.
- [ ] Add RLS policies with `to authenticated`, `using ((select auth.uid()) = user_id)` or household membership checks.
- [ ] Add indexes for `user_id`, date fields, and household membership lookup.
- [ ] Run focused integration tests and commit: `feat: add roadmap feature schema`.

## Task 3: Planning Insight Engines

**Files:**
- Create: `lib/budget-insights.ts`
- Create: `lib/cash-flow-forecast.ts`
- Create: `lib/recurring-calendar.ts`
- Create: `lib/merchant-rules.ts`
- Create: `lib/anomalies.ts`
- Create: `tests/unit/budget-insights.test.ts`
- Create: `tests/unit/cash-flow-forecast.test.ts`
- Create: `tests/unit/recurring-calendar.test.ts`
- Create: `tests/unit/merchant-rules.test.ts`
- Create: `tests/unit/anomalies.test.ts`

**Interfaces:**
- Produces pure functions for budget pacing, cash projections, upcoming recurring groups, merchant rule preview, and anomaly detection.

- [ ] Write failing tests for budget remaining and projected overspend.
- [ ] Implement `buildBudgetEnvelopes`.
- [ ] Write failing tests for 7, 14, 30 day forecast with income cadence and recurring expenses.
- [ ] Implement `forecastCashFlow`.
- [ ] Write failing tests for recurring calendar grouping and status.
- [ ] Implement `buildRecurringCalendar`.
- [ ] Write failing tests for merchant rule matching and preview idempotency.
- [ ] Implement `applyMerchantRules` and `previewMerchantRules`.
- [ ] Write failing tests for large, spike, and duplicate anomaly detection.
- [ ] Implement `detectSpendingAnomalies`.
- [ ] Run focused tests and commit: `feat: add planning insight engines`.

## Task 4: Dashboard Planning Surfaces

**Files:**
- Modify: `app/dashboard/page.tsx`
- Create: `components/dashboard/BudgetEnvelopeCard.tsx`
- Create: `components/dashboard/CashFlowForecastCard.tsx`
- Create: `components/dashboard/RecurringCalendarCard.tsx`
- Create: `components/dashboard/AnomalyCard.tsx`
- Create: `components/dashboard/NotificationCard.tsx`
- Modify: `tests/unit/dashboard-ui.test.ts`

**Interfaces:**
- Consumes insight engines from Task 3 and existing dashboard data.

- [ ] Add source tests that assert dashboard imports and renders the new cards.
- [ ] Run tests and confirm failure.
- [ ] Add card components using existing `Panel`, `Badge`, and chart primitives.
- [ ] Wire data in `app/dashboard/page.tsx` without adding Plaid calls.
- [ ] Run focused tests and commit: `feat: surface planning insights on dashboard`.

## Task 5: Account And Reporting Features

**Files:**
- Create: `lib/net-worth.ts`
- Create: `lib/monthly-review.ts`
- Create: `lib/notifications.ts`
- Create: `app/review/page.tsx`
- Create: `components/review/MonthlyReview.tsx`
- Create: `tests/unit/net-worth.test.ts`
- Create: `tests/unit/monthly-review.test.ts`
- Create: `tests/unit/notifications.test.ts`
- Create: `tests/unit/review-ui.test.ts`

**Interfaces:**
- Produces `calculateNetWorth`, `buildMonthlyReview`, and `buildNotifications`.

- [ ] Write failing tests for net worth assets, liabilities, and snapshots.
- [ ] Implement `calculateNetWorth`.
- [ ] Write failing tests for monthly review summary sections.
- [ ] Implement `buildMonthlyReview`.
- [ ] Write failing tests for notification generation.
- [ ] Implement `buildNotifications`.
- [ ] Add `/review?month=YYYY-MM` page using existing shell.
- [ ] Run focused tests and commit: `feat: add net worth monthly review notifications`.

## Task 6: Settings Workflows

**Files:**
- Create: `components/settings/MerchantRulesSection.tsx`
- Create: `components/settings/ManualAccountsSection.tsx`
- Create: `components/settings/AlertPreferencesSection.tsx`
- Create: `components/settings/AiInsightsSection.tsx`
- Create: `components/settings/HouseholdSection.tsx`
- Modify: `app/settings/page.tsx`
- Modify: `tests/unit/settings-ui.test.ts`

**Interfaces:**
- Consumes Task 2 tables through Supabase browser client under RLS.

- [ ] Add source tests for the new Settings sections and anchors.
- [ ] Implement the sections with empty, error, saved, and disabled states.
- [ ] Wire sections into Settings with anchors.
- [ ] Run focused tests and commit: `feat: add settings workflows`.

## Task 7: Advanced Workflows

**Files:**
- Create: `lib/ai-insights.ts`
- Create: `lib/import-review.ts`
- Create: `lib/households.ts`
- Create: `app/api/ai/insights/route.ts`
- Create: `app/api/import/preview/route.ts`
- Create: `app/api/import/commit/route.ts`
- Create: `tests/unit/ai-insights.test.ts`
- Create: `tests/unit/import-review.test.ts`
- Create: `tests/unit/households.test.ts`
- Create: `tests/integration/import-review.test.ts`

**Interfaces:**
- Produces privacy-safe AI summaries, import review batches, and household role helpers.

- [ ] Write failing tests for AI payload redaction and opt-in gating.
- [ ] Implement deterministic AI fallback summaries and provider-neutral types.
- [ ] Write failing tests for import preview row states and idempotent commit payloads.
- [ ] Implement import preview helpers and route handlers.
- [ ] Write failing tests for household role permissions.
- [ ] Implement role helpers and route-safe checks.
- [ ] Run focused tests and commit: `feat: add advanced roadmap workflows`.

## Task 8: Observability And Smoke Docs

**Files:**
- Create: `lib/observability.ts`
- Create: `app/observability/page.tsx`
- Create: `components/observability/ObservabilityDashboard.tsx`
- Create: `docs/browser-smoke.md`
- Modify: `todos.md`
- Create: `tests/unit/observability.test.ts`
- Create: `tests/unit/browser-smoke-doc.test.ts`

**Interfaces:**
- Produces admin-only observability summaries and manual browser smoke checklist.

- [ ] Write failing tests for redacted observability summaries.
- [ ] Implement observability helpers.
- [ ] Add admin-only page with `requireAdmin` pattern.
- [ ] Add browser smoke checklist for Plaid Sandbox, mobile QA, theme, settings, transactions, and goals.
- [ ] Update `todos.md` checklist items completed by the PR.
- [ ] Run focused tests and commit: `feat: add observability and smoke docs`.

## Task 9: Final Verification And PR

**Files:**
- All touched files.

- [ ] Run `npx -p npm@10.9.8 npm ci`.
- [ ] Run `npm run lint`.
- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Run `npm audit --audit-level=high || true`.
- [ ] Push branch.
- [ ] Open one PR.
- [ ] Watch GitHub checks until pass or collect failure logs.

## Self Review

- Spec coverage: all `todos.md` sections have an implementation task or smoke documentation task.
- Placeholder scan: no placeholder markers; any browser-only Plaid action is represented as `docs/browser-smoke.md` because real credentials are outside the codebase.
- Type consistency: helper names in later tasks match the produced interfaces above.
