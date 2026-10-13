# Budget, Goal, and Debt Planning Implementation Plan

**Goal:** Deliver 15 further non-AI features through existing Budget, Goals, and Debt pages.

**Architecture:** Three independent feature groups use pure arithmetic modules and small client components, integrated into existing server-loaded pages. Current financial records remain unchanged by scenarios. The PR is stacked on the transaction/reporting branch.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind, Supabase, Vitest, Playwright.

**Spec:** `../specs/2026-10-13-budget-goal-debt-planning.md`.

## Global constraints

- No AI functionality, migrations, production mutations, new providers, or persisted scenario data.
- Keep currency scopes, owner/RLS constraints, privacy mode, existing flags, and viewer calendar dates.
- Bounds: 600 goal contribution dates; skipped contributions 0–120; 600 debt months; cent-precise money.
- Original records and full-budget totals do not change with exploration or scenario controls.

## Review focus

- Invalid numeric/date inputs cannot produce NaN, infinite loops, or false zero totals.
- Empty/complete goals and zero-rate/overpaid debts have meaningful results.
- Leap-day/month-end cadence anchors and viewer today remain stable across time zones.
- Stale form state resets when account/goal/currency or server-loaded data changes.
- Mixed/unknown currency, incomplete data, and privacy mode never silently misrepresent money.

## Task 1: Budget exploration, features 1–5

Files: `lib/budget-explorer.ts`, `components/budget/BudgetExplorer.tsx`, `components/budget/BudgetPlanner.tsx`, `app/budget/page.tsx`; focused unit and browser tests.

- [x] Observe failing tests for search/filter/sort semantics, immutable totals, date/completeness pace gates, and conservative transfer previews.
- [x] Implement pure helpers consuming `BudgetPageData`/`BudgetLine` and explicit today, completeness, currency context.
- [x] Integrate controls with the monthly table without changing edits or annual/decade behavior; pass viewer today and completeness from the page.
- [x] Verify focused unit tests, browser input/reset/overflow/axe/privacy checks, and lint.

## Task 2: Goal scenarios, features 6–10

Files: `lib/goal-scenarios.ts`, `components/goals/GoalScenarioPlanner.tsx`, `app/goals/page.tsx`; focused unit and browser tests.

Interface: client receives normalized `{id,name,targetAmount,fundedAmount,targetDate}` save-up goals and explicit `today`, using existing USD goal semantics with visible currency label.

- [x] Observe failing tests for contribution cadences, lump sums, pauses, milestones, deadline requirements, invalid values, caps, and goal switching.
- [x] Implement pure calendar/cents calculations and a resettable scenario component.
- [x] Normalize legacy/v2 savings goals at the page without altering existing cards, writes, or pay-down projections.
- [x] Verify focused unit tests, browser input/reset/overflow/axe/privacy checks, and lint.

## Task 3: Debt scenarios, features 11–15

Files: `lib/debt-scenarios.ts`, `lib/debt.ts` as needed, `lib/debt-data.ts`, `components/debt/DebtScenarioPlanner.tsx`, `components/debt/DebtPlannerView.tsx`, `app/debt/page.tsx`; focused unit and browser tests.

- [x] Observe failing tests for amortization reconciliation, lump-sum allocation, edited assumptions, target-payment solver, payment ladder, currency isolation, and invalid inputs.
- [x] Reuse/extend deterministic simulation while preserving existing payoff-engine behavior and account identities.
- [x] Integrate currency-separated planning and bounded scenario controls with existing scope and date context.
- [x] Verify focused unit/browser tests and old debt tests; do not change production account assumptions.

## Task 4: Independent review and delivery

- [x] Review each group and fix reproduced defects before freezing implementation.
- [x] Run one final full coverage suite, future-clock suite, all browser checks, lint/typecheck/build/palette/audit; document unavailable live integration/graph tooling.
- [x] Update canonical docs with completed features, actual evidence, and limitations.
- [x] Publish a stacked PR against `feat/transaction-reporting-essentials` with the exact 15-feature checklist; no merge/deployment.
