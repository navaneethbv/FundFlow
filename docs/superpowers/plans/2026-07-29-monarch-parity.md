# Financial Planner Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Scope note:** This document is the reviewed master plan for a multi-release program.
> Each phase is a reviewable product slice with explicit data contracts, tests, migration ordering, rollout gates, and E2E acceptance criteria.
> Before implementation, copy the selected phase into its own dated plan file and break each checked item into the 2-to-5-minute red-green-refactor-commit steps required by `superpowers:writing-plans`.

**Goal:** Give FundFlow the useful planning, reporting, account, recurring, goals, investment, advice, transaction, dashboard, and settings capabilities visible in the supplied financial-planner screenshots without copying Monarch branding, proprietary assets, or product-specific billing features.

**Architecture:** Phase 0 first creates one canonical financial-data projection so Accounts, Cash Flow, Budget, Reports, Forecasting, Advice, and widgets cannot disagree about signs, exclusions, merchant rules, category overrides, splits, refunds, manual records, or household scope.
Feature pages continue FundFlow's existing pattern of pure unit-tested domain modules, RLS-scoped reads through the cookie client, focused route handlers behind `requireUser()`, and server-rendered SVG charts driven by `--viz-*` tokens.
Daily account and holding history is idempotently captured after successful syncs, while existing monthly net-worth history remains backward compatible.

**Tech Stack:** Next.js 16 App Router, TypeScript, Tailwind 4, Supabase (Postgres + RLS), Plaid (adding the `investments` product), Vitest.

## Review verdict

The original draft had the right product areas and a sensible broad dependency order, but it was not safe to execute unchanged.
The review found the following required changes:

- Add a Phase 0 reconciliation contract before building more aggregations.
  The current draft independently re-implements transaction meaning in several phases and would produce mismatched totals.
- Add Settings parity as a real phase.
  The settings screenshot is materially different from the current single long page and was absent from the inventory.
- Do not ship authenticated "Coming soon" pages.
  Add routes and navigation entries together as each vertical slice becomes usable.
- Do not modify protected route prefixes in `proxy.ts`.
  The current proxy already protects every non-public page by default.
- Include manual accounts in account history and define a daily net-worth source.
  The existing `net_worth_snapshots` table is monthly and uses `snapshot_month`, `assets`, and `liabilities`.
- Use Plaid's `transaction_ids`, `account_id`, and `predicted_next_date` for recurring streams before any heuristic matcher.
- Replace category-keyed budget overrides with `budget_id`-keyed periods so renames and household-shared budgets remain correct.
- Reuse existing `rollover_enabled`, `sinking_funds`, saved ledger views, receipt scanning, household sharing, notification preferences, and settings modules.
- Make goal funding auditable and non-overallocating instead of treating a live account balance as an unbounded allocation.
- Split investments into holdings/allocation and true performance work.
  Normalizing portfolio balance snapshots is not investment performance because deposits and withdrawals distort it.
- Add saved report definitions, responsive Sankey behavior, and an explicit deficit flow.
- Preserve the current Monitor, Plan, and Wealth capabilities until every use case is represented in the new pages.
- Add a migration for manual transactions.
  `transactions.account_id` currently has a non-null foreign key to `accounts`, so a `manual_accounts` id cannot be inserted there.
- Add copyright, accessibility, financial-education, observability, backfill, and rollout requirements.

## Global Constraints

These apply to every task in every phase.

- Preserve every security invariant in `CLAUDE.md`: RLS on all user tables, service-client queries always filter `user_id`, nonce-based CSP (no new external script/img hosts), MFA enforcement untouched.
- Use original FundFlow copy, icons, illustrations, and goal imagery.
  The screenshots are behavioral references, not assets or a pixel-copy license.
- Amount sign follows Plaid: positive = money out, negative = money in.
- Dates are `YYYY-MM-DD` strings end to end; month keys are `YYYY-MM` via `monthKey()` in `lib/dashboard.ts`.
- Every financial total consumes the canonical Phase 0 projection.
  No page may apply `EXCLUDED_PFC`, refund netting, splits, merchant rules, or category overrides independently.
- Every page accepts a canonical `FinancialScope` of `mine` or `household`.
  Service-client work always receives an explicit owner `userId`, and household reads use the existing RLS-bound cookie client.
- Charts are server-rendered SVG in `components/charts/`, geometry in `lib/chart-utils.ts`, colors only from `--viz-*` tokens, max 6 hues then `foldTail` into "Other", every chart ships a table twin.
- Every chart, table, dialog, wizard, and interactive control meets WCAG 2.2 AA keyboard, focus, name, contrast, reduced-motion, and screen-reader requirements.
- Responsive E2E acceptance runs at 1440x900, 768x1024, and 390x844 in both light and dark themes.
- Plaid-call frugality: no new Plaid calls in the 2-minute auto-refresh path; new Plaid fetches ride the daily cron or explicit user refresh.
- Plaid-synced collections use mark-and-sweep semantics.
  Rows missing from a successful full holdings or recurring response are deactivated, never left current forever.
- Migrations go in `supabase/migrations/` and are applied manually via Supabase CLI or dashboard; code reading a new column must land after the migration is applied to the live project.
- Every migration has a forward compatibility period, a data backfill, a verification query, and a rollback or roll-forward note in its phase PR.
- New user-owned tables require owner and household RLS tests as applicable, authenticated grants, indexes for every page query, and takeout/backup/delete-account coverage.
- Route handlers: `requireUser()` -> early-return `NextResponse` -> rate limit where sensitive -> `badRequest()` validation -> work -> `writeAudit()` -> JSON, wrapped in `errorResponse(context, error)`.
- Server pages use the Next.js 16 async `params` and `searchParams` conventions already present in `app/transactions/page.tsx`.
- Before writing code in a phase, read the relevant installed Next.js 16 guide under `node_modules/next/dist/docs/` and follow its current conventions and deprecations.
- Tests: pure logic in `tests/unit/`, route handlers imported directly in `tests/unit/` with mocks, live-RLS verification in `tests/integration/`, and user-journey coverage in `tests/e2e/`.
- Every phase adds loading, empty, partial-data, stale-data, permission-denied, and error-state acceptance cases.
- Every phase instruments bounded counts and safe error codes without logging balances, merchants, account masks, advice answers, or transaction details.
- Feature navigation remains hidden until the page is production-ready.
  Each phase may use a typed server-side feature flag during development, but the PR must remove it or document the rollout flag.
- Commit messages: conventional commits, no co-author lines.
- Run the focused failing test first, then `npm run lint`, `npm run typecheck`, and `npm run test:unit` before every commit.
  Run `npm test`, `npm run build`, and the touched Playwright journeys before every PR.
- The installed Vercel CLI is 56.3.2.
  Upgrade to the latest release before deployment verification with `npm i -g vercel@latest` or `pnpm add -g vercel@latest`.

---

## Part 1: Feature inventory from the screenshots

| Screenshot feature | FundFlow today | Plan |
| --- | --- | --- |
| Sidebar IA (Dashboard, Accounts, Transactions, Cash Flow, Reports, Budget, Recurring, Goals, Investments, Forecasting, Advice) | Monitor/Plan/Wealth dashboard views + Transactions/Goals/Settings | Phase 1 |
| Settings IA: Profile, Display, Notifications, Security, Integrations, Household, Institutions, Categories, Merchants, Rules, Tags, Data | Most capabilities exist as one long Settings page; profile/display and task-based navigation are incomplete | Phase 13 |
| Accounts page: grouped accounts, per-account trend, freshness, assets/liabilities summary, CSV | No accounts page; balances only inside dashboard | Phase 2 |
| Net worth chart with 1-month change | Monthly `net_worth_snapshots` + `WealthView` exist; daily history does not | Phase 2 adds daily account history and preserves monthly history |
| Cash Flow page: monthly/quarterly/yearly bars, income/expense/savings/savings-rate cards, category/group/merchant breakdown bars | Partial pieces in `lib/insights.ts` + `DivergingColumns` | Phase 3 |
| Budget page: Fixed/Flexible/Non-Monthly groups, planned/actual/remaining, Left to Budget, budget seeding, contributions | Flat per-category envelopes (`budgets` table + `BudgetsSection`) | Phase 4 |
| Recurring page: monthly upcoming/complete, paid progress, new-merchant review badge, calendar, manage | `recurring_streams` synced; `BillCalendar`; `manual_recurring_items` | Phase 5 |
| Reports page: Sankey (income -> groups -> categories), filters, summary stats, saved reports, transactions, CSV | Weekly PDF report only | Phase 6 |
| Goals: wizard (select/targets/contribution/budget), goal images, account-linked funding, at-risk badges, save-up vs pay-down | Basic goals CRUD with manual `saved_amount` | Phase 7 |
| Dashboard: customizable widget grid (budget, spending vs last month, net worth, transactions, recurring, goals, investments) | Fixed Monitor/Plan/Wealth views, `DashboardPrefsSection` | Phase 8 |
| Investments: holdings, allocation, account filter, manual holdings, top movers, cash-flow-adjusted performance, optional benchmarks | Nothing (Plaid `transactions` only) | Phase 9A and Phase 9B |
| Forecasting page | `WhatIfPanel` what-if exists | Phase 10 |
| Advice: recommendations, task checklists, categories, priorities | Nothing | Phase 11 |
| Transactions: add-manual-transaction modal, day totals, columns picker, goal link, receipt inbox | Ledger with edit/annotate/split/refund/bulk tag and a Settings receipt scanner | Phase 12 |
| Dark mode | Done (`ThemeToggle`, token system) | No work |
| AI Assistant nav entry | Ask-AI section in Settings behind double consent | Phase 1 (nav link only, same gating) |
| Credit score widget | Nothing | Excluded (see below) |
| Receipts tab and transaction linking | Receipt parser exists only in Settings | Phase 12 |
| Free trial / billing, Invite a friend, Retail Sync | N/A | Excluded (see below) |

### Explicit exclusions (decisions, flagged for review)

- **Credit score:** FundFlow has no consented bureau integration, dispute workflow, retention policy, or operational need to store this sensitive data.
  Excluded from this program.
  If wanted later, a manual-entry score widget is a small standalone task.
- **Billing/free trial and referrals:** FundFlow is personal software with no billing.
  Excluded permanently.
- **Retail Sync:** Amazon-style order sync is not implementable robustly without an authorized data source.
  Excluded until a supported integration exists.
- **Receipts:** not excluded.
  Phase 12 promotes the existing `ReceiptScanSection` into a transaction-linked receipt inbox without adding a new AI consent path.
- **In-app AI Assistant page:** FundFlow's privacy stance is CSV-export-first, with the existing opt-in Ask-AI.
  The plan only adds a sidebar link to the existing consent-gated section, not a new chat surface.
- **Benchmark overlays (S&P 500, US stocks, US bonds):** requires an external market-data feed with clear licensing, retention, and rate limits.
  Phase 9B defines the provider-neutral interface and keeps the UI hidden until a real source is provisioned and validated.

If any exclusion is wrong, say so before the affected phase starts; nothing else depends on them.

### Phase ordering and dependencies

```text
Phase 0 (canonical finance semantics and rollout foundation)
  └──► Phase 1 (shell and IA)
        ├──► Phase 2 (Accounts) ──► Phase 8 (Dashboard widgets)
        │                           └──► Phase 10 (Forecasting)
        ├──► Phase 3 (Cash Flow) ──► Phase 6 (Reports/Sankey)
        ├──► Phase 4 (Budget) ──► Phase 7 (Goals and contribution ledger)
        ├──► Phase 5 (Recurring)
        ├──► Phase 9A (Investment holdings/allocation)
        │     └──► Phase 9B (Investment performance/benchmarks)
        ├──► Phase 11 (Advice)
        ├──► Phase 12 (Transactions and receipts)
        └──► Phase 13 (Settings IA and profile)
```

Phases 3, 4, 5 are independent of each other and can run in any order after Phase 1.

---

## Phase 0: Canonical finance semantics and rollout foundation

**Branch:** `feat/finance-domain-foundation`

**Files:**

- Create: `lib/finance-domain.ts`, `lib/financial-scope.ts`, `lib/finance-query.ts`, `lib/feature-flags.ts`
- Modify: `lib/dashboard.ts` to consume the canonical projection without changing rendered output
- Test: `tests/unit/finance-domain.test.ts`, `tests/unit/financial-scope.test.ts`, `tests/unit/dashboard-finance-parity.test.ts`, `tests/integration/household-finance-scope.test.ts`

**Interfaces:**

```ts
export type FinancialScope =
  | { kind: "mine"; ownerUserId: string }
  | { kind: "household"; householdId: string };

export interface RawFinanceTransaction {
  id: string;
  providerTransactionId: string;
  userId: string;
  accountId: string | null;
  manualAccountId: string | null;
  date: string;
  amount: number;
  merchant: string | null;
  name: string | null;
  pfcPrimary: string | null;
  pfcDetailed: string | null;
  pending: boolean;
  source: "plaid" | "import" | "manual";
}

export interface CanonicalFinanceTransaction {
  id: string;
  date: string;
  signedAmount: number;
  flow: "income" | "expense" | "transfer";
  merchant: string;
  groupKey: string;
  categoryKey: string;
  accountId: string | null;
  manualAccountId: string | null;
  pending: boolean;
  source: "plaid" | "import" | "manual";
}

export function projectFinanceTransactions(input: {
  rows: RawFinanceTransaction[];
  merchantRules: MerchantRule[];
  categoryOverrides: CategoryOverride[];
  splits: TransactionSplit[];
  linkedRefunds: LinkedRefund[];
}): CanonicalFinanceTransaction[];

export function financeTotals(
  rows: CanonicalFinanceTransaction[],
): { income: number; expenses: number; net: number; count: number };
```

**Pending semantics (canonical decision):** pending rows are included in every default total, matching the current dashboard behavior, which does not filter on `pending`.
Consumers that offer a pending toggle (the Reports saved-filter in Phase 6, the Pending column in Phase 12) filter through a shared `excludePending` option on the projection query helpers rather than post-filtering rows themselves.

**Steps:**

- [x] Write a fixture with a paycheck, ordinary expense, credit-card payment, refund pair, split transaction, imported transaction, manual transaction, merchant rename, category override, pending row, and household-shared row.
- [x] Write failing parity tests asserting the same income, expense, savings, merchant, group, and category totals for dashboard, budget, cash flow, reports, and exports.
- [x] Implement `projectFinanceTransactions` in the existing application order: source normalization, merchant rules, category override, split expansion, refund netting, transfer exclusion, and stable sorting.
- [x] Add an adapter for the current schema that derives `source` from the existing `plaid_transaction_id` prefixes and sets `manualAccountId` to null.
  Phase 12 replaces that adapter field with the explicit source and manual-account columns after its migration lands.
- [x] Export the shared row types instead of creating private `TxnLite` variants in later phases.
- [x] Implement `FinancialScope` parsing and URL serialization.
  Reject household ids that are not visible through the existing RLS-bound household query.
- [x] Add `finance-query.ts` helpers that select only required columns, paginate all-time reads in stable `(date,id)` order, and enforce an explicit upper bound per request.
- [x] Replace dashboard-local aggregation with the projection and prove its existing unit fixtures render unchanged.
- [x] Add a typed feature-flag registry for unreleased pages.
  Flags are evaluated on the server and never weaken auth or RLS.
- [x] Update takeout, encrypted backup, delete-account coverage, and `scripts/check-rls.sql` templates so every later phase has a checklist slot.
- [x] Run the full gate and commit `refactor(finance): establish canonical transaction semantics`.

**E2E check:** With the same seeded dataset, dashboard totals and the privacy-safe CSV totals remain unchanged before and after the refactor, and Mine versus Household scope never exposes an unshared connection.

### Phase 0 implementation notes (shipped 2026-07-29, branch `feat/finance-domain-foundation`)

Four decisions differ from the interfaces sketched above; later phases should code against these.

- `CanonicalFinanceTransaction` gained `sourceTransactionId`.
  Split expansion has to yield unique `id`s, so `id` is unique per projected row (`<txnId>::<n>` for split parts) and `sourceTransactionId` is the `transactions.id` to link back to.
- `ProjectFinanceInput` gained an optional `accountNames` map.
  Merchant rules support `matchType: "account"`, which cannot be evaluated without account names.
- The dashboard passes `splits: []` on purpose.
  It distributes splits downstream over active-month spend only (`aggregateSpendWithSplits` plus the drilldown), so handing them to the projection as well would apply them twice.
  New pages have no legacy split path and should pass real splits.
- `flow: "transfer"` carries both meanings of "moved but not spend or income": a `TRANSFER_GROUPS` category, and either half of a linked refund pair.
  Cash-flow views ignore `flow` and read `signedAmount` with the account type.

`EXCLUDED_PFC` in `lib/dashboard.ts` is now an alias of `TRANSFER_GROUPS`, so the four existing consumers keep working against one definition.
`fromTransactionRow` tolerates a missing `plaid_transaction_id` (falls back to `source: "plaid"`) so a narrower column selection cannot crash a page.

Gate at completion: eslint clean, `tsc --noEmit` clean, 801 unit tests passing across 114 files, `npm run build` compiled successfully.

---

## Phase 1: Navigation and information architecture

**Branch:** `feat/planner-ia`

**Files:**

- Modify: `components/shell/AppSidebar.tsx` (nav items)
- Modify: `components/shell/TopBar.tsx`, `components/CommandPalette.tsx`, `components/shell/AppShell.tsx`
- Test: `tests/unit/sidebar-nav.test.ts`, `tests/unit/command-palette.test.ts`, existing shell accessibility tests

**Interfaces:**

- Produces: `NAV_ITEMS` export from a new `components/shell/nav-model.ts` with keys `dashboard | accounts | transactions | cashflow | reports | budget | recurring | goals | investments | forecasting | advice`.
- Produces: `UTILITY_ITEMS` with Search, Notifications, Settings, privacy blur, and sidebar collapse actions.
- A nav item is visible only when its route is already implemented or its server-side feature flag is enabled for review.

**Steps:**

- [ ] Extract the navigation model and write a failing test for order, absolute hrefs, unique keys, implemented-route visibility, mobile inclusion, and command-palette parity.
- [ ] Keep `proxy.ts` behavior unchanged.
  Add one regression test proving an arbitrary new non-public page path redirects to `/login`, which is the existing default-deny behavior.
- [ ] Add the screenshot's utility actions to `TopBar`: global search opens the existing command palette, notification icon links to `/notifications` with unread count, Settings links to `/settings`, privacy blur remains available, and the sidebar collapse choice persists in `profiles.dashboard_prefs`.
- [ ] Add a lower-rail Ask-AI link only when the existing AI setting and double-consent requirements are satisfied.
  The link opens the current consent-gated surface and does not create a new chat or data path.
- [ ] Convert Monitor, Plan, and Wealth from top-level nav entries into dashboard subviews reachable from a compact Overview menu.
  Do not delete their routes or components.
- [ ] Move "Year in Money" under Reports (link from the Reports page) and remove it from the top-level nav to match the target IA; keep `/wrapped` route working.
- [ ] Run lint, typecheck, unit tests, and `npm run build`; commit `feat(nav): add planner information architecture`.

**E2E check:** Sign in, verify only implemented destinations appear, use each utility action with keyboard only, collapse and restore the sidebar, check the mobile navigation at 390px, and confirm a signed-out request to a new private path redirects to login.

---

## Phase 2: Accounts page + per-account balance history

**Branch:** `feat/accounts-page`

### Migration `supabase/migrations/<ts>_account_snapshots.sql`

```sql
create table public.account_balance_snapshots (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  account_id       uuid references public.accounts (id) on delete cascade,
  manual_account_id uuid references public.manual_accounts (id) on delete cascade,
  snapshot_date    date not null,
  current_balance  numeric(14, 2),
  available_balance numeric(14, 2),
  created_at       timestamptz not null default now(),
  check ((account_id is null) <> (manual_account_id is null))
);

create index account_balance_snapshots_user_date_idx
  on public.account_balance_snapshots (user_id, snapshot_date);
create unique index account_balance_snapshots_plaid_day_uidx
  on public.account_balance_snapshots (account_id, snapshot_date)
  where account_id is not null;
create unique index account_balance_snapshots_manual_day_uidx
  on public.account_balance_snapshots (manual_account_id, snapshot_date)
  where manual_account_id is not null;

alter table public.account_balance_snapshots enable row level security;

create policy "abs_select_own" on public.account_balance_snapshots
  for select using (user_id = (select auth.uid()));
create policy "abs_select_shared_account" on public.account_balance_snapshots
  for select using (
    account_id is not null
    and exists (
      select 1 from public.accounts a
      where a.id = account_balance_snapshots.account_id
    )
  );
-- All snapshot writes (Plaid cron and manual-account balance edits) go through
-- the service client with an explicit user_id; there are deliberately no
-- insert/update policies, so the cookie client cannot write history.
```

**Files:**

- Create: `lib/account-history.ts`, `lib/accounts-page.ts`, `components/accounts/AccountGroup.tsx`, `components/accounts/AccountRow.tsx`, `components/accounts/AccountsFilters.tsx`, `components/accounts/SummaryPanel.tsx`, `app/accounts/page.tsx`, `app/api/manual-accounts/route.ts`, `app/api/export/accounts-csv/route.ts`
- Modify: `components/settings/ManualAccountsSection.tsx`, `lib/net-worth.ts`, `app/api/cron/sync/route.ts`, `app/api/cron/backup/route.ts`, `app/api/export/takeout/route.ts`, `app/api/account/route.ts`, `lib/demo-data.ts`
- Test: `tests/unit/account-history.test.ts`, `tests/unit/accounts-page.test.ts`, `tests/unit/accounts-csv-route.test.ts`, `tests/integration/account-snapshot-rls.test.ts`, `tests/e2e/accounts.spec.ts`

**Interfaces:**

- Produces from `lib/accounts-page.ts`:

```ts
export type AccountGroupKey = "credit" | "cash" | "investment" | "loan" | "other";

export interface AccountsPageRow {
  id: string;
  source: "plaid" | "manual";
  name: string;            // display name + mask, e.g. "Freedom (...0325)"
  type: string | null;
  subtype: string | null;
  balance: number;         // display sign: liabilities positive within their group
  currency: string;
  institution: string | null;
  updatedAgo: string;      // humanized from accounts.updated_at, e.g. "9 hours ago"
  spark: number[];         // last 30 snapshot balances, oldest first, [] if none
  monthChange: { amount: number; pct: number } | null;
}

export interface AccountsPageData {
  groups: Record<AccountGroupKey, { label: string; total: number; monthChange: { amount: number; pct: number } | null; rows: AccountsPageRow[] }>;
  summary: {
    assetsTotal: number;
    liabilitiesTotal: number;
    assetBuckets: { label: string; amount: number }[];      // Cash, Investments, ...
    liabilityBuckets: { label: string; amount: number }[];  // Credit Cards, Loans, ...
    netWorth: number;
    netWorthSeries: { date: string; value: number }[];       // from daily account snapshots
    netWorthMonthChange: { amount: number; pct: number } | null;
  };
}

export function groupKeyFor(type: string | null, subtype: string | null): AccountGroupKey;
export function buildAccountsPageData(
  accounts: UnifiedAccountSummary[],
  snapshots: AccountBalanceSnapshot[],
  now: Date,
): AccountsPageData;

export function shapeDailyAccountSnapshots(input: {
  userId: string;
  plaidAccounts: AccountRow[];
  manualAccounts: ManualAccountRow[];
  snapshotDate: string;
}): AccountBalanceSnapshotInsert[];
```

**Steps:**

- [ ] Write the migration, grant authenticated select, add owner and household RLS tests, add snapshot tables to takeout/backup/deletion, and include verification SQL for duplicate and cross-user rows.
- [ ] TDD `shapeDailyAccountSnapshots` for Plaid and manual accounts, null balances, explicit owner ids, same-day reruns, and currency.
- [ ] Extend the post-sync snapshot writer to upsert every current account after a successful user sync.
  Use the two partial unique indexes as conflict targets through separate Plaid and manual upserts.
- [ ] Move manual-account create, balance update, and delete mutations from direct browser writes into `app/api/manual-accounts/route.ts`.
  Require the user, validate ownership and amounts, write an audit event, and upsert a balance snapshot after each successful create or balance change so the chart does not wait for the next cron.
  The snapshot upsert uses the service client with the authenticated user's id, because the snapshot table intentionally has no client insert policy.
- [ ] Keep the existing monthly `net_worth_snapshots` writer for compatibility.
  Derive the new daily net-worth chart by summing daily account snapshots with liability sign rules, and never invent historical days during initial backfill.
- [ ] TDD `buildAccountsPageData`: cover Plaid and manual grouping, assets and liabilities, null and stale balances, first-available versus latest month-change math, divide-by-zero percent change, account freshness, household-shared accounts, and currency mismatch.
- [ ] Build the page with a net-worth chart, Performance and range selectors, grouped collapsible accounts, per-account sparklines, freshness, and summary Totals/Percent tabs.
  Add filters for institution, account type, hidden state, and owner when Household scope is active.
- [ ] Add account visibility and ordering preferences to `profiles.dashboard_prefs`.
  Do not treat hidden accounts as excluded from net worth unless the user explicitly changes `include_in_net_worth`.
- [ ] Add `/api/export/accounts-csv`: `requireUser`, build CSV via `lib/csv.ts` with columns `group,name,subtype,balance,as_of`, `writeAudit("export.accounts_csv")`; integration test asserts auth 401 and formula-injection neutralization on a crafted account name.
- [ ] Wire "Refresh all" to the existing `/api/plaid/sync` manual path and "Add account" to the existing `ConnectBankButton`.
- [ ] Add a one-time current-state snapshot backfill command that is idempotent and clearly reports that earlier history is unavailable.
- [ ] Run all gates and commit `feat(accounts): accounts page with daily balance history`.

**E2E check:** With demo data, Plaid and manual accounts render in the correct groups, totals reconcile with dashboard net worth, Mine and Household scopes isolate correctly, the summary toggle flips between dollars and percent, Refresh all updates freshness, and the CSV opens without formula execution.

---

## Phase 3: Cash Flow page

**Branch:** `feat/cash-flow-page`

**Files:**

- Create: `lib/cash-flow.ts`, `components/cash-flow/PeriodBars.tsx` (wraps `DivergingColumns` + savings line overlay), `components/cash-flow/BreakdownBars.tsx`, `app/cash-flow/page.tsx`
- Test: `tests/unit/cash-flow.test.ts`, `tests/e2e/cash-flow.spec.ts`

**Interfaces:**

```ts
export type CashFlowPeriod = "monthly" | "quarterly" | "yearly";

export interface PeriodCashFlow {
  key: string;               // "2026-07" | "2026-Q3" | "2026"
  label: string;             // "Jul", "Q3", "2026"
  income: number;            // positive dollars in
  expenses: number;          // positive dollars out from canonical projection
  savings: number;           // income - expenses
  savingsRate: number;       // savings / income, 0 when income is 0
}

export interface BreakdownRow { label: string; amount: number; pct: number; icon?: string }

export function computePeriodCashFlow(
  txns: CanonicalFinanceTransaction[],
  period: CashFlowPeriod,
): PeriodCashFlow[];
export function breakdownBy(
  txns: CanonicalFinanceTransaction[],
  dimension: "category" | "group" | "merchant",
  direction: "income" | "expense",
): BreakdownRow[];   // sorted desc, pct of direction total
```

`groupKey` and `categoryKey` come from the canonical Phase 0 projection.
Cash Flow never reads raw Plaid PFC fields directly.

**Steps:**

- [ ] TDD `computePeriodCashFlow`: month, quarter, and year bucketing, savings-rate zero-income guard, negative-savings handling, partial periods, leap years, stable ascending order, and currency mismatch.
- [ ] TDD `breakdownBy`: category, group, and merchant grouping, income versus expense, Unknown labels, zero totals, percent reconciliation, and `foldTail` only in the chart adapter while the table retains every row.
- [ ] Add a bounded cash-flow query that pages at most 24 months for the interactive chart.
  Add a separate paginated all-time path for Reports rather than reusing the dashboard's six-month query.
- [ ] Page layout: period toggle via async search params, date window, Mine/Household scope, selected-period cards, Income and Expenses breakdowns, and a cumulative savings line.
- [ ] Each chart gets its table twin (existing pattern) and the savings line renders as a `path` overlay on the diverging columns using `--viz-*` ink token.
- [ ] Add a reconciliation assertion to the demo fixture so selected-period Income, Expenses, Savings, and Savings Rate equal Phase 0 totals and the same period in Budget and Reports.
- [ ] Run all gates and commit `feat(cash-flow): add reconciled cash flow analysis`.

**E2E check:** July 2026 demo numbers match Budget, Dashboard, and Reports for the same scope and date range, and toggling period, dimension, and scope updates the URL without hydration errors.

---

## Phase 4: Budget page

**Branch:** `feat/budget-page`

### Migration `<ts>_budget_groups.sql`

```sql
alter table public.budgets
  add column group_name text not null default 'flexible'
    check (group_name in ('income', 'fixed', 'flexible', 'non_monthly')),
  add column sort_order int not null default 0;

create table public.budget_periods (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  budget_id  uuid not null references public.budgets (id) on delete cascade,
  month      date not null check (month = date_trunc('month', month)::date),
  planned    numeric(14, 2) not null check (planned >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (budget_id, month)
);

create index budget_periods_user_month_idx
  on public.budget_periods (user_id, month);
create trigger budget_periods_set_updated_at
  before update on public.budget_periods
  for each row execute function public.set_updated_at();

alter table public.budget_periods enable row level security;
create policy "budget_periods_all_own" on public.budget_periods
  for all using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy "budget_periods_select_household" on public.budget_periods
  for select using (
    exists (
      select 1 from public.budgets b
      where b.id = budget_periods.budget_id
        and b.household_id is not null
        and public.is_household_member(b.household_id)
    )
  );
```

`budgets` already has `rollover_enabled` and optional `household_id`.
The new period table references a stable budget id so category renames do not orphan history.

**Files:**

- Create: `lib/budget-page.ts`, `app/api/budget/route.ts` (PUT planned amounts + group assignment), `components/budget/BudgetTable.tsx`, `components/budget/BudgetSummary.tsx`, `components/budget/SeedBudgetButton.tsx`
- Create: `app/budget/page.tsx`
- Modify: `components/settings/BudgetsSection.tsx` (link out to the new page, keep as the simple editor)
- Test: `tests/unit/budget-page.test.ts`, `tests/integration/budget-route.test.ts`

**Interfaces:**

```ts
export interface BudgetLine {
  budgetId: string | null;
  category: string;          // PFC detailed or override category
  label: string;
  planned: number;           // override for the month, else budgets.monthly_limit, else 0
  actual: number;            // canonical spend or income for this month
  remaining: number;         // planned - actual (income: actual - planned)
  budgeted: boolean;         // false => shown under "Show N unbudgeted"
}

export interface BudgetSection {
  key: "income" | "fixed" | "flexible" | "non_monthly";
  label: string;
  planned: number; actual: number; remaining: number;
  lines: BudgetLine[];
  unbudgetedCount: number;
}

export interface BudgetPageData {
  month: string;                       // "2026-07"
  sections: BudgetSection[];
  totalIncome: { planned: number; actual: number };
  totalExpenses: { planned: number; actual: number; remaining: number };
  contributions: { goals: { name: string; planned: number; actual: number }[] };
  leftToBudget: number;                // income planned - expense planned - contributions planned
}

export function buildBudgetPage(input: {
  month: string;
  budgets: { id: string; category: string; monthly_limit: number; group_name: string; rollover_enabled: boolean }[];
  periods: { budget_id: string; month: string; planned: number }[];
  txns: CanonicalFinanceTransaction[];
  sinkingFunds: SinkingFundPlan[];
  goalContributions: { name: string; planned: number; actual: number }[];
}): BudgetPageData;

export function proposeBudgetFromHistory(input: {
  txnsLast3Months: CanonicalFinanceTransaction[];
  recurringTransactionIds: Set<string>;
  sinkingFunds: SinkingFundPlan[];
}): BudgetSeedProposal;
```

**Steps:**

- [ ] Write the migration with authenticated grants, owner and household RLS tests, takeout/backup/delete coverage, and a backfill that leaves existing `monthly_limit` rows as defaults.
- [ ] TDD `buildBudgetPage`: period override versus monthly default, rollover carry, income sign, expense and income remaining math, unbudgeted rows, section totals, sinking-fund allocation, and Left to Budget with contribution events.
- [ ] TDD `proposeBudgetFromHistory`.
  Classify Fixed only when the category's identified recurring occurrences dominate its trailing spend, use existing sinking funds for Non-Monthly, keep mixed categories Flexible, round suggested amounts deterministically, and return confidence plus explanation for every proposal.
- [ ] Add a preview and confirmation step for "Create my budget".
  Never write suggestions until the user reviews section, amount, rollover, and skipped existing budgets.
- [ ] `PUT /api/budget` accepts a stable `budget_id`, month, planned amount, group, rollover, and sort order.
  Validate ownership and household write rules, use date-first-of-month storage, reject negatives, and audit the changed fields without amounts.
- [ ] Build Month, Year, and Decade URL-driven views.
  Month supports inline edits, Year shows monthly planned/actual/remaining, and Decade shows annual rollups only for years with data.
- [ ] Build Income, Fixed, Flexible, Non-Monthly, and Contributions sections, collapsed unbudgeted rows, optimistic edits with rollback, and the right-hand Summary/Income/Expenses tabs.
- [ ] Reuse `rollover_enabled` and `sinking_funds`.
  Do not create a second rollover or non-monthly planning model.
- [ ] Phase 7 later supplies goal contribution events.
  Until then, render the tested empty state without inventing Actual contributions from balance changes.
- [ ] Run all gates and commit `feat(budget): add period budgets and planner views`.

**E2E check:** Preview and accept a budget from demo history, edit a period amount, move a category, enable rollover, navigate Month/Year/Decade, and verify Actual and Left to Budget reconcile with Cash Flow under the same scope.

---

## Phase 5: Recurring page

**Branch:** `feat/recurring-page`

### Migration `<ts>_recurring_review.sql`

```sql
alter table public.recurring_streams
  add column reviewed_at timestamptz,
  add column dismissed_at timestamptz,
  add column account_id uuid references public.accounts (id) on delete set null,
  add column first_date date,
  add column last_date date,
  add column predicted_next_date date,
  add column user_amount numeric(14, 2);   -- user-corrected expected amount

create table public.recurring_stream_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  recurring_stream_id uuid not null references public.recurring_streams (id) on delete cascade,
  transaction_id uuid not null references public.transactions (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (recurring_stream_id, transaction_id)
);

create index recurring_stream_transactions_user_idx
  on public.recurring_stream_transactions (user_id);
alter table public.recurring_stream_transactions enable row level security;
create policy "rst_select_own" on public.recurring_stream_transactions
  for select using (user_id = (select auth.uid()));
create policy "rst_select_shared_stream" on public.recurring_stream_transactions
  for select using (
    exists (
      select 1 from public.recurring_streams rs
      where rs.id = recurring_stream_transactions.recurring_stream_id
    )
  );
```

**Files:**

- Create: `lib/recurring-page.ts`, `app/recurring/page.tsx`, `app/api/recurring/route.ts` (PATCH review/dismiss/amount), `components/recurring/RecurringList.tsx`, `components/recurring/ReviewBanner.tsx`, `components/recurring/MonthSummary.tsx`
- Modify: `lib/recurring.ts` (persist Plaid occurrence fields and transaction joins), `components/shell/AppSidebar.tsx` (badge count of unreviewed streams)
- Test: `tests/unit/recurring-page.test.ts`, `tests/integration/recurring-route.test.ts`

**Interfaces:**

```ts
export interface RecurringOccurrence {
  source: "plaid" | "manual";
  sourceId: string;
  merchant: string;
  frequency: string;               // "Every month", "Every week"
  dueDate: string;                 // YYYY-MM-DD within the viewed month
  account: string | null;
  category: string | null;
  amount: number;                  // user_amount ?? average_amount
  status: "upcoming" | "overdue" | "complete";
  matchedTransactionId: string | null;
  isIncome: boolean;
}

export interface RecurringMonth {
  month: string;
  occurrences: RecurringOccurrence[];        // sorted by dueDate
  totals: {
    income: { paid: number; remaining: number };
    expenses: { paid: number; remaining: number };
    creditCards: { paid: number; remaining: number };  // occurrences on credit-type accounts
  };
  reviewCount: number;             // active MATURE streams with reviewed_at is null
}

export function expandStreamsForMonth(
  streams: RecurringStreamWithTransactions[],
  manualItems: ManualRecurringItem[],
  month: string,
  today: string,
): RecurringMonth;
// Plaid occurrences anchor on predicted_next_date, first_date, last_date, and frequency.
// Linked Plaid transaction ids determine completion.
// Manual items expand from next_date and use a documented fallback matcher.
```

**Steps:**

- [ ] Write the migration, grants, indexes, RLS tests, takeout/backup/delete coverage, and a backfill that preserves existing streams with unknown account and occurrence history.
- [ ] Extend `mapStreamRow` to resolve Plaid `account_id` to the local account and persist `first_date`, `last_date`, `predicted_next_date`, frequency, status, and current activity.
- [ ] After upserting streams, resolve Plaid `transaction_ids` to local transaction rows and replace the stream's join rows inside a successful refresh.
  Missing older transaction ids are counted safely and do not fail the refresh.
- [ ] Mark streams absent from a successful full response inactive after the upsert.
  Never mark rows inactive after a failed or partial Plaid call.
- [ ] TDD occurrence expansion for weekly, biweekly, semi-monthly, monthly, and annual frequencies, month boundaries, leap days, predicted-date anchors, linked-transaction completion, overdue versus upcoming, dismissed streams, early-detection streams, manual items, and bucket totals.
- [ ] Use heuristic matching only for `manual_recurring_items`, with normalized merchant, amount tolerance, account when known, and a one-occurrence-per-transaction rule.
- [ ] `PATCH /api/recurring` accepts review, dismiss, restore, amount correction, and manual-item CRUD actions.
  Validate ownership, preserve Plaid-provided raw values, and audit metadata without merchant or amount.
- [ ] Page: Monthly tab with scope, month navigation, filters, list/calendar toggle, Income/Expenses/Credit-cards progress, Upcoming, Complete, and totals.
  All recurring shows active, early, dismissed, and manual streams with Manage controls.
- [ ] Review flow: orange banner "There is N new recurring merchant(s) for you to review" -> panel listing unreviewed streams with Confirm (sets `reviewed_at`) / Not recurring (sets `dismissed_at`); sidebar badge count next to Recurring.
- [ ] Add unread badge tests so only active unreviewed mature streams count and household-shared streams do not create owner-action badges for another member.
- [ ] Run all gates and commit `feat(recurring): add occurrence and review workflows`.

**E2E check:** demo streams appear in the right sections, marking one reviewed clears the badge, editing an amount changes the monthly total.

---

## Phase 6: Reports page with Sankey

**Branch:** `feat/reports-sankey`

### Migration `<ts>_saved_reports.sql`

```sql
create table public.saved_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  report_type text not null check (report_type in ('cash_flow', 'spending', 'income')),
  filters jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);
create index saved_reports_user_idx on public.saved_reports (user_id, updated_at desc);
create trigger saved_reports_set_updated_at
  before update on public.saved_reports
  for each row execute function public.set_updated_at();
alter table public.saved_reports enable row level security;
create policy "saved_reports_all_own" on public.saved_reports
  for all using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
```

**Files:**

- Create: `lib/sankey.ts` (pure layout), `components/charts/SankeyChart.tsx`, `lib/reports.ts`, `app/reports/page.tsx`, `app/api/reports/saved/route.ts`, `app/api/export/report-csv/route.ts`
- Modify: `lib/chart-utils.ts` only if shared helpers are needed (keep sankey math in its own module; chart-utils is already dense)
- Test: `tests/unit/sankey.test.ts`, `tests/unit/reports.test.ts`

**Interfaces:**

```ts
// lib/sankey.ts
export interface SankeyNode { id: string; label: string; value: number; column: number }
export interface SankeyLink { source: string; target: string; value: number }
export interface PositionedNode extends SankeyNode { x: number; y: number; height: number }
export interface PositionedLink extends SankeyLink { path: string }  // SVG cubic path

export function layoutSankey(
  nodes: SankeyNode[], links: SankeyLink[],
  width: number, height: number, nodeWidth: number, nodePadding: number,
): { nodes: PositionedNode[]; links: PositionedLink[] };
```

```ts
// lib/reports.ts
export interface ReportSummary {
  totalTransactions: number;
  largest: number;             // signed row with the largest absolute magnitude
  averageAbsolute: number;     // mean absolute amount of included transactions
  totalIncome: number;
  totalSpending: number;
  firstDate: string | null;
  lastDate: string | null;
}
export function buildCashFlowSankeyData(
  txns: CanonicalFinanceTransaction[],
): { nodes: SankeyNode[]; links: SankeyLink[] };
// Positive net: income categories -> Income -> expense groups + Net Income -> categories.
// Negative net: income categories + Unfunded Spending -> Available Funds -> expense groups -> categories.
// Sankey link values are always non-negative.
export function summarizeTransactions(
  txns: CanonicalFinanceTransaction[],
): ReportSummary;
```

**Steps:**

- [ ] Write the migration with grants, owner RLS, malformed-filter validation tests, takeout/backup/delete coverage, and verification SQL.
- [ ] TDD `layoutSankey`: column positions, proportional heights, minimum visible height, stable ordering, vertical stacking, link geometry, conservation, zero values, and overflow folding.
- [ ] TDD `buildCashFlowSankeyData` and `summarizeTransactions` for positive net income, exact break-even, spending greater than income, refunds, split transactions, Unknown groups, and largest-by-absolute-value behavior.
- [ ] Pre-fold low-value nodes into Other before layout.
  The table twin retains full detail, and the chart never produces negative or crossing-by-random-order links.
- [ ] Make `SankeyChart` responsive with an accessible table-first fallback below 768px.
  Use SVG nodes, paths, labels, descriptions, and fixed visualization tokens without copying screenshot colors.
- [ ] Reports page: date range, filters, Mine/Household scope, Cash Flow/Spending/Income tabs, Breakdown/Trends switch, summary panel, paginated transactions, and CSV.
  Reuse Phase 3 components and Phase 0 projection.
- [ ] Implement saved reports with strict filter-schema versioning.
  Save, rename, load, and delete the date range, scope, tab, breakdown mode, dimensions, accounts, merchants, categories, and pending-row choice.
- [ ] Add `/api/export/report-csv` through the privacy-safe export contract.
  Export the exact filtered row set, record `data_exports`, neutralize spreadsheet formulas, and enforce a bounded page loop.
- [ ] Move the "Year in Money" link here and surface the weekly-PDF download (existing `/api/export/report`) as a "Download PDF report" action.
- [ ] Run all gates and commit `feat(reports): add saved financial report explorer`.

**E2E check:** Sankey totals reconcile with the Cash Flow page for the same range; tab switches and range changes are pure URL navigation.

---

## Phase 7: Goals revamp

**Branch:** `feat/goals-v2`

### Migration `<ts>_goals_v2.sql`

```sql
alter table public.goals
  add column goal_type text not null default 'save_up'
    check (goal_type in ('save_up', 'pay_down')),
  add column image_slug text,                      -- bundled asset key, not a URL
  add column monthly_contribution numeric(14, 2) check (monthly_contribution >= 0),
  add column spending_reduces boolean not null default false,
  add column starting_balance numeric(14, 2),
  add column target_balance numeric(14, 2);

create table public.goal_accounts (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users (id) on delete cascade,
  goal_id             uuid not null references public.goals (id) on delete cascade,
  account_id          uuid not null references public.accounts (id) on delete cascade,
  allocated_amount    numeric(14, 2) check (allocated_amount >= 0),
  use_entire_balance  boolean not null default false,
  created_at          timestamptz not null default now(),
  unique (goal_id, account_id),
  check (
    (use_entire_balance and allocated_amount is null)
    or (not use_entire_balance and allocated_amount > 0)
  )
);

alter table public.goal_accounts enable row level security;
create policy "goal_accounts_all_own" on public.goal_accounts
  for all using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy "goal_accounts_select_shared_goal" on public.goal_accounts
  for select using (
    exists (
      select 1 from public.goals g
      where g.id = goal_accounts.goal_id
    )
  );

create table public.goal_progress_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  goal_id uuid not null references public.goals (id) on delete cascade,
  event_date date not null,
  amount numeric(14, 2) not null,
  event_type text not null check (
    event_type in ('manual_contribution', 'manual_adjustment', 'transaction')
  ),
  transaction_id uuid references public.transactions (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (goal_id, transaction_id)
);
create index goal_progress_events_user_date_idx
  on public.goal_progress_events (user_id, event_date);
alter table public.goal_progress_events enable row level security;
create policy "goal_progress_events_all_own" on public.goal_progress_events
  for all using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy "goal_progress_events_select_shared_goal" on public.goal_progress_events
  for select using (
    exists (
      select 1 from public.goals g
      where g.id = goal_progress_events.goal_id
    )
  );

alter table public.transaction_annotations
  add column goal_id uuid references public.goals (id) on delete set null;
```

**Files:**

- Create: `lib/goals-v2.ts`, `components/goals/GoalWizard.tsx` (multi-step client modal: Select -> Targets -> Contribution -> Budget), `components/goals/GoalCard.tsx`, `app/api/goals/accounts/route.ts`, `public/goals/*.jpg` (8 bundled template images: emergency-fund, down-payment, car, vacation, wedding, education, retirement, savings; source royalty-free, commit locally, no external hosts because of CSP `img-src`)
- Modify: `app/goals/page.tsx`, `components/goals/GoalsManager.tsx`, `lib/goals.ts` (funding-aware progress)
- Test: `tests/unit/goals-v2.test.ts`, `tests/integration/goal-accounts-route.test.ts`

**Interfaces:**

```ts
export interface FundedGoal extends Goal {
  goal_type: "save_up" | "pay_down";
  funded_amount: number;      // manual progress plus valid account allocations and events
  est_monthly: number | null; // remaining / months-to-target, null without target_date
  badge: "on-track" | "at-risk" | "completed" | "behind";
}

export function computeFundedGoals(
  goals: GoalV2Row[],
  links: GoalAccountRow[],
  accounts: { id: string; current_balance: number | null; type: string | null }[],
  today: Date,
): FundedGoal[];
// Save-up goals use capped account allocations plus progress events.
// Pay-down goals use starting_balance - current liability balance.
// At-risk compares trailing contribution pace with required monthly pace.
```

**Steps:**

- [ ] Write the migration with grants, owner and household-aware select policies, takeout/backup/delete coverage, and a backfill that preserves `saved_amount` as existing manual progress.
- [ ] Implement one transactional allocation mutation function.
  It locks all allocations for the affected accounts, prevents multiple entire-balance claims, and rejects total fixed allocations above the latest account balance.
- [ ] TDD `computeFundedGoals`: manual progress, fixed and entire-balance allocations, no double counting, spending-reduces events, pay-down starting balance, zero target, badge matrix, past dates, and trailing contribution pace.
- [ ] Capture `starting_balance` when a pay-down goal links its first liability account.
  Do not recompute the baseline during later syncs.
- [ ] Create eight original FundFlow goal illustrations or licensed local assets with attribution records where required.
  Do not copy or crop the images shown in Monarch.
- [ ] Define `GOAL_TEMPLATES` with slug, default copy, original image, type, and accessible alt text.
  Build Select, Targets, Contribution, and Budget steps with resumable draft state and safe cancellation.
- [ ] Add account allocation, contribution-event, and transaction-goal endpoints with ownership checks on goal, account, and transaction.
  Audit ids and actions without names or amounts.
- [ ] Rework goals page to image cards with progress bars and badges; "Allocate funds" opens the step-3 UI standalone; Pay down tab lists liability accounts not yet goal-linked with the "None of your liability accounts are included" empty state.
- [ ] Feed planned contributions from `goals.monthly_contribution` and actual contributions from `goal_progress_events` into Phase 4.
  Account balance changes alone never count as monthly contributions.
- [ ] Add goal linking to the existing transaction editor as well as the Phase 12 manual-add modal.
  When `spending_reduces` is enabled, a linked expense creates a negative transaction event idempotently.
- [ ] Run all gates and commit `feat(goals): add auditable funded goals`.

**E2E check:** run the wizard end to end against demo data, link the savings account with entire-balance, verify the goal card shows the account balance and the dashboard goals widget matches.

---

## Phase 8: Dashboard widget grid

**Branch:** `feat/dashboard-widgets`

**Files:**

- Create: `lib/dashboard-widgets.ts` (widget registry + prefs schema), `components/dashboard/widgets/BudgetWidget.tsx`, `SpendingCompareWidget.tsx`, `NetWorthWidget.tsx`, `TransactionsWidget.tsx`, `RecurringWidget.tsx`, `GoalsWidget.tsx`, `InvestmentsWidget.tsx`, `components/dashboard/CustomizeDrawer.tsx`, `components/charts/CumulativeCompareChart.tsx`
- Modify: `app/dashboard/page.tsx`, `lib/dashboard.ts` (add `computeCumulativeSpendByDay`), `components/settings/DashboardPrefsSection.tsx` (point at the new prefs), profiles prefs storage (reuse the existing dashboard prefs column that `DashboardPrefsSection` writes; extend its JSON shape, no migration)
- Test: `tests/unit/dashboard-widgets.test.ts`, `tests/unit/cumulative-spend.test.ts`

**Interfaces:**

```ts
export const WIDGET_KEYS = ["budget", "spendingCompare", "netWorth", "transactions", "recurring", "goals", "investments"] as const;
export type WidgetKey = typeof WIDGET_KEYS[number];
export interface DashboardWidgetPrefs { order: WidgetKey[]; hidden: WidgetKey[] }
export function normalizeWidgetPrefs(raw: unknown): DashboardWidgetPrefs;  // tolerates old prefs JSON

export function computeCumulativeSpendByDay(
  txns: CanonicalFinanceTransaction[], month: string, today: string,
): { day: number; thisMonth: number | null; lastMonth: number | null }[];
// Both series align by elapsed day of month.
// Months with fewer days carry their final cumulative value only in the table,
// while the plotted line stops at that month's final day.
```

**Steps:**

- [ ] TDD `normalizeWidgetPrefs` for unknown, duplicate, missing, and legacy keys, and TDD cumulative spend for month lengths, leap years, timezone-safe today, refunds, pending rows, and future-day nulls.
- [ ] `CumulativeCompareChart`: two-line SVG (last month gray ink token, this month accent with area fill), endpoint dot, y-ticks via existing `chart-utils` tick helpers, table twin; renders the Spending widget.
- [ ] Widgets are thin server components composing existing pieces: BudgetWidget = Phase 4 summary meters, TransactionsWidget = `RecentActivity`, RecurringWidget = Phase 5 next-7-days occurrences with paid state, GoalsWidget = Phase 7 cards condensed, NetWorthWidget = existing trend, InvestmentsWidget = Phase 9A totals with "sync another account" empty state until holdings exist.
- [ ] Build a responsive one-column and two-column grid ordered by preferences.
  `CustomizeDrawer` supports show/hide, keyboard-safe up/down ordering, Restore defaults, and optimistic save rollback through the existing dashboard-prefs route.
- [ ] Keep Monitor, Plan, and Wealth available from the dashboard Overview menu for at least one full release.
  Remove a legacy view only after an explicit acceptance checklist proves every action and insight has a destination and bookmarked URLs redirect safely.
- [ ] Add widget-level loading, stale, empty, partial, and error states so one failed query does not blank the dashboard.
- [ ] Add reconciliation tests tying the Spending endpoint, Budget actual, Cash Flow expenses, and transaction list filter to the same canonical total.
- [ ] Run all gates and commit `feat(dashboard): add customizable reconciled widgets`.

**E2E check:** hide a widget, reorder another, reload and confirm persistence; spending-compare endpoint dot equals the month-to-date total shown on Cash Flow.

---

## Phase 9A: Investment holdings and allocation

**Branch:** `feat/investments`

### Migration `<ts>_investments.sql`

```sql
create table public.securities (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid references auth.users (id) on delete cascade,
  plaid_security_id  text,
  ticker             text,
  name               text not null,
  security_type      text,          -- equity | etf | mutual fund | cash | ...
  security_subtype   text,
  close_price        numeric(18, 6),
  close_price_as_of  date,
  iso_currency_code  text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (plaid_security_id is not null or user_id is not null)
);
create unique index securities_plaid_id_uidx
  on public.securities (plaid_security_id)
  where plaid_security_id is not null;
alter table public.securities enable row level security;
create policy "securities_select_visible" on public.securities
  for select using (user_id is null or user_id = (select auth.uid()));
create policy "securities_insert_own" on public.securities
  for insert with check (user_id = (select auth.uid()));
create policy "securities_update_own" on public.securities
  for update using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy "securities_delete_own" on public.securities
  for delete using (user_id = (select auth.uid()));

create table public.holdings (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  account_id         uuid references public.accounts (id) on delete cascade,
  manual_account_id  uuid references public.manual_accounts (id) on delete cascade,
  security_id        uuid not null references public.securities (id) on delete cascade,
  quantity           numeric(18, 6),
  cost_basis         numeric(14, 2),
  institution_price  numeric(18, 6),
  institution_value  numeric(14, 2),
  as_of              date,
  source             text not null check (source in ('plaid', 'manual')),
  is_active          boolean not null default true,
  last_seen_at       timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check ((account_id is null) <> (manual_account_id is null))
);
create unique index holdings_plaid_account_security_uidx
  on public.holdings (account_id, security_id)
  where source = 'plaid';
create unique index holdings_manual_account_security_uidx
  on public.holdings (manual_account_id, security_id)
  where source = 'manual';
alter table public.holdings enable row level security;
create policy "holdings_select_own" on public.holdings
  for select using (user_id = (select auth.uid()));
create policy "holdings_select_shared_account" on public.holdings
  for select using (
    account_id is not null
    and exists (
      select 1 from public.accounts a
      where a.id = holdings.account_id
    )
  );

create table public.holding_snapshots (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  holding_id     uuid not null references public.holdings (id) on delete cascade,
  snapshot_date  date not null,
  quantity       numeric(18, 6),
  price          numeric(18, 6),
  value          numeric(14, 2),
  unique (holding_id, snapshot_date)
);
alter table public.holding_snapshots enable row level security;
create policy "holding_snapshots_select_own" on public.holding_snapshots
  for select using (user_id = (select auth.uid()));
create policy "holding_snapshots_select_shared_holding" on public.holding_snapshots
  for select using (
    exists (
      select 1 from public.holdings h
      where h.id = holding_snapshots.holding_id
    )
  );
```

**Files:**

- Create: `lib/investments.ts`, `lib/investment-sync.ts`, `app/investments/page.tsx`, `app/api/investments/manual/route.ts`, `components/investments/HoldingsTable.tsx`, `components/investments/AllocationView.tsx`, `components/investments/TopMovers.tsx`
- Modify: `app/api/plaid/link-token/route.ts`, `app/api/plaid/webhook/route.ts`, `app/api/cron/sync/route.ts`, `lib/plaid.ts`, `lib/demo-data.ts`, backup/takeout/delete coverage
- Test: `tests/unit/investments.test.ts`, `tests/integration/investments-sync.test.ts` (mocked Plaid client, same pattern as existing sync tests)

**Interfaces:**

```ts
export async function syncInvestmentsForUser(userId: string): Promise<number>;
// Service client.
// Fetches each active item, upserts securities and holdings, snapshots price,
// quantity, and value, then deactivates Plaid holdings absent from a successful
// full response.

export interface HoldingJoinRow {
  id: string;                       // holdings.id
  accountId: string | null;
  manualAccountId: string | null;
  accountName: string;
  securityName: string;
  ticker: string | null;
  securityType: string | null;      // null => grouped under "Unclassified"
  quantity: number | null;
  price: number | null;             // institution_price ?? securities.close_price
  value: number | null;             // institution_value
  source: "plaid" | "manual";
  isActive: boolean;
}

export interface HoldingSnapshotRow {
  holdingId: string;
  snapshotDate: string;             // YYYY-MM-DD
  quantity: number | null;
  price: number | null;
  value: number | null;
}

export interface HoldingRow extends HoldingJoinRow {
  weightPct: number;                // value / portfolio total, 0 when total is 0
  periodChangePct: number | null;   // price change over the selected range, null without history
}

export interface InvestmentsPage {
  total: number;
  dayChange: { amount: number; pct: number } | null;      // vs yesterday's snapshots
  byClass: { label: string; holdings: HoldingRow[]; subtotal: number }[];
  topMovers: { name: string; ticker: string | null; changePct: number }[] | null;
  balanceHistory: { date: string; value: number }[];
}
export function buildInvestmentsPage(
  holdings: HoldingJoinRow[], snapshots: HoldingSnapshotRow[],
): InvestmentsPage;
```

**Steps:**

- [ ] Write the migration with grants, owner and household read tests, manual-security write policy, indexes, takeout/backup/delete coverage, and duplicate verification SQL.
- [ ] TDD `buildInvestmentsPage`: asset classes, account filters, cash equivalents, Unknown fallback, weights, price-based movers, inactive holdings, manual holdings, missing prices, and balance history.
- [ ] Implement item-scoped Plaid holdings sync against the installed Plaid 43 types.
  Join holdings through response `account_id` and `security_id`, persist institution price/value/cost basis, and scope every service query by owner.
- [ ] Use mark-and-sweep only after a successful full response.
  Treat `PRODUCT_NOT_READY`, permission, rate-limit, and no-investment-account outcomes distinctly in `sync_jobs` and retry only retriable errors.
- [ ] Request `Products.Investments` as an optional product for new Items without changing update-mode Link tokens.
  Add explicit regression tests for existing Transactions links.
- [ ] Handle Plaid investment update webhooks by enqueueing or performing a bounded item-scoped holdings refresh after signature verification.
- [ ] Add manual security and holding CRUD for users whose provider does not expose Investments.
  Require name, account, quantity, price, as-of date, and currency, and never claim market freshness for manual values.
- [ ] Page: Holdings and Allocation tabs, account filter, Add Holding, range selector, holdings grouped by asset class, Price/Quantity/Value/Weight/change columns, balance-history chart, and price-based top movers.
- [ ] Increase the daily sync route's explicit `maxDuration` from 60 to 300 seconds and isolate per-user investment failures.
  Keep user concurrency bounded and test that transaction sync still completes when investments fail.
- [ ] Run all gates and commit `feat(investments): add holdings and allocation`.

**E2E check:** Link a Plaid Sandbox Item that exposes investment holdings, run manual sync, and verify holdings render with values that reconcile to its investment account on Accounts.

---

## Phase 9B: Investment performance and benchmark adapter

**Branch:** `feat/investment-performance`

### Migration `<ts>_investment_transactions.sql`

```sql
create table public.investment_transactions (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users (id) on delete cascade,
  account_id             uuid not null references public.accounts (id) on delete cascade,
  security_id            uuid references public.securities (id) on delete set null,
  plaid_investment_transaction_id text not null unique,   -- idempotency key
  date                   date not null,
  name                   text,
  amount                 numeric(14, 2) not null,  -- Plaid sign: positive = money out of the account
  quantity               numeric(18, 6),
  price                  numeric(18, 6),
  fees                   numeric(14, 2),
  txn_type               text,          -- buy | sell | cash | fee | transfer | cancel
  txn_subtype            text,          -- deposit | withdrawal | dividend | contribution | ...
  iso_currency_code      text,
  cancel_plaid_id        text,          -- id of the transaction this row cancels, if any
  is_active              boolean not null default true,   -- mark-and-sweep
  last_seen_at           timestamptz not null default now(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index investment_transactions_user_date_idx
  on public.investment_transactions (user_id, date);
create index investment_transactions_account_date_idx
  on public.investment_transactions (account_id, date);

create trigger investment_transactions_set_updated_at
  before update on public.investment_transactions
  for each row execute function public.set_updated_at();

alter table public.investment_transactions enable row level security;
create policy "invtx_select_own" on public.investment_transactions
  for select using (user_id = (select auth.uid()));
create policy "invtx_select_shared_account" on public.investment_transactions
  for select using (
    exists (
      select 1 from public.accounts a
      where a.id = investment_transactions.account_id
    )
  );
-- Writes go through the service client during sync; no client write policies.
```

External cash flows for time-weighted return are the rows whose `txn_subtype` marks money entering or leaving the account (deposit, withdrawal, contribution, distribution), never buys and sells inside it.
The migration PR also covers grants, owner and household RLS tests, takeout, backup, and delete-account coverage, matching every other user-owned table.

**Files:**

- Create: `lib/investment-performance.ts`, `lib/benchmark-provider.ts`, `components/investments/PerformanceChart.tsx`, `app/api/export/investments-csv/route.ts`
- Modify: `lib/investment-sync.ts`, `app/investments/page.tsx`, `app/api/plaid/webhook/route.ts`, backup/takeout/delete coverage
- Test: `tests/unit/investment-performance.test.ts`, `tests/unit/investment-transactions-sync.test.ts`, `tests/unit/investments-export.test.ts`, `tests/integration/investment-transactions-rls.test.ts`, `tests/e2e/investment-performance.spec.ts`

**Interfaces:**

```ts
export interface BenchmarkProvider {
  series(input: {
    benchmark: "sp500" | "us_stocks" | "us_bonds";
    start: string;
    end: string;
  }): Promise<{ date: string; close: number }[]>;
}

export function computeTimeWeightedReturn(input: {
  valuations: { date: string; value: number }[];
  externalFlows: { date: string; amount: number }[];
}): { date: string; pct: number }[];
```

**Steps:**

- [ ] Sync investment transactions through Plaid's investment-transactions endpoint with stable pagination, explicit date bounds, idempotent upserts, cancellations, and item-scoped service queries.
- [ ] TDD time-weighted return for deposits, withdrawals, fees, flat prices, missing valuation days, same-day flows, and zero starting value.
- [ ] Label balance-only history as Balance until sufficient valuation and flow data exists.
  Never display snapshot-normalized balance change as Portfolio Performance.
- [ ] Add Market and Allocation performance views, account selection, time ranges, CSV, and explanatory tooltips for return methodology.
- [ ] Define the provider-neutral benchmark adapter, cache daily closes, and record source and as-of metadata.
  Do not expose benchmark controls until a licensed real data source is provisioned and its terms are documented.
- [ ] Add comparison cards for Portfolio, S&P 500, US Stocks, and US Bonds only when each selected series covers the same range.
- [ ] Run all gates and commit `feat(investments): add cash-flow-adjusted performance`.

**E2E check:** Add a known deposit to the fixture and prove the balance rises while time-weighted performance remains unchanged, then compare a fully covered range to a benchmark fixture.

---

## Phase 10: Forecasting page

**Branch:** `feat/forecasting`

**Files:**

- Create: `lib/forecasting.ts`, `app/forecasting/page.tsx`, `components/forecasting/ForecastChart.tsx`, `components/forecasting/AssumptionsPanel.tsx`
- Modify: reuse `components/dashboard/WhatIfPanel.tsx` logic by extracting its scenario math into `lib/forecasting.ts` (keep the panel working)
- Test: `tests/unit/forecasting.test.ts`

**Interfaces:**

```ts
export interface ForecastAssumptions {
  monthlySavings: number;        // default: median savings of trailing 6 months (insights.ts helpers)
  annualReturnPct: number;       // applied to investment balance only, default 5
  annualCashYieldPct: number;    // applied to cash, default 0
  monthlyDebtPayment: number;    // reduces liabilities, default trailing median
  horizonMonths: 12 | 60 | 120;
}
export interface ForecastPoint {
  month: string;
  conservative: number;
  base: number;
  optimistic: number;
}
export function forecastNetWorth(
  current: { cash: number; investments: number; liabilities: number },
  assumptions: ForecastAssumptions,
): ForecastPoint[];
// Scenarios are deterministic user assumptions, not statistical confidence.
```

**Steps:**

- [ ] TDD monthly compounding, negative savings, debt floor at zero, liability payments, cash yield, horizon lengths, currency rounding, and conservative/base/optimistic ordering.
- [ ] Extract existing WhatIfPanel scenario math into `lib/forecasting.ts` and prove the current dashboard cases remain unchanged.
- [ ] Page: URL-driven assumptions, scenario chart and table, starting-state reconciliation, milestones, and an explicit "Projection, not a prediction" explanation.
- [ ] Pre-fill cash, investments, and liabilities from Phase 2, monthly savings from the canonical trailing six-month median, and debt payment from identified transfers.
  Display every inferred default and let the user override it.
- [ ] Do not call the scenario envelope a probability, forecast confidence, or guaranteed outcome.
- [ ] Run all gates and commit `feat(forecasting): add transparent net-worth scenarios`.

**E2E check:** defaults load from live data; changing horizon updates the chart via URL only.

---

## Phase 11: Advice page

**Branch:** `feat/advice`

### Migration `<ts>_advice.sql`

```sql
create table public.advice_progress (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  advice_id    text not null,
  task_id      text not null,
  content_version int not null check (content_version > 0),
  completed_at timestamptz not null default now(),
  unique (user_id, advice_id, task_id)
);
alter table public.advice_progress enable row level security;
create policy "advice_progress_all_own" on public.advice_progress
  for all using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter table public.profiles
  add column advice_priorities jsonb,
  add column advice_profile jsonb;
```

**Files:**

- Create: `lib/advice-content.ts` (the content library), `lib/advice.ts` (eligibility + progress), `app/advice/page.tsx`, `app/api/advice/route.ts` (PATCH task toggle + priorities), `components/advice/AdviceCard.tsx`, `components/advice/TaskChecklist.tsx`
- Test: `tests/unit/advice.test.ts`, `tests/integration/advice-route.test.ts`

**Interfaces:**

```ts
export type AdviceCategory = "save_up" | "spend" | "pay_down" | "protect" | "invest" | "wellness";
export interface AdviceItem {
  id: string;                    // "emergency-fund", "review-cash-flow", ...
  version: number;
  category: AdviceCategory;
  title: string;
  body: string;
  tasks: { id: string; label: string }[];
  sources: { title: string; url: string; reviewedAt: string }[];
  relevantWhen?: (ctx: AdviceContext) => boolean;   // e.g. emergency fund: runwayMonths < 3
}
export interface AdviceContext { runwayMonths: number | null; hasBudget: boolean; hasGoals: boolean; creditCardCarry: boolean; hasInvestments: boolean }
export const ADVICE_LIBRARY: AdviceItem[];   // ~12 items written out in full, two per category

export interface AdviceView {
  prioritized: (AdviceItem & { done: number; total: number; started: boolean })[];
  essential: (AdviceItem & { done: number; total: number })[];
  completedCount: number;
}
export function buildAdviceView(
  library: AdviceItem[], progress: { advice_id: string; task_id: string }[],
  priorities: string[] | null, ctx: AdviceContext,
): AdviceView;
```

**Steps:**

- [ ] Write the migration with grants, RLS, bounded JSON validation in the route, takeout/backup/delete coverage, and stable task ids so content reordering does not change completion.
- [ ] Author a versioned education library with at least two reviewed items per category, concrete tasks, source links, reviewed dates, and plain-language uncertainty.
  Do not copy Monarch text.
- [ ] Have retirement, insurance, debt, tax, and wellness content reviewed as general education.
  It must not diagnose, guarantee, recommend a specific security or policy, or imply fiduciary advice.
- [ ] TDD priority ordering, eligibility, completed rollup, content-version changes, removed tasks, source rendering, empty progress, and user-saved priorities.
- [ ] Build a profile questionnaire with explicit optional answers, Skip, Update profile, per-answer explanations, and deletion.
  Store only the minimum structured fields and never send them to Ask-AI without the existing consent.
- [ ] `PATCH /api/advice` toggles stable task ids, saves priorities, and updates profile answers idempotently.
  Audit only action and advice id.
- [ ] Page: Prioritized by you, Essential advice, completed disclosure, category sidebar, item detail, checklist, sources, last-reviewed date, and a persistent general-education disclaimer.
- [ ] Add a content review test that rejects missing sources, stale review dates beyond the agreed interval, duplicate task ids, unsupported external URLs, and prohibited guarantee language.
- [ ] Run all gates and commit `feat(advice): add sourced education checklists`.

**E2E check:** check two tasks, reload, counts persist; reprioritize and confirm order changes.

---

## Phase 12: Transactions UX parity

**Branch:** `feat/transactions-parity`

### Migration `<ts>_manual_transactions_receipts.sql`

```sql
alter table public.transactions
  alter column account_id drop not null,
  add column manual_account_id uuid references public.manual_accounts (id) on delete cascade,
  add column source text not null default 'plaid'
    check (source in ('plaid', 'import', 'manual')),
  add constraint transactions_one_account_check
    check ((account_id is null) <> (manual_account_id is null));

update public.transactions
set source = 'import'
where plaid_transaction_id like 'import-%';

create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  transaction_id uuid references public.transactions (id) on delete set null,
  storage_path text not null,
  merchant text,
  purchase_date date,
  total numeric(14, 2),
  status text not null default 'unmatched'
    check (status in ('unmatched', 'matched', 'ignored')),
  created_at timestamptz not null default now()
);
create index receipts_user_status_idx on public.receipts (user_id, status, created_at desc);
alter table public.receipts enable row level security;
create policy "receipts_all_own" on public.receipts
  for all using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- First use of Supabase Storage in the app: private bucket, user-prefixed paths.
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

create policy "receipt_objects_all_own" on storage.objects
  for all using (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
```

The CSP in `proxy.ts` already sets `img-src 'self' data: https:`, so short-lived signed URLs from the existing Supabase host render without any CSP change; do not widen any directive for this.

**Files:**

- Create: `lib/manual-transaction.ts`, `lib/receipts.ts`, `app/api/transactions/manual/route.ts`, `app/api/receipts/route.ts`, `components/transactions/AddTransactionModal.tsx`, `components/transactions/ColumnsMenu.tsx`, `components/transactions/ReceiptInbox.tsx`
- Modify: `app/transactions/page.tsx`, `components/transactions/TransactionEditor.tsx`, `components/settings/ReceiptScanSection.tsx`, `lib/ledger-filter.ts`, `lib/types.ts`, backup/takeout/delete coverage
- Test: `tests/unit/manual-transaction.test.ts`, `tests/unit/manual-transaction-route.test.ts`, `tests/unit/receipts.test.ts`, `tests/integration/manual-transactions-rls.test.ts`, `tests/e2e/transactions-parity.spec.ts`

**Interfaces:**

```ts
// POST /api/transactions/manual body
interface ManualTxnBody {
  kind: "debit" | "credit";
  amount: number;              // > 0; stored sign: debit => +amount, credit => -amount
  merchant: string;            // 1..120 chars
  date: string;                // YYYY-MM-DD, not in the future
  account: { source: "plaid" | "manual"; id: string };
  category: string | null;     // PFC detailed value
  goal_id: string | null;      // links spend to a save_up goal (Phase 7 spending_reduces)
  notes: string | null;
}
// stored with plaid_transaction_id = `manual-${crypto.randomUUID()}`;
// the `manual-` prefix parallels the existing `import-` convention so sync overlap guards skip these rows.
```

**Steps:**

- [ ] Write the migration with the source backfill, authenticated grants, receipt RLS, private Supabase Storage policies, takeout/backup/delete coverage, and a verification query proving every transaction has exactly one account reference.
- [ ] Update every existing transaction select and TypeScript row shape for nullable Plaid account ids, manual account ids, and source.
  Add regression tests for imports, dashboard totals, ledger filters, refund matching, sync overlap, and account deletion.
- [ ] TDD `normalizeManualTxn`: debit/credit sign, date validation, amount bounds, currency, merchant length, category, goal eligibility, notes, tags, and discriminated account reference.
- [ ] Route: `requireUser`, rate limit, validate, confirm the chosen Plaid or manual account belongs to the user, then use the service client with explicit `user_id` to insert a `manual-` row.
  Do not grant general client insert access to Plaid-synced transactions.
- [ ] DELETE accepts only rows with `source = 'manual'`, scopes by user and id, removes linked annotations and goal events through foreign keys, and audits the id.
- [ ] `AddTransactionModal` matching the screenshot: Debit/Credit toggle, amount, merchant combobox (existing merchants from the ledger), date picker defaulting today, account select, category search, goal link select (Phase 7 goals), notes, tags (existing annotate API on the created row).
- [ ] Day-group headers group the visible filtered page by date with signed totals.
  Pagination never repeats or splits a date without a continuation label.
- [ ] `ColumnsMenu` controls Category, Account, Tags, Notes, Pending, and Source.
  Persist visibility in saved-view params with schema versioning and a Restore defaults action.
- [ ] Reuse Phase 7's transaction-goal mutation for `goal_id`.
  Creating, editing, unlinking, or deleting a manual transaction creates, replaces, or removes one idempotent `goal_progress_events` row, so spending is never double-counted.
- [ ] Promote receipt scanning into an All/Receipts tab.
  Upload originals to a private user-prefixed bucket, store parsed fields and confidence, suggest candidate transactions, require confirmation before linking, and allow delete/ignore.
- [ ] Strip image metadata, enforce MIME and size limits, use short-lived signed URLs, and never include receipt images or OCR text in ordinary logs, exports, or Ask-AI without separate consent.
  Verify the object policies by asserting in the integration RLS test that one user cannot sign or fetch another user's receipt path.
- [ ] Run all gates and commit `feat(transactions): add manual records and receipt inbox`.

**E2E check:** add a manual debit, see it in the day group with updated total, confirm it survives a Plaid sync untouched, delete it.

---

## Phase 13: Settings information architecture, profile, and data organization

**Branch:** `feat/settings-ia`

### Migration `<ts>_profile_and_tags.sql`

```sql
alter table public.profiles
  add column full_name text check (full_name is null or char_length(full_name) between 1 and 120),
  add column display_name text check (display_name is null or char_length(display_name) between 1 and 80),
  add column birthday date,
  add column avatar_path text,
  add column display_prefs jsonb not null default '{}'::jsonb;

create table public.user_tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  color_slot int not null default 0 check (color_slot between 0 and 5),
  created_at timestamptz not null default now(),
  unique (user_id, name)
);
create index user_tags_user_idx on public.user_tags (user_id, name);
alter table public.user_tags enable row level security;
create policy "user_tags_all_own" on public.user_tags
  for all using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Private avatar storage, user-prefixed paths, same pattern as the Phase 12 receipts bucket.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', false)
on conflict (id) do nothing;

create policy "avatar_objects_all_own" on storage.objects
  for all using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
```

Avatars render through short-lived signed URLs; the existing `img-src 'self' data: https:` CSP directive already permits them, so no CSP change is needed.

**Files:**

- Create: `components/settings/settings-nav.ts`, `components/settings/SettingsLayout.tsx`, `components/settings/ProfileSection.tsx`, `components/settings/DisplaySection.tsx`, `components/settings/TagsSection.tsx`, `app/api/settings/profile/route.ts`, `app/api/settings/tags/route.ts`
- Modify: `app/settings/page.tsx`, existing `components/settings/*` sections, `components/ThemeToggle.tsx`, `app/layout.tsx`, `app/manifest.ts`, backup/takeout/delete coverage
- Test: `tests/unit/settings-nav.test.ts`, `tests/unit/profile-route.test.ts`, `tests/unit/display-prefs.test.ts`, `tests/unit/tags-route.test.ts`, `tests/integration/profile-tags-rls.test.ts`, `tests/e2e/settings.spec.ts`

**Navigation model:**

```ts
export type SettingsSection =
  | "profile"
  | "display"
  | "notifications"
  | "security"
  | "integrations"
  | "household-general"
  | "household-members"
  | "household-preferences"
  | "institutions"
  | "categories"
  | "merchants"
  | "rules"
  | "tags"
  | "data";

export interface DisplayPrefs {
  theme: "system" | "light" | "dark";
  density: "comfortable" | "compact";
  defaultPrivacyBlur: boolean;
  reducedMotion: "system" | "reduce" | "no-preference";
}
```

**Steps:**

- [ ] Write the migration with grants, profile validation, tag RLS, private avatar Storage policies, takeout/backup/delete coverage, and profile-date verification SQL.
- [ ] Inventory every existing Settings component and map it to exactly one section.
  Do not rebuild working MFA, sessions, passkeys, notifications, institutions, household, category overrides, merchant rules, imports, exports, backups, API tokens, calendar, AI consent, or Danger Zone behavior.
- [ ] Replace the current all-data-at-once Settings page with a `section` search parameter and task-based side navigation.
  Each section queries only the data it needs, and invalid sections redirect to Profile.
- [ ] Profile supports original avatar upload/delete, full name, display name, optional birthday, and existing timezone.
  Validate IANA timezone, date range, image MIME, dimensions, and size server-side.
  Verify the avatar object policies with an integration RLS test proving one user cannot sign or fetch another user's avatar path.
- [ ] Use `display_name` for dashboard greeting with email-name fallback.
  Birthday is never used for advice eligibility without a separate, visible explanation.
- [ ] Display supports theme, density, default privacy blur, and reduced-motion preference.
  Apply the preference before first paint to avoid a theme flash and retain the existing quick ThemeToggle.
- [ ] Notifications embeds the existing in-app, email, push, report history, and timezone controls.
  Security embeds MFA, passkeys, sessions, audit log, and account deletion.
- [ ] Integrations embeds banks, calendar, API tokens, optional AI consent, and provider status.
  Household sections embed existing general, membership, connection sharing, and settlement preferences.
- [ ] Institutions embeds Banks and manual accounts.
  Categories embeds overrides and budget-category links.
  Merchants embeds merchant cleanup and cancelled subscriptions.
  Rules embeds the existing merchant rules editor.
- [ ] Add a real tag registry over the existing annotation tag strings.
  Rename performs a paginated owner-scoped annotation update, merge deduplicates tags, delete requires confirmation, and every operation is idempotent.
- [ ] Data embeds import review, CSV/JSON/takeout exports, encrypted backup status, demo data, receipts controls, and Danger Zone.
- [ ] Do not render Businesses, Billing, Gift, or Referrals entries.
  They are product-specific to a commercial multi-tenant service and provide no FundFlow capability.
- [ ] Run all gates and commit `feat(settings): add task-based settings and profile`.

**E2E check:** Update profile and timezone, switch display preferences without a flash, navigate every settings section with keyboard and mobile layout, rename and merge a tag, verify Security actions still work, and confirm each section issues only its expected queries.

---

## Self-review results

- Every visible screenshot feature is mapped to Phase 1 through Phase 13 or an explicit exclusion.
- Phase 0 owns the transaction semantics used by Cash Flow, Budget, Reports, Forecasting, Advice, exports, and widgets.
- Existing FundFlow capabilities are reused instead of duplicated: monthly net-worth snapshots, rollover budgets, sinking funds, household sharing, receipt parsing, notification preferences, saved ledger views, Ask-AI consent, WhatIfPanel, weekly PDF, and SVG charts.
- Known product decisions are explicit: credit score remains excluded, commercial billing/referral/business surfaces remain excluded, Retail Sync waits for an authorized integration, benchmarks remain hidden until a licensed feed exists, and Ask-AI remains consent-gated.
- Known data-model risks now have decisions before implementation: daily manual and Plaid account history, stable budget ids, recurring transaction joins, goal allocation limits, manual transaction account references, receipt privacy, holding deactivation, and cash-flow-adjusted returns.
- Each phase ends in usable software with no placeholder pages, focused tests, live RLS coverage where needed, responsive E2E acceptance, migration rollout notes, and a conventional commit.
