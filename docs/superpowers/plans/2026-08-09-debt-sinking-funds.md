# Debt and Sinking Funds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a shareable debt payoff planner and recurring sinking funds without introducing duplicate financial sources of truth.

**Architecture:** The debt page is a server-rendered projection over existing account data and pure payoff math.
Recurring funds extend the existing `sinking_funds` table, calculate due cycles without database mutation, and move all writes behind owner-scoped server routes.

**Tech Stack:** Next.js 16.2 App Router, React 19, TypeScript 6, Supabase Postgres, Vitest 4, and Playwright 1.61.

## Global Constraints

The work remains on `fix/shipped-defects` and PR #99.
Debt results are projections, not predictions.
Every unknown APR is individually disclosed as the 22 percent planning assumption.
Every service-client mutation includes an explicit `user_id` predicate.
Create migrations with `npx supabase migration new <slug>` and apply them live before code reads new columns.

---

### Task 1: Build the debt planner data boundary

**Files:**

- Create: `lib/debt-data.ts`
- Create: `tests/unit/debt-data.test.ts`
- Modify: `lib/debt.ts`

**Interfaces:** Produces `parseDebtStrategy`, `parseExtraMonthly`, and `loadDebtPlannerData` with normalized debts plus avalanche and snowball projections.

- [ ] Write failing tests for owner and household scopes, liability filtering, sign normalization, known APRs, unknown APR assumptions, invalid URL values, empty debt sets, and non-converging plans.
- [ ] Run `npm run test:unit -- tests/unit/debt-data.test.ts` and confirm failure.
- [ ] Implement strict URL parsing that normalizes invalid strategy to avalanche and invalid or negative extra payment to zero.
- [ ] Load account liabilities through the existing financial-scope helpers and preserve account ids for APR-setting links.
- [ ] Build both strategies with the existing maximum of 25 dollars or two percent minimum-payment rule.
- [ ] Return explicit empty and non-converging states instead of invented zero totals.
- [ ] Run debt unit tests and commit with `feat(debt): add payoff planner data`.

### Task 2: Add the debt planning page

**Files:**

- Create: `app/debt/page.tsx`
- Create: `components/debt/DebtPlanTable.tsx`
- Create: `tests/unit/debt-page-render.test.ts`
- Create: `tests/e2e/debt.spec.ts`
- Modify: `lib/nav-model.ts`
- Modify: `components/MobileNavigation.tsx`
- Modify: navigation unit tests selected by the changed modules

**Interfaces:** Produces `/debt?strategy=avalanche|snowball&extra=<decimal>` under Planning navigation.

- [ ] Write failing render tests for projection wording, both strategies, comparison totals, payoff order, assumed APR disclosure, empty state, non-converging state, and APR-setting links.
- [ ] Add Debt to the shared navigation model and map its mobile icon without duplicating destination definitions.
- [ ] Implement the page as a Server Component with normal GET navigation for strategy and extra payment.
- [ ] Render total balance, monthly budget, debt-free month count, projected interest, comparison, payoff month, and per-debt projected interest.
- [ ] Keep the strategy and extra payment in the URL so reload, sharing, and browser history preserve the scenario.
- [ ] Add E2E coverage for both strategies, changed extra payment, back and forward navigation, mobile layout, and the APR-settings link.
- [ ] Run focused unit and E2E tests twice and commit with `feat(debt): add payoff planning page`.

### Task 3: Secure and extend recurring sinking funds

**Files:**

- Create with Supabase CLI: migration slug `recurring_sinking_funds`
- Modify: `tests/unit/roadmap-schema-completion.test.ts`
- Modify: `tests/integration/roadmap-rls.test.ts`

**Interfaces:** Adds `cadence`, `custom_interval_months`, and `cycle_anchor_date`, preserves owner reads, and requires server-side mutations.

- [ ] Write failing schema assertions for all three columns, cadence and interval constraints, defaults, revoked authenticated mutations, and owner-only select policy.
- [ ] Run the focused schema test and confirm failure.
- [ ] Generate the migration with the Supabase CLI and add the exact constraints and backfill behavior from the approved design.
- [ ] Default existing rows to one-time and initialize the cycle anchor from the existing due date.
- [ ] Revoke authenticated insert, update, and delete without weakening owner-only reads.
- [ ] Extend the live RLS suite so user B cannot read or mutate user A's sinking funds.
- [ ] Apply the migration through the linked direct-query workflow and verify columns, constraints, grants, and policies.
- [ ] Run focused tests and commit with `feat(sinking): add recurring fund schema`.

### Task 4: Implement cadence-aware projections

**Files:**

- Modify: `lib/insights.ts`
- Modify: `lib/budget-data.ts`
- Modify: `lib/dashboard.ts`
- Modify: `tests/unit/insights.test.ts`
- Modify: Budget and Dashboard data tests selected by the changed modules

**Interfaces:** Produces `resolveNextSinkingFundDue` and extends `computeSinkingFunds` with cadence-aware due cycles.

- [ ] Write failing tests for one-time, annual, semiannual, quarterly, and custom cadence.
- [ ] Cover end-of-month clamping, leap years, multiple elapsed cycles, a due date equal to the planning date, one-time past-due behavior, and custom intervals from 1 through 120 months.
- [ ] Run the focused unit tests and confirm failure.
- [ ] Implement pure month advancement from `cycle_anchor_date` with no read-time or cron mutation.
- [ ] Calculate required monthly set-aside over whole months remaining, clamped to one month at the due date.
- [ ] Thread the next due date and required contribution through Budget, Dashboard, and Safe-to-Spend projections.
- [ ] Run affected unit tests and commit with `feat(sinking): project recurring fund cycles`.

### Task 5: Move sinking-fund writes to routes and update the UI

**Files:**

- Create: `app/api/sinking-funds/route.ts`
- Create: `app/api/sinking-funds/[id]/route.ts`
- Create: `tests/unit/sinking-funds-route.test.ts`
- Create: `tests/e2e/sinking-funds.spec.ts`
- Modify: `components/settings/SinkingFundsSection.tsx`
- Modify: `app/settings/page.tsx`
- Modify: the Budget sinking-fund component selected during implementation
- Modify: `lib/audit.ts`

**Interfaces:** Produces owner-scoped create, update, and delete routes and cadence-aware Settings and Budget experiences.

- [ ] Write failing route tests for authentication, field validation, cadence rules, owner scoping, missing rows, create, update, delete, and audit metadata.
- [ ] Implement `POST /api/sinking-funds` and `PATCH` and `DELETE /api/sinking-funds/[id]` with awaited route params and explicit `user_id` predicates.
- [ ] Replace direct browser writes with route calls and update local state only after successful responses.
- [ ] Add cadence and conditional custom-interval controls while preserving accessible labels and error recovery.
- [ ] Show next due date and required monthly contribution on Settings and Budget surfaces.
- [ ] Add E2E coverage that creates a recurring fund, verifies its Budget contribution, edits cadence, reloads, and deletes it.
- [ ] Run focused route, render, and E2E tests twice and commit with `feat(sinking): add recurring fund management`.

### Task 6: Verify and document debt and sinking funds

**Files:**

- Modify: `docs/HANDOFF.md`
- Modify: `docs/TODO.md`

- [ ] Run `npx tsc --noEmit`, `npm run lint`, affected unit suites, complete Vitest, production build, and `git diff --check`.
- [ ] Run Debt, Sinking Funds, Budget, Dashboard, and Settings E2E journeys twice without retries.
- [ ] Record the migration id, live verification evidence, exact test totals, and browser results.
- [ ] Commit with `docs: record debt and sinking completion`.
