# Accounts Page And Daily Balance History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a production-ready Accounts page and begin trustworthy daily Plaid and manual-account balance history without inventing any history before the first captured day.

**Architecture:** A read-only, RLS-protected `account_balance_snapshots` table records one row per source account per UTC day.
The service client owns every snapshot write, while the cookie client reads owner and explicitly shared Plaid account rows through RLS.
Pure domain functions shape snapshot inserts and build all page groups, totals, changes, and chart series before server-rendered components display them.

**Tech Stack:** Next.js 16 App Router, React 19 Server Components, TypeScript 6, Tailwind 4, Supabase Postgres 17 with RLS, Supabase JS 2, Vitest 4, Playwright 1.61.

## Global Constraints

- Work on `feat/accounts-page`, never directly on `main`.
- Preserve the Phase 0 contracts in `lib/finance-domain.ts`, `lib/finance-query.ts`, `lib/financial-scope.ts`, and `lib/feature-flags.ts`.
- The Accounts page does not read transactions, so it must not perform a redundant transaction query merely to invoke the Phase 0 projection.
- If later work adds transaction-derived values, it must use `fetchFinanceTransactions`, pass real splits to `projectFinanceTransactions`, and obtain scope from `parseFinancialScope`.
- Service-client queries always filter `user_id` explicitly.
- Cookie-client household reads rely on existing RLS and must never expose Plaid item tokens or ciphertext.
- Snapshot dates are UTC `YYYY-MM-DD` values.
- Earlier daily history is unavailable and must never be interpolated or copied backward.
- Account balances are never logged, added to audit metadata, or included in error payloads.
- A public-schema table must have RLS, explicit role grants, owner policies with `TO authenticated`, and indexes matching page queries.
- Authenticated clients receive `SELECT` only on snapshot history.
- Service-role code owns inserts and updates.
- Manual-account mutations move behind authenticated route handlers before the browser stops writing the table directly.
- Multi-currency balances are never summed without exchange rates.
- If more than one currency is visible, render per-currency totals and an honest warning instead of a false combined net worth.
- New interactive controls must meet WCAG 2.2 AA keyboard, focus, name, contrast, and reduced-motion requirements.
- Feature flags control reachability only.
- Do not modify `proxy.ts`.
- Use conventional commits and do not add an agent co-author.
- Before deployment verification, upgrade Vercel CLI 56.3.2 to the latest release with `npm i -g vercel@latest` or `pnpm add -g vercel@latest`.

## File Structure

- Create `supabase/migrations/<generated>_account_snapshots.sql`.
  It creates the daily table, indexes, grants, RLS policies, and current-state-only backfill.
- Create `lib/account-history.ts`.
  It owns snapshot row types, pure shaping, date validation, service-client persistence, and bounded history reads.
- Create `lib/accounts-page.ts`.
  It owns account unification, grouping, per-currency summaries, freshness, month change, and daily net-worth series.
- Create `components/accounts/AccountGroup.tsx`.
  It renders one collapsible account group and its currency totals.
- Create `components/accounts/AccountRow.tsx`.
  It renders account identity, balance, freshness, month change, and sparkline.
- Create `components/accounts/AccountsFilters.tsx`.
  It renders GET-based institution, type, visibility, owner, range, and summary-mode controls.
- Create `components/accounts/SummaryPanel.tsx`.
  It renders per-currency asset, liability, and net-worth summaries plus the daily chart and table twin.
- Create `components/accounts/AccountPreferences.tsx`.
  It persists hidden and ordered account ids inside `profiles.dashboard_prefs` without changing net-worth inclusion.
- Create `app/accounts/page.tsx`.
  It authenticates through the server client, parses scope, reads bounded data, builds the view model, and renders the page.
- Create `app/api/manual-accounts/route.ts`.
  It handles authenticated create, balance update, and delete operations, audit writes, and immediate snapshot capture.
- Create `app/api/export/accounts-csv/route.ts`.
  It exports visible filtered account rows through `lib/csv.ts`.
- Create `tests/unit/account-history.test.ts`.
  It protects snapshot shaping, idempotent persistence arguments, bounds, and null-balance behavior.
- Create `tests/unit/accounts-page.test.ts`.
  It protects grouping, signs, currencies, history, freshness, filters, and household ownership.
- Create `tests/unit/manual-account-routes.test.ts`.
  It protects auth, validation, owner scoping, snapshot side effects, and audit actions.
- Create `tests/unit/accounts-csv-route.test.ts`.
  It protects auth, scope, output columns, and formula-injection neutralization.
- Create `tests/integration/account-snapshot-rls.test.ts`.
  It proves owner reads, shared-account reads, cross-user isolation, and denied cookie-client writes against the live project.
- Create `tests/e2e/accounts.spec.ts`.
  It covers the page at desktop, tablet, and phone widths in light and dark themes.
- Modify `lib/net-worth.ts`.
  It keeps the monthly writer intact and calls the daily writer from the same post-sync boundary.
- Modify `app/api/cron/sync/route.ts`.
  It captures daily balances after a successful user sync without adding Plaid calls.
- Modify `app/api/plaid/sync/route.ts`.
  It captures same-day balances after an explicit refresh so freshness and the latest point stay aligned.
- Modify `components/settings/ManualAccountsSection.tsx`.
  It uses the new route instead of browser-side Supabase mutations and adds balance editing.
- Modify `app/api/cron/backup/route.ts`.
  It includes manual records and snapshot history with an explicit `user_id` filter.
- Modify `app/api/export/takeout/route.ts`.
  It includes readable snapshot history.
- Modify `app/api/account/route.ts`.
  No extra deletion query is needed because both foreign keys use `ON DELETE CASCADE`; add a test that pins this contract.
- Modify `lib/demo-data.ts`.
  It seeds current account snapshots so demo-mode E2E can display honest one-day history.
- Modify `lib/feature-flags.ts`.
  It releases `accountsPage` only after all acceptance gates pass.

---

### Task 1: Create And Apply The Snapshot Migration

**Files:**

- Create: `supabase/migrations/<generated>_account_snapshots.sql`
- Create: `tests/integration/account-snapshot-rls.test.ts`

**Interfaces:**

- Produces table `public.account_balance_snapshots`.
- Produces ordinary conflict target `(account_id, manual_account_id, snapshot_date)` using `NULLS NOT DISTINCT`.
- Authenticated clients can select RLS-visible rows and cannot insert, update, or delete them.
- The service role can perform all snapshot operations.

- [ ] **Step 1: Generate the migration filename**

Run:

```bash
supabase migration new account_snapshots
```

Expected: one empty timestamped SQL file appears in `supabase/migrations/`.

- [ ] **Step 2: Write the migration**

Use this schema contract:

```sql
create table public.account_balance_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid references public.accounts (id) on delete cascade,
  manual_account_id uuid references public.manual_accounts (id) on delete cascade,
  snapshot_date date not null,
  current_balance numeric(14, 2),
  available_balance numeric(14, 2),
  iso_currency_code text not null default 'USD'
    check (char_length(iso_currency_code) = 3),
  created_at timestamptz not null default now(),
  check ((account_id is null) <> (manual_account_id is null))
);

create index account_balance_snapshots_user_date_idx
  on public.account_balance_snapshots (user_id, snapshot_date desc);

create index account_balance_snapshots_account_date_idx
  on public.account_balance_snapshots (account_id, snapshot_date desc)
  where account_id is not null;

create index account_balance_snapshots_manual_date_idx
  on public.account_balance_snapshots (manual_account_id, snapshot_date desc)
  where manual_account_id is not null;

create unique index account_balance_snapshots_source_day_uidx
  on public.account_balance_snapshots (
    account_id,
    manual_account_id,
    snapshot_date
  ) nulls not distinct;

alter table public.account_balance_snapshots enable row level security;

grant select on public.account_balance_snapshots to authenticated;
grant select, insert, update, delete
  on public.account_balance_snapshots to service_role;

create policy "account_balance_snapshots_select_own"
  on public.account_balance_snapshots
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "account_balance_snapshots_select_shared"
  on public.account_balance_snapshots
  for select
  to authenticated
  using (
    account_id is not null
    and exists (
      select 1
      from public.accounts
      where accounts.id = account_balance_snapshots.account_id
    )
  );
```

Append a one-time current-state backfill that inserts only `current_date`.
Use `ON CONFLICT (account_id, manual_account_id, snapshot_date) DO UPDATE` so rerunning the SQL remains idempotent.
Set manual-account currency to `USD`, matching FundFlow's current manual-account model.

- [ ] **Step 3: Add migration verification SQL as comments**

Include runnable queries for:

```sql
select account_id, manual_account_id, snapshot_date, count(*)
from public.account_balance_snapshots
group by account_id, manual_account_id, snapshot_date
having count(*) > 1;

select count(*) as invalid_sources
from public.account_balance_snapshots
where (account_id is null) = (manual_account_id is null);
```

Include a roll-forward note that the safe recovery is to stop writers, export rows, drop the table, and reapply a corrected migration.
Do not promise a backward migration after history begins accumulating.

- [ ] **Step 4: Write the live RLS integration test**

The test must:

- Skip before importing live clients when integration credentials are absent.
- Create two temporary auth users.
- Insert one owned Plaid snapshot and one cross-user snapshot with the service client.
- Assert the owner sees only their owned row.
- Assert the cookie client cannot insert a snapshot.
- Create the minimum household and shared Plaid-item rows needed to prove a member can read a shared snapshot.
- Clean up both users through the admin client.

- [ ] **Step 5: Verify the migration locally without changing production**

Run:

```bash
supabase db lint --local
npm run typecheck
npm run test:unit
```

If local Supabase is unavailable, record that fact and continue with SQL review plus the live apply verification below.

- [ ] **Step 6: Commit the migration before reader code**

Run:

```bash
git add supabase/migrations tests/integration/account-snapshot-rls.test.ts
git commit -m "feat(accounts): add daily balance snapshot schema"
```

- [ ] **Step 7: Apply the exact committed SQL to FundFlow**

Apply only to project `zrxbmmtqqhlwtrinocww`.
Use the Supabase migration API with the committed filename stem as the migration name.
Never apply to project `ofyyjzjjmopwvfqlhnyc`.

- [ ] **Step 8: Verify the live schema before writing readers**

Run read-only SQL that proves:

- The table exists.
- RLS is enabled.
- The authenticated role has `SELECT` and lacks `INSERT`, `UPDATE`, and `DELETE`.
- The service role has write privileges.
- No duplicate source-day rows exist.
- No invalid source rows exist.
- The current-state row count equals the number of current Plaid plus included manual accounts with non-null balances.

Run the integration test against FundFlow and require it to pass.

---

### Task 2: Shape And Persist Daily Snapshots

**Files:**

- Create: `lib/account-history.ts`
- Create: `tests/unit/account-history.test.ts`
- Modify: `lib/net-worth.ts`
- Modify: `app/api/cron/sync/route.ts`
- Modify: `app/api/plaid/sync/route.ts`
- Test: `tests/unit/cron-sync-route.test.ts`

**Interfaces:**

```ts
export interface SnapshotPlaidAccount {
  id: string;
  current_balance: number | string | null;
  available_balance: number | string | null;
  iso_currency_code: string | null;
}

export interface SnapshotManualAccount {
  id: string;
  balance: number | string | null;
  include_in_net_worth: boolean;
}

export interface AccountBalanceSnapshotInsert {
  user_id: string;
  account_id: string | null;
  manual_account_id: string | null;
  snapshot_date: string;
  current_balance: number | null;
  available_balance: number | null;
  iso_currency_code: string;
}

export function shapeDailyAccountSnapshots(input: {
  userId: string;
  plaidAccounts: SnapshotPlaidAccount[];
  manualAccounts: SnapshotManualAccount[];
  snapshotDate: string;
}): AccountBalanceSnapshotInsert[];

export async function writeDailyAccountSnapshots(
  userId: string,
  snapshotDate?: string,
): Promise<{ written: number; snapshotDate: string }>;
```

- [ ] **Step 1: Write failing pure-shaping tests**

Cover:

- Plaid current and available balances.
- Manual current balance and null available balance.
- Explicit `user_id` on every row.
- UTC date validation.
- Currency normalization to uppercase three-letter codes.
- `USD` fallback for missing currency.
- Null current balances omitted rather than written as misleading zeroes.
- Excluded manual accounts omitted.
- Stable Plaid-then-manual ordering.

Run:

```bash
npm test -- tests/unit/account-history.test.ts
```

Expected: fail because `lib/account-history.ts` does not exist.

- [ ] **Step 2: Implement the pure shaper**

Use `Number(value)` only after guarding `null`.
Reject a malformed date with `RangeError`.
Do not log the input.

- [ ] **Step 3: Verify the shaper passes**

Run:

```bash
npm test -- tests/unit/account-history.test.ts
```

Expected: all shaping cases pass.

- [ ] **Step 4: Write failing persistence tests**

Use the shared Supabase query fixture to assert:

- `accounts` and `manual_accounts` reads both filter `user_id`.
- The upsert payload exactly matches `shapeDailyAccountSnapshots`.
- `onConflict` is `account_id,manual_account_id,snapshot_date`.
- Empty input performs no upsert.
- Any read or write error is thrown.

- [ ] **Step 5: Implement `writeDailyAccountSnapshots`**

Use one service client.
Read only:

```text
accounts: id,current_balance,available_balance,iso_currency_code
manual_accounts: id,balance,include_in_net_worth
```

Upsert the shaped array through the ordinary three-column conflict target.

- [ ] **Step 6: Add post-sync calls**

Call the daily writer:

- After `syncAllForUser(userId)` succeeds in the daily cron.
- After `syncAllForUser(user.id)` succeeds in the manual Plaid sync route.

Keep `writeNetWorthSnapshot` and its monthly table unchanged.
Do not add any Plaid request.

- [ ] **Step 7: Verify focused route and history tests**

Run:

```bash
npm test -- tests/unit/account-history.test.ts tests/unit/cron-sync-route.test.ts tests/unit/plaid-routes.test.ts
npm run lint
npm run typecheck
```

- [ ] **Step 8: Commit the writer**

Run:

```bash
git add lib/account-history.ts lib/net-worth.ts app/api/cron/sync/route.ts app/api/plaid/sync/route.ts tests/unit/account-history.test.ts tests/unit/cron-sync-route.test.ts
git commit -m "feat(accounts): capture daily balances after sync"
```

---

### Task 3: Move Manual Account Mutations Behind The Server

**Files:**

- Create: `app/api/manual-accounts/route.ts`
- Create: `tests/unit/manual-account-routes.test.ts`
- Modify: `components/settings/ManualAccountsSection.tsx`

**Interfaces:**

```ts
type ManualAccountType = "asset" | "liability" | "cash" | "investment" | "debt";

type CreateManualAccountBody = {
  name: string;
  accountType: ManualAccountType;
  balance: number;
  includeInNetWorth?: boolean;
};

type UpdateManualAccountBody = {
  id: string;
  balance: number;
  includeInNetWorth?: boolean;
};

type DeleteManualAccountBody = {
  id: string;
};
```

- [ ] **Step 1: Write failing POST, PATCH, and DELETE tests**

Each method must first return the exact auth response from `requireUser()`.
Validation cases must cover blank or over-120-character names, unsupported types, non-finite balances, missing ids, and non-boolean inclusion values.
Ownership tests must seed a cookie-client lookup that returns no row and expect `404`.

- [ ] **Step 2: Implement POST minimally**

Follow:

```text
requireUser
badRequest validation
service insert with user_id
immediate snapshot upsert with user_id
writeAudit action manual_account_created without balance metadata
JSON 201
errorResponse
```

- [ ] **Step 3: Implement PATCH minimally**

Resolve ownership through the cookie client.
Update through the service client with both `id` and `user_id`.
Write the current-day snapshot after the balance update.
Audit `manual_account_updated` with only the account id and changed field names.

- [ ] **Step 4: Implement DELETE minimally**

Resolve ownership through the cookie client.
Delete through the service client with both `id` and `user_id`.
Rely on the snapshot foreign key cascade.
Audit `manual_account_deleted` with only the account id.

- [ ] **Step 5: Replace browser Supabase writes**

Use `fetch("/api/manual-accounts")` for all mutations.
Add an accessible numeric balance editor per row.
Keep optimistic delete rollback.
Display server-safe error copy.
Call `router.refresh()` after successful mutations so Accounts and Settings remain aligned.

- [ ] **Step 6: Verify**

Run:

```bash
npm test -- tests/unit/manual-account-routes.test.ts tests/unit/settings-sections.test.tsx
npm run lint
npm run typecheck
```

- [ ] **Step 7: Commit**

Run:

```bash
git add app/api/manual-accounts/route.ts components/settings/ManualAccountsSection.tsx tests/unit/manual-account-routes.test.ts
git commit -m "feat(accounts): secure manual balance changes"
```

---

### Task 4: Build The Accounts Page Domain Model

**Files:**

- Create: `lib/accounts-page.ts`
- Create: `tests/unit/accounts-page.test.ts`

**Interfaces:**

```ts
export type AccountGroupKey = "credit" | "cash" | "investment" | "loan" | "other";

export interface UnifiedAccountSummary {
  id: string;
  ownerUserId: string;
  source: "plaid" | "manual";
  name: string;
  mask: string | null;
  type: string | null;
  subtype: string | null;
  currentBalance: number | null;
  availableBalance: number | null;
  currency: string;
  institution: string | null;
  updatedAt: string;
  includeInNetWorth: boolean;
}

export interface AccountBalanceSnapshot {
  accountId: string | null;
  manualAccountId: string | null;
  snapshotDate: string;
  currentBalance: number | null;
  availableBalance: number | null;
  currency: string;
}

export interface CurrencyTotal {
  currency: string;
  amount: number;
}

export interface AccountsPageRow {
  id: string;
  ownerUserId: string;
  source: "plaid" | "manual";
  name: string;
  type: string | null;
  subtype: string | null;
  balance: number | null;
  currency: string;
  institution: string | null;
  updatedAgo: string;
  stale: boolean;
  spark: number[];
  monthChange: { amount: number; pct: number | null } | null;
  includeInNetWorth: boolean;
}

export interface AccountsPageData {
  groups: Record<AccountGroupKey, {
    label: string;
    totals: CurrencyTotal[];
    rows: AccountsPageRow[];
  }>;
  summary: {
    currencies: string[];
    currencyMismatch: boolean;
    assets: CurrencyTotal[];
    liabilities: CurrencyTotal[];
    netWorth: CurrencyTotal[];
    netWorthSeries: Record<string, Array<{ date: string; value: number }>>;
    netWorthMonthChange: Record<string, { amount: number; pct: number | null } | null>;
  };
  historyStartsOn: string | null;
}

export function groupKeyFor(
  type: string | null,
  subtype: string | null,
): AccountGroupKey;

export function buildAccountsPageData(
  accounts: UnifiedAccountSummary[],
  snapshots: AccountBalanceSnapshot[],
  now: Date,
): AccountsPageData;
```

- [ ] **Step 1: Write failing grouping tests**

Use literal fixtures for depository, credit, investment, loan, unknown Plaid accounts, and every manual account type.
Assert exact group keys and liability display signs.

- [ ] **Step 2: Implement grouping and display names**

Display `Name (...1234)` when a mask exists.
Keep null balance as null.
Never coerce it to zero.

- [ ] **Step 3: Write failing history tests**

Cover:

- Oldest-to-newest 30-point sparks.
- First available point on or after 30 days ago versus latest.
- Amount change.
- Null percent when the starting balance is zero.
- Missing history.
- No fabricated dates.
- Liability sign treatment.
- Manual inclusion.

- [ ] **Step 4: Implement changes and daily series**

For each date and currency, sum included assets and subtract included liabilities.
Do not carry balances across missing days.
Only accounts with a snapshot on that day contribute to that day's total.

- [ ] **Step 5: Write failing freshness and currency tests**

Assert:

- Less than one minute is `just now`.
- Hours and days are humanized deterministically from the provided `now`.
- Older than 24 hours is stale.
- Multiple currencies produce separate totals and `currencyMismatch: true`.
- No combined total exists across currencies.
- Shared rows keep their owner id for owner filtering.

- [ ] **Step 6: Implement the remaining model**

Sort rows by explicit preference order when supplied later, then by name.
Keep pure functions free of Supabase and React imports.

- [ ] **Step 7: Verify and commit**

Run:

```bash
npm test -- tests/unit/accounts-page.test.ts
npm run lint
npm run typecheck
git add lib/accounts-page.ts tests/unit/accounts-page.test.ts
git commit -m "feat(accounts): model account groups and history"
```

---

### Task 5: Build The Server Page And Accessible Components

**Files:**

- Create: `app/accounts/page.tsx`
- Create: `components/accounts/AccountGroup.tsx`
- Create: `components/accounts/AccountRow.tsx`
- Create: `components/accounts/AccountsFilters.tsx`
- Create: `components/accounts/SummaryPanel.tsx`
- Create: `components/accounts/AccountPreferences.tsx`
- Modify: `lib/feature-flags.ts`
- Test: `tests/unit/accounts-page-render.test.tsx`

**Interfaces:**

The page accepts async search parameters:

```ts
interface AccountsSearchParams {
  scope?: string | string[];
  institution?: string;
  type?: string;
  visibility?: "visible" | "hidden" | "all";
  owner?: string;
  range?: "30" | "90" | "all";
  summary?: "totals" | "percent";
}
```

- [ ] **Step 1: Write failing render tests**

Protect:

- Feature-disabled `notFound`.
- Authenticated AppShell with `active="accounts"`.
- Empty state with Add account.
- Earlier-history unavailable copy when only current state exists.
- Currency mismatch warning.
- Stale indicator.
- Table twin for the net-worth chart.
- Household owner filter only when household scope is active.
- Hidden rows excluded from the list but still included in summary net worth.

- [ ] **Step 2: Implement scoped bounded reads**

Authenticate through the server cookie client.
Read visible household ids, then call `parseFinancialScope`.
Apply `scopeQueryUserId(scope)` only when it returns a value.
Read explicit columns only.
Bound snapshots to the requested range with a hard maximum of 366 days.
Read own Plaid items only for institution labels.
Read `profiles.dashboard_prefs` for hidden and ordered ids.

- [ ] **Step 3: Implement filters**

Use GET links and controls so the page works without client JavaScript.
Preserve `scope` while changing filters.
Owner values are `mine` and opaque owner ids already present in RLS-visible account rows.
Render user-facing labels `You` and `Household member`.

- [ ] **Step 4: Implement groups and rows**

Use native `<details>` for collapsible groups.
Use the existing server-rendered sparkline component.
Keep a text value adjacent to every sparkline.
Mark stale rows with text, not color alone.

- [ ] **Step 5: Implement summary**

Render Totals and Percent as query links.
For each currency, render assets, liabilities, and net worth.
When more than one currency exists, render separate sections and the copy:

```text
Totals are separated by currency because FundFlow does not guess exchange rates.
```

Render the history-start message:

```text
Daily balance history starts on {date}. Earlier history is unavailable.
```

- [ ] **Step 6: Implement preferences**

Extend the existing `DashboardPrefs` shape with:

```ts
accountsPage?: {
  hiddenIds?: string[];
  order?: string[];
};
```

Persist the whole merged JSON object to the caller's own profile.
Hiding an account affects the list only.
It never changes manual `include_in_net_worth` or summary inclusion.
Provide keyboard-operable Move up, Move down, Hide, and Show controls.

- [ ] **Step 7: Reuse existing actions**

Render `RefreshButton` as Refresh all.
Render `ConnectBankButton` as Add account.
Do not create another Plaid sync route.

- [ ] **Step 8: Release the route**

Keep `accountsPage` false while developing.
After all unit, integration, and E2E acceptance checks pass, change its shipped default to true.
Phase 1 will add navigation later.

- [ ] **Step 9: Verify and commit**

Run:

```bash
npm test -- tests/unit/accounts-page.test.ts tests/unit/accounts-page-render.test.tsx tests/unit/feature-flags.test.ts
npm run lint
npm run typecheck
git add app/accounts components/accounts lib/feature-flags.ts tests/unit/accounts-page-render.test.tsx
git commit -m "feat(accounts): add the accounts experience"
```

---

### Task 6: Export Account CSV Safely

**Files:**

- Create: `app/api/export/accounts-csv/route.ts`
- Create: `tests/unit/accounts-csv-route.test.ts`

**Interfaces:**

CSV columns are exactly:

```text
group,name,subtype,balance,currency,as_of
```

- [ ] **Step 1: Write the failing route tests**

Cover:

- `401` passthrough.
- Explicit owner scoping for Mine.
- RLS-visible household rows for Household.
- Exact headers.
- Null balances as empty cells.
- Formula-injection neutralization for an account named `=IMPORTXML(...)`.
- `writeAudit` action `export.accounts_csv`.
- No balances or names in audit metadata.

- [ ] **Step 2: Implement the route**

Use `requireUser`, `parseFinancialScope`, explicit account columns, `buildAccountsPageData`, and `toCsv`.
Return:

```text
Content-Type: text/csv; charset=utf-8
Content-Disposition: attachment; filename="fundflow-accounts.csv"
Cache-Control: no-store
```

- [ ] **Step 3: Verify and commit**

Run:

```bash
npm test -- tests/unit/accounts-csv-route.test.ts
npm run lint
npm run typecheck
git add app/api/export/accounts-csv/route.ts tests/unit/accounts-csv-route.test.ts
git commit -m "feat(accounts): export account balances safely"
```

---

### Task 7: Complete Retention, Demo, And Deletion Coverage

**Files:**

- Modify: `app/api/cron/backup/route.ts`
- Modify: `app/api/export/takeout/route.ts`
- Modify: `app/api/account/route.ts`
- Modify: `lib/demo-data.ts`
- Test: `tests/unit/backup-route.test.ts`
- Test: `tests/unit/takeout-route.test.ts`
- Test: `tests/unit/account-routes.test.ts`
- Test: `tests/unit/demo-data.test.ts`

- [ ] **Step 1: Write failing retention tests**

Assert:

- Backup snapshot reads filter `user_id`.
- Takeout includes `account_balance_snapshots`.
- Account deletion relies on both snapshot foreign keys cascading.
- Demo seeding emits current-day Plaid snapshots.

- [ ] **Step 2: Implement backup and takeout**

Include explicit snapshot columns only:

```text
account_id,manual_account_id,snapshot_date,current_balance,available_balance,iso_currency_code
```

Keep the backup service query explicitly scoped by user id.

- [ ] **Step 3: Pin deletion behavior**

Do not add an application delete query.
The migration's `ON DELETE CASCADE` relationships are the source of truth.
Add a code comment in the account route only if the existing deletion checklist needs the new table named.

- [ ] **Step 4: Seed demo snapshots**

Use the demo account ids returned by the existing account insert.
Seed only the current date.
Do not create past points.

- [ ] **Step 5: Verify and commit**

Run:

```bash
npm test -- tests/unit/backup-route.test.ts tests/unit/takeout-route.test.ts tests/unit/account-routes.test.ts tests/unit/demo-data.test.ts
npm run lint
npm run typecheck
git add app/api/cron/backup/route.ts app/api/export/takeout/route.ts app/api/account/route.ts lib/demo-data.ts tests/unit
git commit -m "feat(accounts): retain balance history across exports"
```

---

### Task 8: Run E2E Acceptance, Full Gates, And Open The PR

**Files:**

- Create: `tests/e2e/accounts.spec.ts`
- Modify: `docs/QA.md`
- Modify: `docs/HANDOFF.md`

- [ ] **Step 1: Write the failing E2E journey**

The journey must:

- Sign in with isolated test credentials or enter demo mode.
- Visit `/accounts`.
- Confirm Plaid and manual accounts render in correct groups.
- Confirm the summary matches the visible fixture.
- Confirm the history-start message is present.
- Toggle totals and percent.
- Exercise institution, type, visibility, range, and owner filters.
- Export CSV and inspect the header.
- Run at 1440x900, 768x1024, and 390x844.
- Run in light and dark themes.
- Check for horizontal overflow, overlapping controls, clipped focus, and sub-44px touch targets.

- [ ] **Step 2: Run focused E2E and inspect screenshots**

Run:

```bash
npm run test:e2e -- tests/e2e/accounts.spec.ts
```

Inspect every screenshot.
Fix clearly incorrect spacing, hierarchy, contrast, wrapping, or mobile overflow before continuing.

- [ ] **Step 3: Run the complete local gate**

Run:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm audit --audit-level=high
```

Require zero failures.
Record audit findings separately if the audit reports advisories.

- [ ] **Step 4: Re-run live database verification**

Run the RLS integration test.
Run read-only SQL for duplicates, invalid source rows, grants, RLS enabled state, and the latest snapshot date.

- [ ] **Step 5: Release the feature flag**

Only after Steps 1 through 4 pass, set `FEATURE_FLAG_DEFAULTS.accountsPage` to `true`.
Re-run its unit test, lint, typecheck, and build.

- [ ] **Step 6: Update handoff and QA**

Record:

- Exact migration filename and live application timestamp.
- History start date.
- Honest statement that earlier history is unavailable.
- Full gate counts.
- Manual visual evidence status.
- Phase 1 remains deferred until more production pages exist.
- Branch-ruleset finding: user `8563761` is an `always` bypass actor and can direct-push `main`.
- Recommended ruleset remediation: change that actor to pull-request-only bypass or remove it after confirming another recovery path.

- [ ] **Step 7: Commit final evidence**

Run:

```bash
git add tests/e2e/accounts.spec.ts docs/QA.md docs/HANDOFF.md lib/feature-flags.ts
git commit -m "test(accounts): verify the accounts experience"
```

- [ ] **Step 8: Push and open the PR**

Run:

```bash
git push -u origin feat/accounts-page
gh pr create --base main --head feat/accounts-page --title "feat: add accounts page and daily balance history"
```

The PR body must lead with:

- Migration commit SHA.
- Confirmation that the exact migration was applied to `zrxbmmtqqhlwtrinocww` before reader code is eligible to merge.
- Live RLS and backfill verification evidence.
- Full local gate evidence.
- Remaining manual operations, if any.

- [ ] **Step 9: Watch all checks**

Require GitHub Actions, Vercel, and any review gate to finish.
If a check fails, inspect the first actionable error, reproduce it with CI-equivalent tool versions, fix it test-first, push, and watch the replacement run.

## Self-Review

- The plan covers every Phase 2 checkbox from the parity master plan.
- It corrects the partial-index upsert incompatibility with one non-partial `NULLS NOT DISTINCT` unique target supported by Postgres 17 and Supabase `onConflict`.
- It avoids fake cross-currency totals.
- It preserves monthly net-worth snapshots.
- It does not invent history.
- It gives authenticated clients no snapshot write privilege.
- It keeps service-client work explicitly user-scoped.
- It includes owner and household RLS proof.
- It includes backup, takeout, deletion, demo, E2E, rollout, and live verification.
- It uses no placeholders or deferred implementation steps.
