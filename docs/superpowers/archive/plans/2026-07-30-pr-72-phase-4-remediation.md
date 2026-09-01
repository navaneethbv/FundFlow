# PR 72 Phase 4 Budget Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn PR #72 into one reviewable, migration-first Phase 4 Budget vertical slice whose totals reconcile with the canonical Phase 0 projection and Cash Flow.

**Architecture:** Remove the Phase 5 through Phase 13 placeholder code from this branch, then complete Budget as a server-rendered feature backed by one hardened `budget_periods` migration.
Keep transaction meaning in the canonical projection loader, keep budget calculations pure and unit-tested, and keep writes behind authenticated route handlers with owner-safe RLS.

**Tech Stack:** Next.js 16.2.11 App Router, React 19, TypeScript, Tailwind 4, Supabase Postgres with RLS, Vitest, Playwright, GitHub Actions, SonarCloud, and Vercel.

## Global Constraints

- Preserve the canonical Phase 0 ordering: merchant rules, category overrides, split expansion, refund netting, transfer classification, and stable sorting.
- Pass real `transaction_splits` into every new transaction-derived page.
- Read transactions through the bounded and paginated `fetchFinanceTransactions` helper.
- Accept Mine and Household scopes through `parseFinancialScope`.
- Never combine currencies without a selected currency or a validated exchange-rate source.
- Keep the Budget navigation entry hidden until the migration is live and the page is production-ready.
- Apply the Budget migration to live Supabase project `zrxbmmtqqhlwtrinocww` before reader code is eligible to merge.
- Use `requireUser()`, `badRequest()`, `errorResponse()`, and `writeAudit()` in route handlers.
- Audit changed field names and stable record ids, but never audit budget amounts, merchants, balances, or transaction details.
- Add owner and household RLS tests, authenticated grants, takeout coverage, encrypted backup coverage, and cascade-deletion verification.
- Do not change the repository-wide coverage threshold to make this PR pass.
- Do not add mock financial data, demo-only production routes, placeholder mutations, or authenticated coming-soon pages.
- Run responsive acceptance at 1440x900, 768x1024, and 390x844 in light and dark themes.
- Use conventional commits without co-author lines.
- Do not use the em dash character in code, copy, comments, commit messages, or documentation.

## Verified Starting State

- PR head at review time: `57e7cfca852f168c60c4e1ed57c705b5b42e3eb4`.
- PR title claims Phase 4 remediation, but commit `57e7cfc` re-adds Phase 5 through Phase 13 placeholders.
- GitHub CI build fails on React client hooks in server pages and an undeclared `pdf-lib` import.
- E2E does not start because the production build fails.
- Vercel deployment fails for the same build errors.
- The coverage workflow reports 85.32 percent statement coverage after the PR raised the threshold to 95 percent.
- SonarCloud reports 49.7 percent coverage on new code against the required 80 percent.
- The live Supabase migration ledger contains Phase 0 through Phase 3 only.
- The Budget migration and every later-phase schema remain unapplied in production.

## File Map

**Keep and complete:**

- `supabase/migrations/20260729210000_budget_groups.sql`
- `lib/finance-query.ts`
- `lib/budget-page.ts`
- `app/budget/page.tsx`
- `app/api/budget/route.ts`
- `components/budget/BudgetPlanner.tsx`
- `components/budget/BudgetTable.tsx`
- `components/budget/BudgetSummary.tsx`
- `components/budget/SeedBudgetButton.tsx`
- `components/shell/AppSidebar.tsx`
- `app/api/export/takeout/route.ts`
- `app/api/cron/backup/route.ts`

**Create:**

- `lib/budget-data.ts`
- `tests/unit/budget-data.test.ts`
- `tests/integration/budget-period-rls.test.ts`
- `tests/e2e/budget.spec.ts`

**Expand:**

- `tests/unit/finance-query.test.ts`
- `tests/unit/budget-page.test.ts`
- `tests/unit/budget-route.test.ts`
- `tests/unit/export-routes.test.ts`
- `tests/unit/demo-backup-routes.test.ts`

**Remove from this PR:**

- `app/advice/`
- `app/forecasting/`
- `app/investments/`
- `app/reports/`
- `app/api/advice/`
- `app/api/forecasting/`
- `app/api/investments/`
- `app/api/recurring/`
- `app/api/reports/`
- `app/api/settings/feature-flags/`
- `app/api/settings/preferences/`
- `components/advice/`
- `components/forecasting/`
- `components/investments/`
- `components/recurring/`
- `components/reports/`
- `components/settings/FeatureFlags.tsx`
- `components/settings/Preferences.tsx`
- `components/settings/settings-nav.ts`
- `components/charts/CumulativeCompareChart.tsx`
- `lib/advice.ts`
- `lib/forecasting.ts`
- `lib/investments.ts`
- `lib/reports.ts`
- `tests/e2e/phases-5-13.spec.ts`
- `tests/unit/advice-engine.test.ts`
- `tests/unit/forecasting.test.ts`
- `tests/unit/investments.test.ts`
- `tests/unit/reports.test.ts`
- `tests/unit/settings-nav.test.ts`

---

### Task 1: Restore a Phase 4-Only Diff

**Files:**

- Revert commit: `57e7cfca852f168c60c4e1ed57c705b5b42e3eb4`
- Restore: `vitest.config.ts`
- Inspect: every path in the Remove list above

**Interfaces:**

- Consumes: the narrowed Phase 4 state at commit `a9709d216a75f4f0cf471168dec82fb591a7ddcb`.
- Produces: a buildable PR containing no Phase 5 through Phase 13 product code.

- [ ] **Step 1: Revert the multi-phase commit without rewriting shared history**

```bash
git revert 57e7cfca852f168c60c4e1ed57c705b5b42e3eb4
```

Expected: the Phase 5 through Phase 13 files disappear from the PR diff.

- [ ] **Step 2: Prove the PR no longer contains later-phase surfaces**

```bash
git diff --name-only main...HEAD | rg '^(app|components|lib|tests)/(advice|forecasting|investments|reports|recurring|settings/(FeatureFlags|Preferences))'
```

Expected: no output.

- [ ] **Step 3: Prove the global coverage threshold is unchanged from main**

```bash
git diff main...HEAD -- vitest.config.ts
```

Expected: no output.

- [ ] **Step 4: Run the first green baseline**

```bash
npm run lint
npm run typecheck
npm test
npm run build
git diff --check
```

Expected: every command passes before new remediation code is added.

- [ ] **Step 5: Commit the scope correction**

```bash
git add -A
git commit -m "revert: keep parity work scoped to phase 4"
```

---

### Task 2: Correct the Canonical Projection Loader

**Files:**

- Modify: `lib/finance-query.ts`
- Test: `tests/unit/finance-query.test.ts`

**Interfaces:**

- Consumes: `FetchFinanceOptions`, `fetchFinanceTransactions()`, and `projectFinanceTransactions()`.
- Produces:

```ts
export interface CanonicalProjectionResult {
  transactions: CanonicalFinanceTransaction[];
  currencyByAccountId: Map<string, string>;
  truncated: boolean;
}

export async function loadCanonicalProjection(
  supabase: SupabaseClient,
  options: FetchFinanceOptions,
): Promise<CanonicalProjectionResult>;
```

- [ ] **Step 1: Write failing tests for the real split schema**

Add fixtures whose `transaction_splits` rows have exactly these columns:

```ts
{
  transaction_id: "expense-1",
  category: "Groceries",
  amount: 40,
}
```

Assert that the query selects `transaction_id,category,amount`, filters with `.in("transaction_id", sourceIds)`, chunks at 500 ids, and passes mapped splits to the projection.

- [ ] **Step 2: Write failing dependency tests**

Assert account merchant rules receive `accountNames`, currency codes are normalized to uppercase, Mine queries explicitly filter `user_id`, Household queries rely on cookie-client RLS, and every dependency error becomes `finance_projection_query_failed:<table>:<code>`.

- [ ] **Step 3: Run the focused tests and confirm the current schema mismatch fails**

```bash
npm run test:unit -- tests/unit/finance-query.test.ts
```

Expected: failure because the implementation currently requests `source_transaction_id` and other nonexistent split columns.

- [ ] **Step 4: Implement the exact split adapter**

```ts
interface SplitRow {
  transaction_id: string;
  category: string;
  amount: number | string;
}

const split = {
  transactionId: row.transaction_id,
  category: row.category,
  amount: Number(row.amount),
};
```

Keep split queries bounded and keyed only to transactions already returned by the bounded transaction read.

- [ ] **Step 5: Run the focused tests**

```bash
npm run test:unit -- tests/unit/finance-query.test.ts tests/unit/finance-domain.test.ts tests/unit/dashboard-finance-parity.test.ts
```

Expected: all pass.

- [ ] **Step 6: Commit the canonical loader correction**

```bash
git add lib/finance-query.ts tests/unit/finance-query.test.ts
git commit -m "fix(finance): load canonical split dependencies"
```

---

### Task 3: Finish the Budget Migration and Operational Coverage

**Files:**

- Modify: `supabase/migrations/20260729210000_budget_groups.sql`
- Modify: `app/api/export/takeout/route.ts`
- Modify: `app/api/cron/backup/route.ts`
- Test: `tests/integration/budget-period-rls.test.ts`
- Test: `tests/unit/export-routes.test.ts`
- Test: `tests/unit/demo-backup-routes.test.ts`

**Interfaces:**

- Consumes: existing owner-only write semantics for `budgets` and household read-only sharing.
- Produces: owner-writable and household-readable `budget_periods` with loss-prevention coverage.

- [ ] **Step 1: Write the live-RLS tests first**

Cover owner select, insert, update, and delete.
Cover household-member select for a shared budget.
Prove a household member cannot insert, update, or delete the owner’s period.
Prove a cross-user caller cannot read or mutate any period.
Prove a caller cannot create an owned period pointing at another user’s budget id.

- [ ] **Step 2: Add migration assertions**

Assert the migration contains:

```sql
create trigger budget_periods_set_updated_at
grant select, insert, update, delete on table public.budget_periods to authenticated
revoke all on table public.budget_periods from anon
```

Assert every write policy checks both `budget_periods.user_id = auth.uid()` and the referenced `budgets.user_id = auth.uid()`.

- [ ] **Step 3: Add takeout and backup tests**

Assert both routes query `budget_periods` with:

```ts
.select("budget_id,month,planned")
.eq("user_id", userId)
```

Assert a dependency query error fails the export or that user’s backup rather than silently returning an empty section.

- [ ] **Step 4: Add the migration verification block**

Document and execute these post-apply checks:

```sql
select count(*) as invalid_owner_links
from public.budget_periods bp
join public.budgets b on b.id = bp.budget_id
where bp.user_id <> b.user_id;

select relrowsecurity
from pg_class
where oid = 'public.budget_periods'::regclass;

select policyname, cmd, roles
from pg_policies
where schemaname = 'public'
  and tablename = 'budget_periods'
order by policyname;
```

Expected: zero invalid owner links, RLS enabled, and the four intended policies.

- [ ] **Step 5: Run migration and operational tests**

```bash
npm run test:unit -- tests/unit/export-routes.test.ts tests/unit/demo-backup-routes.test.ts
npm test -- tests/integration/budget-period-rls.test.ts
```

Expected: all pass.

- [ ] **Step 6: Commit the reviewed migration before reader changes**

```bash
git add supabase/migrations/20260729210000_budget_groups.sql app/api/export/takeout/route.ts app/api/cron/backup/route.ts tests/integration/budget-period-rls.test.ts tests/unit/export-routes.test.ts tests/unit/demo-backup-routes.test.ts
git commit -m "feat(budget): add secured period planning schema"
```

- [ ] **Step 7: Apply the migration to the live project**

Apply `20260729210000_budget_groups.sql` to Supabase project `zrxbmmtqqhlwtrinocww`.
Do not merge reader code until the live migration ledger contains the Budget migration.

- [ ] **Step 8: Run live verification and advisors**

Run the verification queries above and the Supabase security and performance advisors.
Record the live migration version and results in `docs/HANDOFF.md`.

---

### Task 4: Build Real Month, Year, and Decade Budget Models

**Files:**

- Modify: `lib/budget-page.ts`
- Test: `tests/unit/budget-page.test.ts`
- Fold or remove: `tests/unit/budget-full-parity.test.ts`

**Interfaces:**

- Consumes: canonical transactions, period overrides, existing budget defaults, existing rollover settings, existing sinking funds, and future goal contribution events.
- Produces:

```ts
export type BudgetViewData =
  | { horizon: "monthly"; month: BudgetMonthData }
  | { horizon: "yearly"; year: number; months: BudgetMonthData[] }
  | { horizon: "decade"; startYear: number; years: BudgetYearData[] };

export function budgetWindow(
  anchorMonth: string,
  horizon: BudgetHorizon,
): FinanceWindow;

export function buildBudgetView(input: BudgetViewInput): BudgetViewData;
```

- [ ] **Step 1: Write date-window tests**

Cover December rollover, February 2026, leap-year February 2028, yearly boundaries, calendar-decade boundaries, and invalid month input.

- [ ] **Step 2: Write monthly calculation tests**

Cover period override versus monthly default, income signs, expense remaining math, split transactions, refunds, transfers, unbudgeted categories, stable sort order, contribution empty state, and cents rounding.

- [ ] **Step 3: Write rollover and sinking-fund tests**

Reuse the existing rollover semantics from `lib/planning.ts`.
Carry both positive and negative prior-month remainder and floor the effective limit at zero.
Use `computeSinkingFunds()` from `lib/insights.ts` rather than treating unspent Non-Monthly envelopes as a sinking-fund balance.

- [ ] **Step 4: Write Year and Decade tests**

Year must return 12 monthly rows with each month’s actual, planned, and remaining values.
Decade must return annual rollups only for years that contain a transaction, a period override, or a budget record applicable to that year.
Do not implement either horizon by multiplying one month’s values.

- [ ] **Step 5: Run the focused tests and confirm they fail**

```bash
npm run test:unit -- tests/unit/budget-page.test.ts
```

- [ ] **Step 6: Implement the discriminated view model**

Keep one monthly calculation function as the source for Month, Year, and Decade.
Build Year from 12 monthly results and Decade from grouped yearly results.

- [ ] **Step 7: Run the focused tests**

```bash
npm run test:unit -- tests/unit/budget-page.test.ts tests/unit/planning-features.test.ts
```

Expected: all pass.

- [ ] **Step 8: Commit the pure Budget model**

```bash
git add lib/budget-page.ts tests/unit/budget-page.test.ts tests/unit/budget-full-parity.test.ts
git commit -m "feat(budget): model monthly and long-range plans"
```

---

### Task 5: Add an RLS-Scoped Budget Data Loader

**Files:**

- Create: `lib/budget-data.ts`
- Test: `tests/unit/budget-data.test.ts`
- Modify: `app/budget/page.tsx`

**Interfaces:**

- Consumes: `parseFinancialScope()`, `budgetWindow()`, and `loadCanonicalProjection()`.
- Produces:

```ts
export interface BudgetLoadResult {
  view: BudgetViewData;
  visibleHouseholdIds: string[];
  currencies: string[];
  selectedCurrency: string | null;
  proposals: BudgetSeedProposal[];
  truncated: boolean;
  stale: boolean;
}

export async function loadBudgetData(
  supabase: SupabaseClient,
  input: {
    userId: string;
    anchorMonth: string;
    horizon: BudgetHorizon;
    rawScope?: string | string[];
    requestedCurrency?: string | string[];
    now?: Date;
  },
): Promise<BudgetLoadResult>;
```

- [ ] **Step 1: Write Mine and Household loader tests**

Assert visible household ids come from the cookie-bound `households` query.
Assert Mine dependency reads explicitly filter owner rows.
Assert Household reads use RLS and never accept a guessed household id.

- [ ] **Step 2: Write horizon and currency loader tests**

Assert transactions use `budgetWindow()` rather than `getMonthEndDate()`.
Assert Year loads the full year and Decade loads the calendar decade.
Assert multiple currencies remain separate and the URL-selected currency controls displayed totals.

- [ ] **Step 3: Write state tests**

Cover bounded-query truncation, no successful sync, sync older than 48 hours, empty budgets, permission-safe query failure, and malformed URL values.

- [ ] **Step 4: Implement the loader**

Load budgets, budget periods, sinking funds, households, recurring ids, successful sync metadata, and canonical transactions with explicit column lists and bounded reads.
Throw safe table-specific error codes and never log financial values.

- [ ] **Step 5: Update the server page**

Validate `month`, `horizon`, `scope`, and `currency` search parameters.
Call `notFound()` when Budget is disabled or the user is missing.
Preserve scope and currency parameters in every Month, Year, and Decade link.

- [ ] **Step 6: Run loader and page tests**

```bash
npm run test:unit -- tests/unit/budget-data.test.ts tests/unit/budget-page.test.ts tests/unit/feature-flags.test.ts
```

- [ ] **Step 7: Commit the server data path**

```bash
git add lib/budget-data.ts app/budget/page.tsx tests/unit/budget-data.test.ts
git commit -m "feat(budget): load scoped reconciled planner data"
```

---

### Task 6: Complete Ownership-Safe Budget Mutations

**Files:**

- Modify: `app/api/budget/route.ts`
- Test: `tests/unit/budget-route.test.ts`
- Modify if an atomic RPC is selected: `supabase/migrations/20260729210000_budget_groups.sql`

**Interfaces:**

- Consumes:

```ts
interface UpdateBudgetRequest {
  budget_id: string;
  month: string;
  planned: number;
  group_name?: "income" | "fixed" | "flexible" | "non_monthly";
  rollover_enabled?: boolean;
  sort_order?: number;
}
```

- Produces: one atomic owner-only mutation and one audit row containing only `budget_id`, `month`, and `changed_fields`.

- [ ] **Step 1: Write validation tests**

Cover invalid JSON, invalid UUID, malformed month, extra date suffix, negative amount, `NaN`, `Infinity`, more than two decimal places, invalid group, non-boolean rollover, and non-integer sort order.

- [ ] **Step 2: Write authorization tests**

Cover unauthenticated access, missing budget, another user’s budget, a household-shared read-only budget, and an owner budget.

- [ ] **Step 3: Write failure atomicity tests**

Prove invalid metadata cannot write a period first.
Prove a metadata update failure cannot leave a new period behind.
Prove a period failure cannot leave metadata changed.

- [ ] **Step 4: Implement one atomic mutation**

Use a `SECURITY INVOKER` Postgres function or a single transactional database operation.
Revoke function execution from `PUBLIC` and grant it only to `authenticated`.
Keep owner checks in RLS and in the function’s affected-row assertion.

- [ ] **Step 5: Return the saved server representation**

Return:

```ts
{
  budget_id: string;
  month: string;
  planned: number;
  group_name: BudgetGroup;
  rollover_enabled: boolean;
  sort_order: number;
}
```

This response becomes the authoritative optimistic-update confirmation.

- [ ] **Step 6: Run route tests**

```bash
npm run test:unit -- tests/unit/budget-route.test.ts
```

- [ ] **Step 7: Commit the mutation contract**

```bash
git add app/api/budget/route.ts tests/unit/budget-route.test.ts supabase/migrations/20260729210000_budget_groups.sql
git commit -m "feat(budget): secure period and envelope updates"
```

If the migration changed after live application, create a new roll-forward migration with `supabase migration new budget_period_mutation` instead of editing the applied file.

---

### Task 7: Implement Real Budget Proposal Preview and Confirmation

**Files:**

- Modify: `lib/budget-page.ts`
- Modify: `app/api/budget/route.ts`
- Modify: `components/budget/SeedBudgetButton.tsx`
- Test: `tests/unit/budget-page.test.ts`
- Test: `tests/unit/budget-route.test.ts`

**Interfaces:**

- Consumes: trailing three complete months of canonical transactions, recurring source transaction ids, existing budgets, and `SinkingFundPlan[]`.
- Produces:

```ts
interface ConfirmBudgetProposalRequest {
  month: string;
  items: Array<{
    category: string;
    monthly_limit: number;
    group_name: BudgetGroup;
    rollover_enabled: boolean;
    sort_order: number;
  }>;
}
```

- [ ] **Step 1: Expand proposal tests**

Classify Fixed only when recurring source transactions dominate the category’s trailing expense.
Use `sourceTransactionId`, not split-row ids, when matching recurrence.
Map existing sinking funds into Non-Monthly proposals with their computed monthly set-aside.
Keep mixed categories Flexible.
Return deterministic amount rounding, confidence, explanation, and skipped-existing status.

- [ ] **Step 2: Write confirmation route tests**

Reject an empty proposal, more than 200 items, duplicate categories, invalid amounts, invalid groups, and malformed category names.
Prove the accepted batch writes only reviewed items and skips existing owner categories.

- [ ] **Step 3: Implement the preview dialog**

Pass real proposals from the server loader.
Allow the user to include or exclude each proposal and edit group, amount, rollover, and sort order before confirmation.
Use a named dialog, focus trapping, Escape close, Cancel, and a 44px minimum Confirm target.

- [ ] **Step 4: Implement batch confirmation**

Use one owner-scoped batch upsert so confirmation is atomic.
Return created and skipped category ids.
Refresh the server page only after success and retain the preview with an inline error after failure.

- [ ] **Step 5: Run focused tests**

```bash
npm run test:unit -- tests/unit/budget-page.test.ts tests/unit/budget-route.test.ts
```

- [ ] **Step 6: Commit proposal seeding**

```bash
git add lib/budget-page.ts app/api/budget/route.ts components/budget/SeedBudgetButton.tsx tests/unit/budget-page.test.ts tests/unit/budget-route.test.ts
git commit -m "feat(budget): review and accept history proposals"
```

---

### Task 8: Complete the Budget Planner UI

**Files:**

- Create: `components/budget/BudgetPlanner.tsx`
- Modify: `components/budget/BudgetTable.tsx`
- Modify: `components/budget/BudgetSummary.tsx`
- Modify: `app/budget/page.tsx`
- Modify: `components/settings/BudgetsSection.tsx`

**Interfaces:**

- Consumes: `BudgetViewData`, saved mutation responses, and Budget loader states.
- Produces: the complete Month, Year, and Decade experience from the Phase 4 acceptance criteria.

- [ ] **Step 1: Build Month view**

Render Income, Fixed, Flexible, Non-Monthly, and Contributions.
Collapse unbudgeted rows behind a button that states the exact count.
Allow planned amount edits, group moves, rollover toggles, and sort-order changes.

- [ ] **Step 2: Make optimistic updates internally consistent**

Lift planner state into `BudgetPlanner`.
Update row, section, Summary, Income, and Expenses totals together.
Rollback the entire prior state on a non-2xx response.
Announce save and rollback results through an `aria-live` region.

- [ ] **Step 3: Build Year view**

Render 12 monthly planned, actual, and remaining rows.
Provide a table-first responsive experience with a compact visual summary only when it has a table twin.

- [ ] **Step 4: Build Decade view**

Render one annual rollup per year with data.
Do not render fabricated zero-history years.

- [ ] **Step 5: Add right-side summary tabs**

Implement URL-driven `summary=summary|income|expenses`.
Preserve month, horizon, scope, and currency in every tab link.

- [ ] **Step 6: Add loading and failure states**

Add loading, empty, partial-data, stale-data, permission-safe, and error states.
Show the bounded-data warning when `truncated` is true.
Show the tested empty Contributions state until Phase 7 provides contribution events.

- [ ] **Step 7: Keep the Settings editor as the simple editor**

Add a link from `components/settings/BudgetsSection.tsx` to `/budget`.
Do not duplicate planner behavior inside Settings.

- [ ] **Step 8: Run unit, accessibility, and build checks**

```bash
npm run lint
npm run typecheck
npm run test:unit
npm run build
```

- [ ] **Step 9: Commit the complete UI**

```bash
git add components/budget app/budget/page.tsx components/settings/BudgetsSection.tsx
git commit -m "feat(budget): add responsive planner views"
```

---

### Task 9: Add Credentialed E2E Acceptance and Reconciliation

**Files:**

- Create: `tests/e2e/budget.spec.ts`
- Modify: shared E2E fixtures only when required for canonical test data

**Interfaces:**

- Consumes: the Phase 0 canonical fixture, live or isolated test credentials, and the released Budget route.
- Produces: end-user evidence for the complete Phase 4 journey.

- [ ] **Step 1: Seed the acceptance fixture**

Include a paycheck, ordinary expense, transfer, refund pair, split transaction, merchant rename, category override, pending transaction, household-shared transaction, two currencies, one sinking fund, and one recurring source transaction.

- [ ] **Step 2: Test proposal acceptance**

Open Budget, preview history proposals, edit one proposal, exclude one proposal, confirm, and verify the saved categories after reload.

- [ ] **Step 3: Test edits and rollback**

Edit a planned amount, move a category, enable rollover, and verify totals update.
Intercept one mutation with a 500 response and verify the row and all summary totals roll back.

- [ ] **Step 4: Test Month, Year, and Decade**

Verify Month includes the final calendar day.
Verify Year exposes 12 actual monthly rows.
Verify Decade exposes only years with data.

- [ ] **Step 5: Test reconciliation**

For the same month, scope, and currency, assert Budget Actual Expenses equals Cash Flow Expenses.
Assert split and refund semantics match the canonical fixture.

- [ ] **Step 6: Test scope and currency isolation**

Switch Mine and Household through URL navigation.
Prove an unshared connection never appears.
Switch currencies and prove values are not combined.

- [ ] **Step 7: Run responsive light and dark acceptance**

Run at 1440x900, 768x1024, and 390x844.
Assert no horizontal document overflow, no clipped controls, 44px interactive targets, visible focus, no browser exceptions, and no console errors.

- [ ] **Step 8: Run the credentialed journey**

```bash
npm run test:e2e -- tests/e2e/budget.spec.ts
```

Expected: all Budget journeys pass.

- [ ] **Step 9: Commit acceptance coverage**

```bash
git add tests/e2e/budget.spec.ts
git commit -m "test(budget): cover planner acceptance journey"
```

---

### Task 10: Release, Documentation, and Final Gates

**Files:**

- Modify: `lib/feature-flags.ts`
- Modify: `docs/HANDOFF.md`
- Modify: PR #72 title and body

**Interfaces:**

- Consumes: live migration evidence and all passing acceptance gates.
- Produces: an honestly described, production-ready Phase 4 PR.

- [ ] **Step 1: Confirm the live migration**

Verify the Supabase migration ledger contains the Budget migration and rerun the post-apply SQL checks.

- [ ] **Step 2: Release the Budget flag**

Set `budgetPage: true` only after the live migration and credentialed browser acceptance are green.
Verify both desktop and mobile navigation render Budget and still hide every unimplemented destination.

- [ ] **Step 3: Update the handoff**

Record the live migration version, verification counts, feature-flag state, test totals, browser viewports, remaining manual operations, and the next phase.

- [ ] **Step 4: Run the full local gate**

```bash
npm run lint
npm run typecheck
npm test
npm run test:coverage
npm run build
npm run test:e2e -- tests/e2e/budget.spec.ts
git diff --check
npm audit --audit-level=high
```

Expected: all required gates pass.
Document any known dev-only audit advisory without forcing an unrelated major upgrade.

- [ ] **Step 5: Verify coverage honestly**

Keep the existing repository threshold unchanged.
Require SonarCloud new-code coverage to meet or exceed 80 percent.
Add meaningful branch tests instead of excluding files or inflating thresholds.

- [ ] **Step 6: Push and watch every check**

```bash
git push origin feat/monarch-parity-all-phases
gh pr checks 72 --watch
```

Expected: CI, migration smoke, E2E smoke, CodeQL, SonarCloud, and Vercel all pass.

- [ ] **Step 7: Correct the PR metadata**

Use a title that names only Phase 4 Budget.
Remove all Phase 5 through Phase 13 completion claims.
Copy the exact test totals from the final GitHub Actions log.
Link the migration verification and E2E evidence.

## Later Phase Rule

After PR #72 merges, start Phase 5 from `main` in a new branch and expand only Phase 5 into its own TDD execution plan.
Repeat this rule for Reports, Goals, Dashboard widgets, Investments, Forecasting, Advice, Transactions, and Settings.
Do not combine those product slices into PR #72.

## Self-Review Checklist

- [ ] Every Phase 4 acceptance item in the master parity plan maps to a task above.
- [ ] No placeholder route or mock financial dataset remains in production code.
- [ ] Every new type used by a later task is defined in an earlier task.
- [ ] Migration ordering is explicit and the live apply checkpoint precedes reader release.
- [ ] Mine, Household, currency, canonical splits, refunds, rollover, sinking funds, and bounded reads are covered.
- [ ] Unit, route, RLS, E2E, accessibility, coverage, build, deployment, and documentation gates are covered.
- [ ] No later-phase implementation remains in the PR.
