# One-Off Scheduled Transactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user enter a future-dated one-off transaction ("transfer $500 to savings on the 1st", "rent due on the 25th") that shows up in the cash-flow forecast and Bill calendar before its date, and automatically materializes as a real ledger row on or after its date.

**Architecture:** A new owner-scoped `scheduled_transactions` table holds the entries. A pure `nextOccurrence`-style promotion function (deterministic id, same shape as the existing `manual-<uuid>` provenance) runs inside the daily cron alongside the other per-user sync steps. `forecastCashFlow` and `groupRecurringByPeriod` in `lib/planning.ts` both gain a parallel one-off `items` input merged into the same `events` array they already sort and walk for recurring items — no new forecast math, just a second source feeding the existing pipeline.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase Postgres, Vitest.

**Spec:** `features.md` §1 ("One-off scheduled (future-dated) transactions").

## Global Constraints

- Amount sign follows Plaid: positive = money out, negative = money in.
- Manual/scheduled ledger rows are never client-inserted into `transactions` directly — `transactions` has no client insert policy at all; every write goes through the service client with an explicit `user_id`, exactly like `app/api/transactions/manual/route.ts`.
- Cron routes authenticate `Authorization: Bearer $CRON_SECRET` via `requireCronAuth`/`safeEqual`.
- Promotion into the ledger must be idempotent: re-running the cron on an already-promoted entry must not create a duplicate row.
- Route handlers: `requireUser()` → early-return the `NextResponse` → `badRequest()` → work → `writeAudit()` → JSON, wrapped so failures hit `errorResponse(context, error)`.
- Create migrations with `npx supabase migration new <slug>`; apply by hand before code reads the table.
- Tests mock with `vi.mock` and import route handlers directly, using `tests/fixtures/supabase-query.ts`.
- `npm run lint`, `npm test`, and `npm run build` must pass before this is done.

---

### Task 1: Add the scheduled_transactions schema

**Files:**

- Create with Supabase CLI: migration slug `scheduled_transactions`
- Modify: `tests/unit/roadmap-schema-completion.test.ts` (or the nearest schema-assertion test file)

**Interfaces:** `scheduled_transactions` is directly client-writable via the RLS-scoped client (this app already has a client-writable financial-configuration table with an identical shape — `manual_recurring_items` — so a one-off entry follows the same trust level, not the `transactions` table's no-client-write rule, since it isn't a ledger row yet).

- [ ] Write failing schema tests asserting: `scheduled_transactions` has columns `id, user_id, date, amount, merchant, category, account_id, manual_account_id, notes, promoted_transaction_id, created_at, updated_at`; a check requiring at most one of `account_id`/`manual_account_id` to be set (both null is valid — an unassigned entry can still appear in the forecast); RLS enabled with `select, insert, update, delete` granted to `authenticated`, scoped to `user_id = auth.uid()` on every policy, and the insert/update policies additionally check the referenced `account_id`/`manual_account_id` ownership (the M8 pattern).
- [ ] Run the focused test and confirm failure.
- [ ] Generate the migration:
  ```sql
  create table public.scheduled_transactions (
    id                      uuid primary key default gen_random_uuid(),
    user_id                 uuid not null references auth.users (id) on delete cascade,
    date                    date not null,
    amount                  numeric(14, 2) not null,
    merchant                text not null check (char_length(merchant) between 1 and 120),
    category                text,
    account_id              uuid references public.accounts (id) on delete set null,
    manual_account_id       uuid references public.manual_accounts (id) on delete set null,
    notes                   text,
    promoted_transaction_id uuid references public.transactions (id) on delete set null,
    created_at              timestamptz not null default now(),
    updated_at              timestamptz not null default now(),
    check (account_id is null or manual_account_id is null)
  );

  create index scheduled_transactions_user_date_idx
    on public.scheduled_transactions (user_id, date)
    where promoted_transaction_id is null;

  create trigger scheduled_transactions_set_updated_at
    before update on public.scheduled_transactions
    for each row execute function public.set_updated_at();

  grant select, insert, update, delete on public.scheduled_transactions to authenticated;
  alter table public.scheduled_transactions enable row level security;

  create policy "scheduled_transactions_select_own" on public.scheduled_transactions
    for select to authenticated using (user_id = (select auth.uid()));

  create policy "scheduled_transactions_insert_own" on public.scheduled_transactions
    for insert to authenticated with check (
      user_id = (select auth.uid())
      and (account_id is null or exists (
        select 1 from public.accounts a where a.id = scheduled_transactions.account_id and a.user_id = (select auth.uid())
      ))
      and (manual_account_id is null or exists (
        select 1 from public.manual_accounts m where m.id = scheduled_transactions.manual_account_id and m.user_id = (select auth.uid())
      ))
    );

  create policy "scheduled_transactions_update_own" on public.scheduled_transactions
    for update to authenticated
    using (user_id = (select auth.uid()))
    with check (
      user_id = (select auth.uid())
      and (account_id is null or exists (
        select 1 from public.accounts a where a.id = scheduled_transactions.account_id and a.user_id = (select auth.uid())
      ))
      and (manual_account_id is null or exists (
        select 1 from public.manual_accounts m where m.id = scheduled_transactions.manual_account_id and m.user_id = (select auth.uid())
      ))
    );

  create policy "scheduled_transactions_delete_own" on public.scheduled_transactions
    for delete to authenticated using (user_id = (select auth.uid()));
  ```
  The partial index (`where promoted_transaction_id is null`) keeps the cron's daily "find due, unpromoted entries" scan cheap as the table accumulates promoted history.
- [ ] Apply the migration and verify the table, constraints, index, and policies.
- [ ] Run the focused schema test again and confirm it passes.
- [ ] Add `scheduled_transactions` to `USER_DATA_TABLES` in `lib/user-data.ts` (columns: `date, amount, merchant, category, account_id, manual_account_id, notes, promoted_transaction_id, created_at`).
- [ ] Commit with `feat(scheduled-txn): add scheduled_transactions schema`.

### Task 2: Implement promotion as a pure function plus its deterministic id

**Files:**

- Create: `lib/scheduled-transactions.ts`
- Create: `tests/unit/scheduled-transactions.test.ts`

**Interfaces:** `makeScheduledTransactionId(scheduledId: string): string` and `buildPromotedTransactionRow(entry: ScheduledEntry, userId: string): PromotedTransactionRow`, consumed by both the cron promotion step (Task 3) and its test.

- [ ] Write failing tests covering: `makeScheduledTransactionId` returns `scheduled-<scheduledId>` (the entry's own uuid is already globally unique, so no hashing is needed — unlike `import-<hash>`, which has to derive identity from row content because a CSV row has no id of its own); re-promoting the same entry twice produces the same id both times (pure function of the input id); `buildPromotedTransactionRow` maps `amount`/`date`/`merchant`/`category` straight through with Plaid sign preserved, sets `account_id`/`manual_account_id` from whichever the entry has, sets `source: "manual"` (a promoted scheduled entry is not Plaid-synced or CSV-imported; it's conceptually the same provenance as a manual entry, so it should render with the existing `manual` ledger badge, not a new one), and sets `plaid_transaction_id` to the id from `makeScheduledTransactionId`.
- [ ] Run `npx vitest run tests/unit/scheduled-transactions.test.ts` and confirm failure.
- [ ] Implement:
  ```ts
  export interface ScheduledEntry {
    id: string;
    date: string;
    amount: number;
    merchant: string;
    category: string | null;
    accountId: string | null;
    manualAccountId: string | null;
  }

  export interface PromotedTransactionRow {
    user_id: string;
    account_id: string | null;
    manual_account_id: string | null;
    plaid_transaction_id: string;
    amount: number;
    date: string;
    name: string;
    merchant_name: string;
    pfc_primary: string | null;
    pending: false;
    source: "manual";
  }

  /**
   * A scheduled entry's own id is already unique, so promotion needs no
   * content hash (unlike lib/import.ts's makeImportId) — just a prefix that
   * marks the row's provenance for lib/finance-domain.ts's parser, mirroring
   * the manual-<uuid> convention in lib/manual-transaction.ts.
   */
  export function makeScheduledTransactionId(scheduledId: string): string {
    return `scheduled-${scheduledId}`;
  }

  export function buildPromotedTransactionRow(
    entry: ScheduledEntry,
    userId: string,
  ): PromotedTransactionRow {
    return {
      user_id: userId,
      account_id: entry.accountId,
      manual_account_id: entry.manualAccountId,
      plaid_transaction_id: makeScheduledTransactionId(entry.id),
      amount: entry.amount,
      date: entry.date,
      name: entry.merchant,
      merchant_name: entry.merchant,
      pfc_primary: entry.category,
      pending: false,
      source: "manual",
    };
  }
  ```
- [ ] Update `lib/finance-domain.ts`'s provenance parser (`sourceFromProviderId`, currently checking for `import-`/`manual-` prefixes) to also recognize the `scheduled-` prefix and map it to the same `"manual"` `FinanceSource` — a promoted entry should look identical to a manually-entered transaction everywhere in the UI.
- [ ] Run the test file again and confirm it passes.
- [ ] Commit with `feat(scheduled-txn): add promotion logic`.

### Task 3: Wire promotion into the daily cron

**Files:**

- Modify: `app/api/cron/sync/route.ts`
- Create: `lib/scheduled-transactions-sync.ts`
- Create: `tests/unit/scheduled-transactions-sync.test.ts`

**Interfaces:** `promoteDueScheduledTransactions(service, userId, today): Promise<{ promoted: number }>`, called from `syncUser()` in `app/api/cron/sync/route.ts` alongside the existing `refreshRecurringForUser`/`writeNetWorthSnapshot` steps.

- [ ] Write failing tests covering: an entry dated on/before `today` with no `promoted_transaction_id` gets promoted — a `transactions` row is upserted (`onConflict: "plaid_transaction_id"`, so re-running the cron on the same entry is a no-op, not a duplicate) and the entry's `promoted_transaction_id` is set to the new row's id; an entry dated in the future is left alone; an entry that already has `promoted_transaction_id` set is skipped entirely (not re-upserted) — this is what makes a second cron run on the same day a true no-op, matching the acceptance criterion "cron promotion is idempotent (re-running changes nothing)"; a promotion failure for one user's one entry doesn't throw out of the function (log and continue, matching every other `runOptionalSync`-wrapped step in `app/api/cron/sync/route.ts`).
- [ ] Run the test file and confirm failure.
- [ ] Implement `promoteDueScheduledTransactions`: `select` due, unpromoted rows (`.eq("user_id", userId).lte("date", today).is("promoted_transaction_id", null)`, using the partial index from Task 1), map each through `buildPromotedTransactionRow`, `upsert` into `transactions` in chunks (mirror `UPSERT_CHUNK = 500` from `lib/import.ts`'s callers), then `update` each promoted row's `promoted_transaction_id` by id.
- [ ] Run the test file again and confirm it passes.
- [ ] Add `await runOptionalSync("cron.sync.scheduled-transactions", () => promoteDueScheduledTransactions(service, userId, today))` to `syncUser()` in `app/api/cron/sync/route.ts`, computing `today` once at the top of the route the same way the existing digest logic derives `todayStart`.
- [ ] Extend `tests/unit/` coverage for `app/api/cron/sync/route.ts` (find its existing test file) with a case proving the new step runs per user and a failure in it doesn't abort the rest of the sync.
- [ ] Commit with `feat(scheduled-txn): promote due entries in the daily cron`.

### Task 4: Implement the CRUD route

**Files:**

- Create: `app/api/scheduled-transactions/route.ts`
- Create: `tests/unit/scheduled-transactions-route.test.ts`
- Modify: `lib/audit.ts`

**Interfaces:** `POST` (create), `PATCH` (edit an unpromoted entry), `DELETE` (cancel an unpromoted entry) at `/api/scheduled-transactions`, following `app/api/recurring/manual/route.ts`'s validation-then-RLS-write shape exactly (this table is directly client-writable, same trust tier as `manual_recurring_items`).

- [ ] Add `"scheduled_transaction_created"`, `"scheduled_transaction_updated"`, and `"scheduled_transaction_deleted"` to the `AuditAction` union in `lib/audit.ts`.
- [ ] Write failing tests covering: `POST` validates `merchant` (1-120 chars), `amount` (finite number, any sign — unlike `normalizeManualTxn`'s debit/credit split, a scheduled entry takes a signed amount directly since "transfer $500 to savings" and "rent due" are both money-out but a scheduled *paycheck* is money-in, so the API should mirror `transactions.amount`'s Plaid convention rather than force a kind toggle), `date` (`YYYY-MM-DD`, **no future-date rejection** — this route explicitly allows dates after today, which is the entire point of the feature, unlike `lib/manual-transaction.ts::normalizeManualTxn`'s `date > today` block), and at most one of `account`/`manual_account` refs; `POST` returns `404` when a referenced account isn't visible to the caller; a successful `POST` audits `"scheduled_transaction_created"`; `PATCH`/`DELETE` return `409` (not silently succeed) when the target entry already has `promoted_transaction_id` set — an already-materialized entry can't be edited or cancelled through this route, only through the ordinary transaction-edit/delete path, since it's already a real ledger row.
- [ ] Run the test file and confirm failure.
- [ ] Implement the route, validating inline (no separate `lib/` normalizer needed given how small the shape is — but if the validation logic grows past what's comfortable inline, factor it into `lib/scheduled-transactions.ts::validateScheduledEntryInput` next to `buildPromotedTransactionRow`), reading/writing via the RLS-scoped `supabase` client from `requireUser()` (not the service client — this table grants direct `authenticated` access, matching `manual_recurring_items`'s trust tier).
- [ ] Run the test file again and confirm it passes.
- [ ] Commit with `feat(scheduled-txn): add CRUD route`.

### Task 5: Feed scheduled entries into the cash-flow forecast and Bill calendar

**Files:**

- Modify: `lib/planning.ts`
- Modify: `tests/unit/planning.test.ts` (or wherever `forecastCashFlow`/`groupRecurringByPeriod` are currently tested)
- Modify: `lib/dashboard.ts`

**Interfaces:** `ForecastInput` gains `oneOffs: OneOffItem[]` (`{ date: string; name: string; amount: number; itemType: "income" | "expense" }`); `forecastCashFlow` merges `oneOffs` into the same `events` array it already builds from `items` before the existing sort-then-walk step. `groupRecurringByPeriod`'s input gains the equivalent parallel `oneOffs` list.

- [ ] Write failing tests proving: a single one-off event lands in `CashFlowForecast.events` at its own date with the correct sign (income = balance increases, expense = balance decreases) and doesn't recur (unlike a `RecurringItem`, it appears exactly once even across a wide `horizonDays`); a one-off dated before `asOf` or after the horizon end is excluded, matching the existing recurring-item window rule; one-offs and recurring items interleave correctly in the sorted `events` list and both contribute to `lowestBalance`/`projectedBalance`; `groupRecurringByPeriod` places a one-off in the correct week/month bucket alongside recurring items.
- [ ] Run the focused test and confirm failure.
- [ ] Extend `forecastCashFlow`: add a second loop building one `events` entry per `oneOffs` item (no `while` occurrence-walk needed, since it's exactly one event), pushed into the same `events` array before the existing `events.sort(...)` call — the rest of the function (the balance-walk loop) needs no changes, since it already just iterates whatever's in `events`.
- [ ] Extend `groupRecurringByPeriod` the same way — merge `oneOffs` into its period-bucketing pass.
- [ ] Run the tests again and confirm they pass.
- [ ] Wire `lib/dashboard.ts::getDashboardData`: fetch unpromoted `scheduled_transactions` (`.is("promoted_transaction_id", null)`) in the same query batch that currently builds `recurringItems`, map each to `OneOffItem`, and pass as `forecastCashFlow`'s new `oneOffs` input (and the equivalent for whatever builds `BillPeriod[]` for `BillCalendar`).
- [ ] Commit with `feat(scheduled-txn): feed the cash-flow forecast and bill calendar`.

### Task 6: Build the create/list UI

**Files:**

- Create: `components/transactions/ScheduleTransactionModal.tsx`
- Create: `components/transactions/UpcomingScheduledList.tsx`
- Modify: `app/transactions/page.tsx` (mount the new list; add an entry point beside `AddTransactionModal`)

**Interfaces:** `ScheduleTransactionModal` is a client component cloned from `AddTransactionModal.tsx`'s form shape but posting to `/api/scheduled-transactions` and **without** the `max={today}` constraint on the date input (this is the one meaningful UI difference — everywhere else, reuse the same `Field`/`Input`/`Select` primitives and the same debit/credit-vs-signed-amount UX decision made in Task 4).

- [ ] Build `ScheduleTransactionModal`: same account/category/notes fields as `AddTransactionModal`, `date` input with no `max`, on submit `POST`s to `/api/scheduled-transactions`, `router.refresh()` on success.
- [ ] Build `UpcomingScheduledList`: a `Panel` listing unpromoted entries sorted by date, each row showing date/merchant/amount (reuse `formatCurrency`/`formatDate`) and a cancel button calling `DELETE /api/scheduled-transactions`; empty state ("No upcoming scheduled entries") when the list is empty.
- [ ] Mount both in `app/transactions/page.tsx` beside the existing `AddTransactionModal` trigger, and pass the loaded upcoming entries down from the page's server-side data load.
- [ ] Verify by hand in the dev server: creating a future-dated entry shows it in `UpcomingScheduledList` and in the Dashboard's Bill calendar/cash-flow forecast before its date; cancelling removes it; light/dark themes and 375px mobile layout.
- [ ] Commit with `feat(scheduled-txn): add schedule-entry UI`.

### Task 7: Full verification pass

**Files:** none (verification only)

- [ ] Run `npm run lint`, `npm run test:unit`, and `npm run build`; fix anything this feature introduced.
- [ ] Manually verify the two acceptance criteria from `features.md` §1 end to end against demo data: a scheduled entry shows in the forecast before its date and in the ledger on/after it; running the cron sync route twice in a row on an already-due entry produces exactly one `transactions` row, not two.
- [ ] Add an RLS integration test (if `.env.local` + applied migrations are available) proving user B cannot read, insert, update, or delete user A's `scheduled_transactions` rows.
- [ ] Update `docs/HANDOFF.md` and `docs/TODO.md`.
