# Cash Flow Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a production-ready Cash Flow page whose income, expenses, savings, savings rate, and breakdowns reconcile with FundFlow's canonical transaction semantics.

**Architecture:** A pure cash-flow domain module buckets canonical Phase 0 transactions into monthly, quarterly, and yearly periods, partitions them by account currency, and builds complete breakdown tables.
A bounded server-side loader reads at most 24 months through `fetchFinanceTransactions`, loads the exact projection dependencies, and passes real splits to `projectFinanceTransactions`.
Server-rendered page controls use URL state, while accessible SVG and HTML charts always ship with complete table twins.

**Tech Stack:** Next.js 16.2.11 App Router, React 19.2.7 Server Components, TypeScript 6, Tailwind 4.3.3, Supabase JS 2.110.9, Vitest 4.1.10, Playwright 1.61.1.

## Completion Record

Phase 3 was implemented test-first on 2026-07-29.
Browser and integration reproduction uncovered a nested-RLS defect in household transaction reads.
Migration `20260729203107_shared_transaction_authorization.sql` was committed before reader code, applied to live project `zrxbmmtqqhlwtrinocww`, and verified as live migration version `20260729203351`.
The final code review then found that shared split and linked-refund metadata was still owner-only.
Migration `20260729204345_shared_projection_metadata_authorization.sql` was also committed before reader code, applied live, and verified as version `20260729204429`.
The live RLS regression suite passes at 6 tests.
The full Vitest suite passes at 141 files and 978 tests.
Lint, typecheck, build, credentialed and secretless-safe Cash Flow E2E, and diff checks pass.
Responsive screenshots were reviewed at desktop, tablet, and mobile sizes in light and dark themes.
That review also fixed the preexisting mobile `Sign out` wrapping defect.
The known dev-only ESLint dependency audit advisory remains because the offered fix is a forced ESLint 10 major upgrade.

## Global Constraints

- Work on `feat/cash-flow-page`, stacked on `feat/accounts-page` until PR #70 merges.
- Preserve all Phase 0 contracts in `lib/finance-domain.ts`, `lib/finance-query.ts`, `lib/financial-scope.ts`, and `lib/feature-flags.ts`.
- Every transaction read must go through `fetchFinanceTransactions`.
- Every page total must consume `projectFinanceTransactions`.
- Pass real transaction splits because Cash Flow has no legacy downstream split path.
- Obtain Mine or Household scope only through `parseFinancialScope`.
- Rely on the cookie-bound Supabase client's RLS for Household reads.
- Never reapply merchant rules, category overrides, refund netting, transfer exclusion, or raw Plaid PFC interpretation in the page.
- The analytical Cash Flow page uses canonical `flow` values for Income and Expenses so it reconciles with Budget and Reports.
- The existing dashboard's literal depository deposit and withdrawal chart remains unchanged.
- Pending rows remain included by default, matching Phase 0.
- Query at most 24 months and at most `FINANCE_MAX_ROWS` transactions for the interactive page.
- Use `YYYY-MM-DD` dates and `YYYY-MM` month keys without local-time conversion.
- Do not combine currencies without exchange rates.
- When multiple currencies are visible, render one selected currency at a time and disclose that totals are separated.
- Charts use only `--viz-*` tokens and each chart has a complete table twin.
- `foldTail` affects only the visible breakdown bars.
- The breakdown table retains every row.
- Controls are GET navigation with canonical URL parameters and no client state.
- Support loading, empty, partial-data, stale-data, permission-denied, and error states.
- Add no Plaid calls.
- Log only bounded row counts, selected period metadata, and safe error codes.
- Never log amounts, merchants, account masks, or transaction details.
- Do not modify `proxy.ts`.
- Keep the Cash Flow sidebar entry deferred with Phase 1.
- Feature flags control reachability only and never weaken authentication or RLS.
- Use conventional commits and do not add an agent co-author.
- Before any completion claim, run the focused tests, full unit suite, lint, typecheck, build, and the touched Playwright journey.
- Before deployment verification, upgrade Vercel CLI 56.3.2 to the latest release with `npm i -g vercel@latest` or `pnpm add -g vercel@latest`.

## File Structure

- Create `lib/cash-flow.ts`.
  It owns period parsing, date-window validation, currency partitioning, period aggregation, selected-period filtering, and complete breakdown rows.
- Create `lib/cash-flow-data.ts`.
  It owns the bounded cookie-client read, exact projection dependency queries, row adaptation, real-split projection, currency lookup, truncation state, and safe freshness metadata.
- Create `components/cash-flow/PeriodBars.tsx`.
  It wraps `DivergingColumns` and adds cumulative savings as the optional line overlay.
- Create `components/cash-flow/BreakdownBars.tsx`.
  It renders at most six chart bars after `foldTail` and a complete table containing every breakdown row.
- Create `components/cash-flow/CashFlowControls.tsx`.
  It renders URL-driven period, range, selected-period, dimension, scope, and currency controls.
- Create `components/cash-flow/CashFlowSummary.tsx`.
  It renders the selected period's four summary cards with correct currency and percentage formatting.
- Create `app/cash-flow/page.tsx`.
  It authenticates, parses scope and URL state, loads bounded canonical data, renders warnings and empty states, and composes the page.
- Create `app/cash-flow/loading.tsx`.
  It provides meaningful route-level skeleton content for dynamic navigation.
- Create `app/cash-flow/error.tsx`.
  It provides the client error boundary with a retry action and no sensitive error details.
- Create `tests/unit/cash-flow.test.ts`.
  It protects period bucketing, signs, ordering, breakdowns, percentages, selected-period filtering, and currencies.
- Create `tests/unit/cash-flow-data.test.ts`.
  It protects the bounded window, scope filters, real projection dependencies, split forwarding, and truncation metadata.
- Create `tests/unit/cash-flow-render.test.ts`.
  It protects chart geometry, table twins, complete breakdown detail, summary formatting, controls, and empty states.
- Create `tests/unit/cash-flow-page-route.test.ts`.
  It protects the rollout flag, auth, Mine and Household scoping, and honest empty and partial states.
- Create `tests/e2e/cash-flow.spec.ts`.
  It covers URL navigation, reconciliation, responsive layout, themes, errors, console output, and horizontal overflow.
- Create `supabase/migrations/20260729203107_shared_transaction_authorization.sql`.
  It repairs household transaction reads by reusing the private shared-account authorization helper without exposing Plaid item rows.
- Create `supabase/migrations/20260729204345_shared_projection_metadata_authorization.sql`.
  It lets shared split and refund metadata follow visible source transactions while preserving owner-only writes.
- Modify `components/charts/DivergingColumns.tsx`.
  It accepts an optional signed line overlay, expands the shared scale to include it, renders the line with a visualization token, and adds the line values to tooltips and the table twin.
- Modify `components/LogoutButton.tsx`.
  It keeps the mobile header action on one line after the responsive browser test reproduced the wrap.
- Modify `components/shell/AppSidebar.tsx`.
  It adds `cashFlow` only to the `AppShellActive` type so the page can avoid falsely highlighting another route.
- Modify `lib/feature-flags.ts`.
  It releases `cashFlowPage` only after all acceptance gates pass.
- Modify `lib/format.ts`.
  It formats unavailable currency as a neutral number instead of inventing a dollar symbol.
- Modify `docs/HANDOFF.md`.
  It records the delivered Phase 3 contract, verification, and Phase 4 as the next vertical slice while Phase 1 remains deferred.
- Modify `docs/TODO.md`.
  It records Phase 2 and Phase 3 completion without changing unrelated deferred items.

---

### Task 1: Build The Cash Flow Domain

**Files:**

- Create: `lib/cash-flow.ts`
- Create: `tests/unit/cash-flow.test.ts`

**Interfaces:**

- Consumes `CanonicalFinanceTransaction` from `lib/finance-domain.ts`.
- Produces `CashFlowPeriod`, `PeriodCashFlow`, `BreakdownRow`, `computePeriodCashFlow`, `breakdownBy`, `cashFlowPeriodKey`, `filterCashFlowPeriod`, and `partitionCashFlowByCurrency`.

- [x] **Step 1: Write failing tests for monthly, quarterly, and yearly aggregation**

Use literal canonical rows that cover income, expenses, transfers, negative savings, a leap day, an empty-income period, and out-of-order input.

Assert these hand-derived results:

```ts
expect(computePeriodCashFlow(rows, "monthly")).toEqual([
  {
    key: "2024-02",
    label: "Feb 2024",
    income: 1000,
    expenses: 1200,
    savings: -200,
    savingsRate: -20,
  },
  {
    key: "2024-03",
    label: "Mar 2024",
    income: 0,
    expenses: 50,
    savings: -50,
    savingsRate: 0,
  },
]);
```

Assert the same literals under keys `2024-Q1` and `2024`.
Assert transfers never enter analytical Income or Expenses.

- [x] **Step 2: Run the focused domain test and verify the expected failure**

Run:

```bash
npm test -- --run tests/unit/cash-flow.test.ts
```

Expected: FAIL because `lib/cash-flow.ts` does not exist.

- [x] **Step 3: Implement period keys and aggregation**

Define:

```ts
export type CashFlowPeriod = "monthly" | "quarterly" | "yearly";

export interface PeriodCashFlow {
  key: string;
  label: string;
  income: number;
  expenses: number;
  savings: number;
  savingsRate: number;
}

export function cashFlowPeriodKey(
  date: string,
  period: CashFlowPeriod,
): string;

export function computePeriodCashFlow(
  txns: CanonicalFinanceTransaction[],
  period: CashFlowPeriod,
): PeriodCashFlow[];
```

Use string-derived year and month values.
Round money and percentages to two decimals.
Use `0` for savings rate when income is zero.
Sort results by key ascending.

- [x] **Step 4: Run the focused aggregation tests**

Run:

```bash
npm test -- --run tests/unit/cash-flow.test.ts
```

Expected: aggregation tests PASS.

- [x] **Step 5: Write failing breakdown tests**

Use literal rows that include duplicate categories, groups, and merchants, blank labels, transfers, both directions, and fractional amounts.

Assert:

```ts
expect(breakdownBy(rows, "merchant", "expense")).toEqual([
  { label: "Grocer", amount: 75, pct: 75 },
  { label: "Unknown", amount: 25, pct: 25 },
]);
```

Add a rounding fixture whose returned percentages sum to exactly `100`.
Assert a zero direction total returns `[]`.

- [x] **Step 6: Run the breakdown test and verify the expected failure**

Run:

```bash
npm test -- --run tests/unit/cash-flow.test.ts
```

Expected: FAIL because `breakdownBy` is missing.

- [x] **Step 7: Implement complete breakdown rows**

Define:

```ts
export type BreakdownDimension = "category" | "group" | "merchant";
export type BreakdownDirection = "income" | "expense";

export interface BreakdownRow {
  label: string;
  amount: number;
  pct: number;
}

export function breakdownBy(
  txns: CanonicalFinanceTransaction[],
  dimension: BreakdownDimension,
  direction: BreakdownDirection,
): BreakdownRow[];
```

Filter by canonical `flow`.
Use absolute values for Income and positive values for Expenses.
Normalize blank labels to `Unknown`.
Sort by amount descending and label ascending as a stable tie breaker.
Allocate the final row's rounded percentage as the remainder to exactly `100`.

- [x] **Step 8: Write and run failing selected-period and currency tests**

Assert `filterCashFlowPeriod` returns only rows whose computed key equals the selected key.
Assert `partitionCashFlowByCurrency` returns separate `CAD`, `USD`, and `Unknown currency` groups without combining amounts.

Run:

```bash
npm test -- --run tests/unit/cash-flow.test.ts
```

Expected: FAIL because the helpers are missing.

- [x] **Step 9: Implement selected-period and currency helpers**

Define:

```ts
export function filterCashFlowPeriod(
  txns: CanonicalFinanceTransaction[],
  period: CashFlowPeriod,
  key: string,
): CanonicalFinanceTransaction[];

export function partitionCashFlowByCurrency(
  txns: CanonicalFinanceTransaction[],
  currencyByAccountId: ReadonlyMap<string, string>,
): Map<string, CanonicalFinanceTransaction[]>;
```

Use `row.accountId` as the lookup key.
Normalize valid currencies to uppercase.
Use `Unknown currency` when the account or currency is missing.
Return currency keys in locale-aware ascending order.

- [x] **Step 10: Run the complete domain suite**

Run:

```bash
npm test -- --run tests/unit/cash-flow.test.ts
```

Expected: all Cash Flow domain tests PASS.

---

### Task 2: Load A Bounded Canonical Projection

**Files:**

- Create: `lib/cash-flow-data.ts`
- Create: `tests/unit/cash-flow-data.test.ts`

**Interfaces:**

- Consumes `fetchFinanceTransactions`, `monthWindow`, `projectFinanceTransactions`, and `FinancialScope`.
- Produces:

```ts
export interface CashFlowLoadOptions {
  scope: FinancialScope;
  anchorMonth: string;
  rangeMonths: 6 | 12 | 24;
  now?: Date;
}

export interface CashFlowLoadResult {
  transactions: CanonicalFinanceTransaction[];
  currencyByAccountId: Map<string, string>;
  truncated: boolean;
  lastSuccessfulSyncAt: string | null;
  stale: boolean;
}

export async function loadCashFlowData(
  supabase: SupabaseClient,
  options: CashFlowLoadOptions,
): Promise<CashFlowLoadResult>;
```

- [x] **Step 1: Write a failing Mine-scope query test**

Record all query calls.
Assert:

```ts
expect(fetchFinanceTransactions).toHaveBeenCalledWith(
  supabase,
  expect.objectContaining({
    scope: { kind: "mine", ownerUserId: "user-1" },
    window: { start: "2025-08-01", endExclusive: "2026-08-01" },
    maxRows: FINANCE_MAX_ROWS,
  }),
);
```

Assert `accounts`, `merchant_rules`, `category_overrides`, `transaction_splits`, `linked_refunds`, and `sync_jobs` are filtered by `user_id`.

- [x] **Step 2: Run the focused loader test and verify the expected failure**

Run:

```bash
npm test -- --run tests/unit/cash-flow-data.test.ts
```

Expected: FAIL because `loadCashFlowData` does not exist.

- [x] **Step 3: Implement the bounded reads**

Call `monthWindow(anchorMonth, rangeMonths - 1)`.
Pass `FINANCE_MAX_ROWS`.
Select explicit account and dependency columns.
Filter transaction splits to the fetched source transaction ids in chunks of at most `500`.
Bound rule, override, account, refund, and sync metadata queries with explicit limits.

- [x] **Step 4: Write a failing Household-scope test**

Assert `fetchFinanceTransactions` receives the Household scope.
Assert no `user_id` filter is added to RLS-visible dependency queries.

- [x] **Step 5: Run the Household test and verify the expected failure**

Run:

```bash
npm test -- --run tests/unit/cash-flow-data.test.ts
```

Expected: FAIL until scope-aware dependency filtering is implemented.

- [x] **Step 6: Implement scope-aware dependency reads**

Use `scopeQueryUserId`.
Apply `.eq("user_id", userId)` only for Mine scope.
For Household scope, let the cookie client and table RLS determine visibility.

- [x] **Step 7: Write a failing projection-contract test**

Mock the returned raw rows and dependencies.
Assert `projectFinanceTransactions` receives:

```ts
expect.objectContaining({
  rows: rawRows,
  splits: [
    { transactionId: "expense-1", category: "Groceries", amount: 40 },
    { transactionId: "expense-1", category: "Dining", amount: 60 },
  ],
  linkedRefunds: [
    {
      chargeTransactionId: "charge-1",
      refundTransactionId: "refund-1",
    },
  ],
  accountNames: new Map([["account-1", "Checking"]]),
});
```

Assert the result preserves `truncated`.
Assert stale is true only when the last successful sync is absent or older than 48 hours.

- [x] **Step 8: Implement projection adaptation and safe metadata**

Map database rows to the existing Phase 0 public interfaces.
Forward real splits.
Return account currency lookups.
Do not return raw dependency rows.
Compute freshness from `updated_at` only.

- [x] **Step 9: Run loader tests and static gates**

Run:

```bash
npm test -- --run tests/unit/cash-flow-data.test.ts
npm run lint
npm run typecheck
```

Expected: all commands PASS.

---

### Task 3: Add Accessible Cash Flow Visuals

**Files:**

- Modify: `components/charts/DivergingColumns.tsx`
- Create: `components/cash-flow/PeriodBars.tsx`
- Create: `components/cash-flow/BreakdownBars.tsx`
- Create: `components/cash-flow/CashFlowSummary.tsx`
- Create: `tests/unit/cash-flow-render.test.ts`

**Interfaces:**

- `DivergingColumns` accepts:

```ts
line?: {
  name: string;
  values: number[];
};
```

- `PeriodBars` consumes `PeriodCashFlow[]` and a currency code.
- `BreakdownBars` consumes complete `BreakdownRow[]`, a direction label, and a currency code.
- `CashFlowSummary` consumes one selected `PeriodCashFlow` and a currency code.

- [x] **Step 1: Write a failing line-overlay render test**

Render `DivergingColumns` with positive and negative cumulative savings values.
Assert the output contains:

```ts
expect(html).toContain('data-series="Cumulative savings"');
expect(html).toContain('stroke="var(--viz-ink)"');
expect(html).toContain("Cumulative savings");
expect(html).not.toContain("NaN");
```

Assert the table twin contains the cumulative savings column.

- [x] **Step 2: Run the render test and verify the expected failure**

Run:

```bash
npm test -- --run tests/unit/cash-flow-render.test.ts
```

Expected: FAIL because the overlay prop and components do not exist.

- [x] **Step 3: Extend DivergingColumns with one shared signed scale**

Include the absolute overlay values when computing the symmetrical chart maximum.
Map positive line values above the zero baseline and negative values below it.
Render one `path` through period midpoints using `linePath`.
Add the overlay name and values to the legend, native tooltips, aria labels, and table twin.

- [x] **Step 4: Implement PeriodBars**

Compute cumulative savings in period order:

```ts
let cumulative = 0;
const values = periods.map((row) => {
  cumulative += row.savings;
  return Math.round(cumulative * 100) / 100;
});
```

Pass Income as the up arm, Expenses as the down arm, and cumulative values as the line.
Use a currency-aware compact formatter.

- [x] **Step 5: Write a failing breakdown detail test**

Render seven complete rows.
Assert only six visual bars render and the last visual bar is `Other`.
Assert all seven original labels remain in the table.
Assert zero rows render `No expense data for this period.`

- [x] **Step 6: Implement BreakdownBars**

Call:

```ts
const chartRows = foldTail(rows, 6, (amount) => ({
  label: "Other",
  amount,
  pct: total > 0 ? Math.round((amount / total) * 10_000) / 100 : 0,
}));
```

Render semantic progress-style bars with visible labels, amounts, and percentages.
Render the complete `rows` array in a `<details>` table twin.

- [x] **Step 7: Write and implement summary-card tests**

Assert Income, Expenses, Savings, and Savings rate use the selected period.
Assert negative savings is visibly negative.
Assert non-USD currency codes format through `formatCurrency(value, currency)`.
Assert a missing selected period renders an honest empty message.

- [x] **Step 8: Run render tests and static gates**

Run:

```bash
npm test -- --run tests/unit/cash-flow-render.test.ts tests/unit/charts-render.test.ts
npm run lint
npm run typecheck
```

Expected: all commands PASS.

---

### Task 4: Add URL-Driven Controls And Page States

**Files:**

- Create: `components/cash-flow/CashFlowControls.tsx`
- Create: `app/cash-flow/page.tsx`
- Create: `app/cash-flow/loading.tsx`
- Create: `app/cash-flow/error.tsx`
- Modify: `components/shell/AppSidebar.tsx`
- Create: `tests/unit/cash-flow-page-route.test.ts`

**Interfaces:**

- Canonical query parameters are `period`, `range`, `selected`, `dimension`, `scope`, and `currency`.
- Defaults are `monthly`, `12`, the latest available period, `category`, Mine scope, and the first sorted currency.

- [x] **Step 1: Write failing rollout and auth tests**

Mock the feature flag off and assert `notFound()`.
Mock an absent user and assert `notFound()`.

- [x] **Step 2: Run the page test and verify the expected failure**

Run:

```bash
npm test -- --run tests/unit/cash-flow-page-route.test.ts
```

Expected: FAIL because `/cash-flow` does not exist.

- [x] **Step 3: Implement page authentication, flagging, and URL validation**

Use:

```ts
if (!isFeatureEnabled("cashFlowPage")) notFound();
const params = await searchParams;
const period = validCashFlowPeriod(params.period);
const rangeMonths = validCashFlowRange(params.range);
const dimension = validBreakdownDimension(params.dimension);
```

Read the user from the cookie client.
Read visible Household ids.
Pass the raw scope through `parseFinancialScope`.
Never parse a Household id manually.

- [x] **Step 4: Write failing Mine and Household scope tests**

Assert Mine passes `{ kind: "mine", ownerUserId: "user-1" }` to `loadCashFlowData`.
Assert a visible Household id passes `{ kind: "household", householdId: "household-1" }`.
Assert an unknown Household id degrades to Mine.

- [x] **Step 5: Implement the page data flow**

Load canonical rows with the validated range.
Partition by currency.
Select a valid currency or the first sorted currency.
Build all period rows.
Select a valid period key or the latest row.
Filter rows to that selected period before calling `breakdownBy`.

- [x] **Step 6: Write failing empty, partial, stale, and currency tests**

Assert:

- No rows render `No cash flow yet` with a link to Transactions.
- `truncated: true` renders an honest partial-data warning.
- `stale: true` renders a stale-data warning.
- More than one currency renders the no-exchange-rate disclosure and currency controls.
- A selected unknown currency falls back to the first visible currency.

- [x] **Step 7: Implement page composition**

Render:

- Title and selected date-window copy.
- `CashFlowControls`.
- Partial, stale, and multi-currency disclosures.
- `CashFlowSummary`.
- `PeriodBars`.
- Income and Expenses `BreakdownBars`.
- A safe count log containing only row count, truncation, period, range, and scope kind.

- [x] **Step 8: Implement loading and error boundaries**

The loading state renders a page title skeleton and card/chart skeletons with `aria-busy="true"`.
The error boundary uses `"use client"`, renders `Cash Flow is temporarily unavailable`, and calls `reset()` from a minimum 44px retry button.
Do not render `error.message`.

- [x] **Step 9: Add the non-navigation active key**

Add `"cashFlow"` to `AppShellActive`.
Do not add a sidebar link yet.

- [x] **Step 10: Run page tests and static gates**

Run:

```bash
npm test -- --run tests/unit/cash-flow-page-route.test.ts tests/unit/cash-flow-render.test.ts
npm run lint
npm run typecheck
```

Expected: all commands PASS.

---

### Task 5: Reconcile With The Canonical Demo Fixture

**Files:**

- Modify: `tests/unit/dashboard-finance-parity.test.ts`
- Modify: `tests/unit/cash-flow.test.ts`

**Interfaces:**

- The July 2026 selected Cash Flow period must equal `financeTotals` over the same canonical rows.

- [x] **Step 1: Write a failing parity assertion**

Build the existing canonical fixture with real splits.
Assert:

```ts
expect(july).toMatchObject({
  income: canonicalTotals.income,
  expenses: canonicalTotals.expenses,
  savings: canonicalTotals.net,
});
expect(july.savingsRate).toBe(
  canonicalTotals.income === 0
    ? 0
    : Math.round((canonicalTotals.net / canonicalTotals.income) * 10_000) / 100,
);
```

- [x] **Step 2: Run the parity test and verify the expected failure**

Run:

```bash
npm test -- --run tests/unit/dashboard-finance-parity.test.ts tests/unit/cash-flow.test.ts
```

Expected: FAIL if any Cash Flow total diverges from the canonical projection.

- [x] **Step 3: Correct only the cash-flow aggregation**

Do not alter Phase 0 semantics or dashboard outputs to satisfy the new page.
Use canonical `flow`, `signedAmount`, and the selected period only.

- [x] **Step 4: Run the parity and full unit suites**

Run:

```bash
npm test -- --run tests/unit/dashboard-finance-parity.test.ts tests/unit/cash-flow.test.ts
npm run test:unit
```

Expected: all commands PASS.

---

### Task 6: Release The Feature And Add Browser Acceptance

**Files:**

- Modify: `lib/feature-flags.ts`
- Create: `tests/e2e/cash-flow.spec.ts`

**Interfaces:**

- `FEATURE_FLAG_DEFAULTS.cashFlowPage` becomes `true` only after browser acceptance passes.

- [x] **Step 1: Write the secretless-safe E2E setup**

Load `.env.local`.
Call `test.skip(!RUN, "Supabase browser and service credentials are required")` before creating clients.
Construct the service client inside `beforeAll`.
Create temporary users and clean them up through the admin client.

- [x] **Step 2: Seed deterministic July 2026 data**

Seed one user, one USD depository account, and transactions covering Income, Expenses, one transfer, one linked refund pair, one split, one merchant rule, and one category override.
Use hand-derived expected page totals.

- [x] **Step 3: Write the desktop journey**

Assert:

- `/cash-flow` renders the exact July cards.
- Transfer and linked refund rows do not enter analytical totals.
- The split categories appear in the Expense table.
- Period, range, dimension, selected period, scope, and currency actions update the URL.
- No hydration, console, server-response, or same-origin request errors occur.

- [x] **Step 4: Write responsive and theme acceptance**

Run at 1440 by 900, 768 by 1024, and 390 by 844 in light and dark themes.
Assert no horizontal overflow.
Assert controls and retry-capable buttons have at least 44px touch targets.
Capture screenshots only when `CASH_FLOW_E2E_SCREENSHOT_DIR` is set.

- [x] **Step 5: Verify secretless and credentialed E2E**

Run:

```bash
NEXT_PUBLIC_SUPABASE_URL= \
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY= \
SUPABASE_SECRET_KEY= \
E2E_BASE_URL=http://127.0.0.1:3000 \
npm run test:e2e -- tests/e2e/cash-flow.spec.ts

npm run test:e2e -- tests/e2e/cash-flow.spec.ts
```

Expected: secretless run exits zero with one skipped journey.
Expected: credentialed run passes.

- [x] **Step 6: Release the feature**

Change:

```ts
cashFlowPage: true,
```

Run the page and feature-flag tests again.

---

### Task 7: Document And Verify Phase 3

**Files:**

- Modify: `docs/HANDOFF.md`
- Modify: `docs/TODO.md`

**Interfaces:**

- The handoff records the exact branch, query bound, canonical semantics, currency behavior, test evidence, and next phase.

- [x] **Step 1: Update the handoff**

Write one sentence per physical line.
Record that Phase 3:

- Reads through `fetchFinanceTransactions`.
- Passes real splits to `projectFinanceTransactions`.
- Uses `parseFinancialScope`.
- Separates currencies.
- Caps the page at 24 months and `FINANCE_MAX_ROWS`.
- Leaves literal depository movement on the existing dashboard unchanged.
- Adds no migration and no Plaid calls.
- Leaves Phase 1 deferred.
- Makes Phase 4 Budget the next vertical slice.

- [x] **Step 2: Update the parity status**

Mark Phase 2 and Phase 3 complete in `docs/TODO.md`.
Do not edit generated change logs.

- [x] **Step 3: Run the complete verification gate**

Run:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e -- tests/e2e/cash-flow.spec.ts
git diff --check
```

Expected:

- ESLint exits zero with no warnings.
- TypeScript exits zero.
- Vitest reports zero failed files and zero failed tests.
- Next.js build includes `/cash-flow`.
- Playwright reports the Cash Flow journey passing.
- `git diff --check` exits zero.

- [x] **Step 4: Review the exact diff**

Run:

```bash
git status --short
git diff --stat
git diff --check
```

Confirm only Phase 3 files and intentional shared chart/type changes are present.

- [x] **Step 5: Commit the completed phase**

Run:

```bash
git add \
  app/cash-flow \
  components/cash-flow \
  components/charts/DivergingColumns.tsx \
  components/shell/AppSidebar.tsx \
  lib/cash-flow.ts \
  lib/cash-flow-data.ts \
  lib/feature-flags.ts \
  tests/unit/cash-flow.test.ts \
  tests/unit/cash-flow-data.test.ts \
  tests/unit/cash-flow-render.test.ts \
  tests/unit/cash-flow-page-route.test.ts \
  tests/unit/dashboard-finance-parity.test.ts \
  tests/e2e/cash-flow.spec.ts \
  docs/HANDOFF.md \
  docs/TODO.md \
  docs/superpowers/plans/2026-07-29-cash-flow-page.md

git commit -m "feat(cash-flow): add reconciled cash flow analysis"
```

## Self-Review Results

- Every Phase 3 master-plan checkbox maps to at least one task above.
- The page reads only bounded transactions through the Phase 0 query helper.
- The projection receives merchant rules, category overrides, real splits, linked refunds, and account names.
- Mine and Household scope both use the canonical parser and cookie-client RLS.
- Multi-currency totals are separated and never silently combined.
- Period and breakdown functions are pure and test-first.
- `foldTail` changes only visible bars and never the complete data table.
- The cumulative savings overlay shares the chart's signed money scale and table twin.
- Loading, empty, partial, stale, permission, and error states are covered.
- Browser acceptance covers desktop, tablet, phone, light, and dark modes.
- No migration, Plaid call, new dependency, generated changelog edit, or unrelated refactor is included.
