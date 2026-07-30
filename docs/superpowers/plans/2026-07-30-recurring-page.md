# Phase 5: Recurring Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `/recurring`, a reviewed occurrence ledger for Plaid recurring streams and manual recurring items, with a review workflow for newly detected merchants, monthly Income/Expenses/Credit-cards progress, and a sidebar badge for unreviewed streams.

**Architecture:** A new pure module (`lib/recurring-page.ts`) expands Plaid streams and manual items into dated occurrences for a given month, anchored on Plaid's own `predicted_next_date`/`first_date`/`last_date`/`frequency` fields and completed via a new `recurring_stream_transactions` join table resolved from Plaid's `transaction_ids` — not a heuristic merchant/amount matcher. `lib/recurring.ts` is extended to persist those occurrence fields and the join table with mark-and-sweep semantics (a stream missing from a successful full refresh is deactivated; a failed or partial refresh changes nothing). A new `lib/recurring-data.ts` loader follows the established `lib/budget-data.ts` shape: parse scope, run scoped queries in parallel, hand rows to the pure module. The page follows the `app/budget/page.tsx` shape: URL-driven month and scope, a feature-flag gate, loading/empty/stale/error panels.

**Tech Stack:** Next.js 16 App Router, TypeScript, Tailwind 4, Supabase (Postgres + RLS), Plaid `transactionsRecurringGet`, Vitest.

## Global Constraints

These apply to every task below (carried from `docs/superpowers/plans/2026-07-29-monarch-parity.md`'s Global Constraints section and this repo's `CLAUDE.md`):

- Preserve every security invariant in `CLAUDE.md`: RLS on all user tables, service-client queries always filter `user_id` explicitly, nonce-based CSP (no new external script/img hosts), MFA enforcement untouched.
- Amount sign follows Plaid: positive = money out, negative = money in. `RecurringOccurrence.amount` in this phase is always a non-negative display magnitude; `isIncome` carries the direction instead, matching how `BillCalendar`/`RecurringItem` already work in `lib/planning.ts`.
- Dates are `YYYY-MM-DD` strings end to end; month keys are `YYYY-MM`.
- Every financial total in this phase comes from the new pure `expandStreamsForMonth`/`countUnreviewedStreams` functions — no component or route re-derives occurrence status or totals independently.
- The page accepts a canonical `FinancialScope` of `mine` or `household` via `parseFinancialScope`/`scopeQueryUserId`. Service-client work (inside `lib/recurring.ts`'s Plaid refresh) always receives an explicit owner `userId`; the page's cookie-bound reads use the RLS-bound client.
- Migrations go in `supabase/migrations/` and must be manually applied to the live Supabase project (`zrxbmmtqqhlwtrinocww`) before any code reading the new columns/table is merged. **This plan cannot apply the migration itself — flag it to the human operator as the one step only they can do**, exactly as every prior phase's migration was applied via the Supabase CLI or dashboard SQL editor.
- New user-owned tables require owner and household RLS coverage, authenticated grants, indexes for every page query. `recurring_stream_transactions` is Plaid-synced data (like `recurring_streams` and `account_balance_snapshots`): grant `select` only to `authenticated`; all writes go through the service client.
- Route handlers: `requireUser()` → early-return `NextResponse` → rate limit where sensitive → `badRequest()` validation → work → `writeAudit()` → JSON, wrapped in `errorResponse(context, error)`.
- Feature navigation stays hidden until the page is production-ready: a new `recurringPage` server-side feature flag gates both the route (`notFound()` when off) and the sidebar/command-palette nav entry, exactly like `budgetPage`.
- Every phase adds loading, empty, partial-data, stale-data, permission-denied, and error-state acceptance cases.
- Commit messages: conventional commits, no co-author lines. Run the focused failing test first, then `npm run lint`, `npx tsc --noEmit`, and `npm run test:unit` before every commit. Run `npm test`, `npm run build`, and the touched Playwright journey before the PR.
- Before writing code, skim the current `node_modules/next/dist/docs/` guide for any API touched (route handlers, async `searchParams`) per `AGENTS.md`.

---

## File Structure

- Create: `supabase/migrations/20260730020000_recurring_review.sql` — schema.
- Create: `lib/recurring-page.ts` — pure occurrence expansion, totals, badge count. No I/O.
- Modify: `lib/recurring.ts` — persist occurrence fields, resolve/join local transactions, mark-and-sweep inactive streams.
- Create: `lib/recurring-data.ts` — Supabase-facing loader that turns scoped rows into `lib/recurring-page.ts` inputs, mirrors `lib/budget-data.ts`.
- Modify: `lib/feature-flags.ts` — add `recurringPage`.
- Modify: `components/ui/icons.tsx` — add the `Repeat` icon.
- Modify: `components/shell/nav-model.ts` — add the `recurring` nav entry behind the flag.
- Modify: `components/shell/AppSidebar.tsx` — render the unreviewed-stream badge on the Recurring link.
- Create: `app/api/recurring/route.ts` — `PATCH` for stream review/dismiss/restore/amount-correction.
- Create: `app/api/recurring/manual/route.ts` — `POST`/`PATCH`/`DELETE` for manual recurring items (split from the stream route: different table, different trust model — RLS-enforced direct writes vs. service-client writes to Plaid-synced data).
- Create: `components/recurring/ReviewBanner.tsx` — the "N new recurring merchant(s)" banner + review panel.
- Create: `components/recurring/MonthSummary.tsx` — Income/Expenses/Credit-cards progress panel.
- Create: `components/recurring/RecurringList.tsx` — client component: Upcoming/Complete occurrence list, list/calendar toggle, manage actions.
- Create: `app/recurring/page.tsx` — page wiring.
- Test: `tests/integration/recurring-stream-rls.test.ts`, `tests/unit/recurring-page.test.ts`, `tests/unit/recurring-lib.test.ts` (extend existing), `tests/unit/recurring-data.test.ts`, `tests/unit/recurring-route.test.ts`, `tests/unit/recurring-manual-route.test.ts`, `tests/unit/sidebar-nav.test.ts` (extend existing), `tests/e2e/recurring.spec.ts`.

---

## Task 1: Migration — occurrence columns, join table, RLS

**Files:**
- Create: `supabase/migrations/20260730020000_recurring_review.sql`

**Interfaces:**
- Produces: columns `recurring_streams.reviewed_at`, `.dismissed_at`, `.account_id`, `.first_date`, `.last_date`, `.predicted_next_date`, `.user_amount`; table `public.recurring_stream_transactions(id, user_id, recurring_stream_id, transaction_id, created_at)`.

- [ ] **Step 1: Write the migration**

```sql
-- Occurrence tracking for the Recurring page (Phase 5): review workflow,
-- account linkage, Plaid-provided occurrence anchors, and a join table
-- resolving each stream's Plaid transaction_ids to local transaction rows
-- so occurrence completion is read from real matches, not a heuristic.

alter table public.recurring_streams
  add column reviewed_at timestamptz,
  add column dismissed_at timestamptz,
  add column account_id uuid references public.accounts (id) on delete set null,
  add column first_date date,
  add column last_date date,
  add column predicted_next_date date,
  add column user_amount numeric(14, 2);

create index recurring_streams_account_id_idx on public.recurring_streams (account_id);

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
create index recurring_stream_transactions_stream_idx
  on public.recurring_stream_transactions (recurring_stream_id);

alter table public.recurring_stream_transactions enable row level security;

create policy "rst_select_own" on public.recurring_stream_transactions
  for select using (user_id = (select auth.uid()));

-- Household visibility follows the stream's own household rule
-- (recurring_streams_select_household): the stream's plaid_item must be
-- explicitly shared AND the caller must be a member of that household.
-- A bare `exists (select 1 from recurring_streams where id = ...)` here
-- would let ANY authenticated user read ANY user's join rows — the same
-- class of bug Phase 3's shared_transaction_authorization migration fixed
-- for transactions, and the reason this table doesn't ship with that gap.
create policy "rst_select_shared_stream" on public.recurring_stream_transactions
  for select using (
    exists (
      select 1 from public.recurring_streams rs
      join public.plaid_items pi on pi.id = rs.plaid_item_id
      where rs.id = recurring_stream_transactions.recurring_stream_id
        and pi.shared_household_id is not null
        and public.is_household_member(pi.shared_household_id)
    )
  );

-- Plaid-synced data: only the service client writes (during a recurring
-- refresh), same trust level as recurring_streams itself. No insert/update/
-- delete policy exists, so the cookie client cannot write history even with
-- a grant.
grant select on public.recurring_stream_transactions to authenticated;
```

- [ ] **Step 2: Backfill note**

No backfill needed: the new `recurring_streams` columns default to `null` for existing rows, and the next `refreshRecurringForUser` call (manual Refresh or the daily cron) populates them for every active stream. Existing streams remain visible and functional with `reviewed_at`/`dismissed_at` both null (meaning: needs review if `status = 'MATURE'`).

- [ ] **Step 3: Verification queries (run after applying to the live project)**

```sql
-- RLS is enabled and exactly two select policies exist.
select relrowsecurity from pg_class where relname = 'recurring_stream_transactions';
select policyname from pg_policies where tablename = 'recurring_stream_transactions';

-- No existing recurring_streams row was corrupted by the alter.
select count(*) from public.recurring_streams where reviewed_at is not null; -- expect 0 right after apply
```

- [ ] **Step 4: Flag for the human operator**

State explicitly in the PR description: "Apply `supabase/migrations/20260730020000_recurring_review.sql` to the live FundFlow project (`zrxbmmtqqhlwtrinocww`) via the Supabase CLI or dashboard SQL editor before merging — code in this PR reads the new columns and table." Do not merge reader code first.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260730020000_recurring_review.sql
git commit -m "feat(recurring): add occurrence tracking migration"
```

---

## Task 2: Integration RLS test for the new table

**Files:**
- Create: `tests/integration/recurring-stream-rls.test.ts`

**Interfaces:**
- Consumes: live Supabase project via `@supabase/supabase-js`, same pattern as `tests/integration/budget-period-rls.test.ts` and `tests/integration/account-snapshot-rls.test.ts`.

- [ ] **Step 1: Write the failing integration test**

```typescript
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secret = process.env.SUPABASE_SECRET_KEY;
const run = Boolean(url && publishable && secret);
const suite = run ? describe : describe.skip;

suite("recurring stream transactions RLS", () => {
  if (!run) return;

  const admin = createClient(url!, secret!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const stamp = Date.now();
  const credentials = {
    owner: { email: `rst-owner-${stamp}@example.com`, password: "Password123!" },
    member: { email: `rst-member-${stamp}@example.com`, password: "Password123!" },
    outsider: { email: `rst-outsider-${stamp}@example.com`, password: "Password123!" },
  };
  let ownerId = "";
  let memberId = "";
  let outsiderId = "";
  let privateJoinId = "";
  let sharedJoinId = "";
  let ownerClient: SupabaseClient;
  let memberClient: SupabaseClient;
  let outsiderClient: SupabaseClient;

  async function createUser(email: string, password: string) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw error;
    return data.user.id;
  }

  async function signIn(email: string, password: string): Promise<SupabaseClient> {
    const client = createClient(url!, publishable!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return client;
  }

  async function insertOne(table: string, value: Record<string, unknown>, columns = "id") {
    const { data, error } = await admin.from(table).insert(value).select(columns).single();
    if (error) throw error;
    return data as unknown as Record<string, unknown>;
  }

  beforeAll(async () => {
    ownerId = await createUser(credentials.owner.email, credentials.owner.password);
    memberId = await createUser(credentials.member.email, credentials.member.password);
    outsiderId = await createUser(credentials.outsider.email, credentials.outsider.password);
    ownerClient = await signIn(credentials.owner.email, credentials.owner.password);
    memberClient = await signIn(credentials.member.email, credentials.member.password);
    outsiderClient = await signIn(credentials.outsider.email, credentials.outsider.password);

    const household = await insertOne("households", {
      owner_user_id: ownerId,
      name: "Recurring RLS household",
    });
    await insertOne("household_members", {
      household_id: household.id,
      user_id: memberId,
      role: "member",
      status: "active",
    });

    const privateItem = await insertOne("plaid_items", {
      user_id: ownerId,
      plaid_item_id: `item-private-${stamp}`,
      access_token_ciphertext: "x",
      access_token_iv: "x",
      access_token_tag: "x",
    });
    const sharedItem = await insertOne("plaid_items", {
      user_id: ownerId,
      plaid_item_id: `item-shared-${stamp}`,
      access_token_ciphertext: "x",
      access_token_iv: "x",
      access_token_tag: "x",
      shared_household_id: household.id,
    });

    const privateAccount = await insertOne("accounts", {
      user_id: ownerId,
      plaid_item_id: privateItem.id,
      plaid_account_id: `acc-private-${stamp}`,
      name: "Private checking",
      type: "depository",
    });
    const sharedAccount = await insertOne("accounts", {
      user_id: ownerId,
      plaid_item_id: sharedItem.id,
      plaid_account_id: `acc-shared-${stamp}`,
      name: "Shared checking",
      type: "depository",
    });

    const privateTxn = await insertOne("transactions", {
      user_id: ownerId,
      account_id: privateAccount.id,
      plaid_transaction_id: `txn-private-${stamp}`,
      date: "2026-07-01",
      amount: 12.99,
      name: "PRIVATE SUB",
    });
    const sharedTxn = await insertOne("transactions", {
      user_id: ownerId,
      account_id: sharedAccount.id,
      plaid_transaction_id: `txn-shared-${stamp}`,
      date: "2026-07-01",
      amount: 12.99,
      name: "SHARED SUB",
    });

    const privateStream = await insertOne("recurring_streams", {
      user_id: ownerId,
      plaid_item_id: privateItem.id,
      stream_id: `stream-private-${stamp}`,
      status: "MATURE",
    });
    const sharedStream = await insertOne("recurring_streams", {
      user_id: ownerId,
      plaid_item_id: sharedItem.id,
      stream_id: `stream-shared-${stamp}`,
      status: "MATURE",
    });

    const privateJoin = await insertOne("recurring_stream_transactions", {
      user_id: ownerId,
      recurring_stream_id: privateStream.id,
      transaction_id: privateTxn.id,
    });
    const sharedJoin = await insertOne("recurring_stream_transactions", {
      user_id: ownerId,
      recurring_stream_id: sharedStream.id,
      transaction_id: sharedTxn.id,
    });
    privateJoinId = privateJoin.id as string;
    sharedJoinId = sharedJoin.id as string;
  });

  afterAll(async () => {
    for (const id of [ownerId, memberId, outsiderId]) {
      if (id) await admin.auth.admin.deleteUser(id);
    }
  });

  it("lets the owner read both join rows", async () => {
    const { data, error } = await ownerClient
      .from("recurring_stream_transactions")
      .select("id")
      .in("id", [privateJoinId, sharedJoinId]);
    expect(error).toBeNull();
    expect((data ?? []).map((r) => r.id).sort()).toEqual(
      [privateJoinId, sharedJoinId].sort(),
    );
  });

  it("lets a household member read only the shared join row", async () => {
    const { data, error } = await memberClient
      .from("recurring_stream_transactions")
      .select("id")
      .in("id", [privateJoinId, sharedJoinId]);
    expect(error).toBeNull();
    expect((data ?? []).map((r) => r.id)).toEqual([sharedJoinId]);
  });

  it("blocks an outsider from reading either join row", async () => {
    const { data, error } = await outsiderClient
      .from("recurring_stream_transactions")
      .select("id")
      .in("id", [privateJoinId, sharedJoinId]);
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });

  it("denies the cookie client any write", async () => {
    const { error } = await ownerClient
      .from("recurring_stream_transactions")
      .update({ transaction_id: privateJoinId })
      .eq("id", privateJoinId);
    expect(error).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run it**

Run: `npm test -- tests/integration/recurring-stream-rls.test.ts` (requires `.env.local` with live Supabase credentials and Task 1's migration applied; auto-skips otherwise).
Expected: 4 passing once the migration is live; a clean `describe.skip` without credentials.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/recurring-stream-rls.test.ts
git commit -m "test(recurring): verify household-scoped stream transaction RLS"
```

---

## Task 3: `lib/recurring-page.ts` — occurrence expansion core

**Files:**
- Create: `lib/recurring-page.ts`
- Test: `tests/unit/recurring-page.test.ts`

**Interfaces:**
- Produces:

```typescript
export type RecurringFrequency =
  | "WEEKLY"
  | "BIWEEKLY"
  | "SEMI_MONTHLY"
  | "MONTHLY"
  | "ANNUALLY"
  | "UNKNOWN";

export type RecurringStreamStatus = "MATURE" | "EARLY_DETECTION" | "TOMBSTONED" | "UNKNOWN";

export interface RecurringStreamInput {
  id: string;
  streamType: "inflow" | "outflow";
  merchantName: string | null;
  description: string | null;
  averageAmount: number | null;
  lastAmount: number | null;
  userAmount: number | null;
  frequency: RecurringFrequency;
  status: RecurringStreamStatus;
  isActive: boolean;
  accountName: string | null;
  isCreditAccount: boolean;
  firstDate: string | null;
  lastDate: string | null;
  predictedNextDate: string | null;
  reviewedAt: string | null;
  dismissedAt: string | null;
  matchedTransactions: { id: string; date: string }[];
}

export type ManualRecurringFrequency = "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly";

export interface ManualRecurringItemInput {
  id: string;
  name: string;
  amount: number;
  frequency: ManualRecurringFrequency;
  nextDate: string;
  itemType: "income" | "expense";
  category: string | null;
  enabled: boolean;
}

export interface RecurringOccurrence {
  source: "plaid" | "manual";
  sourceId: string;
  merchant: string;
  frequency: string;
  dueDate: string;
  account: string | null;
  category: string | null;
  amount: number;
  status: "upcoming" | "overdue" | "complete";
  matchedTransactionId: string | null;
  isIncome: boolean;
}

export interface RecurringMonth {
  month: string;
  occurrences: RecurringOccurrence[];
  totals: {
    income: { paid: number; remaining: number };
    expenses: { paid: number; remaining: number };
    creditCards: { paid: number; remaining: number };
  };
  reviewCount: number;
}

export function occurrenceDatesInWindow(
  anchor: string,
  cadence: { unit: "days" | "months"; amount: number },
  windowStart: string,
  windowEndExclusive: string,
): string[];

export function countUnreviewedStreams(
  streams: Pick<RecurringStreamInput, "isActive" | "status" | "dismissedAt" | "reviewedAt">[],
): number;

export function expandStreamsForMonth(
  streams: RecurringStreamInput[],
  manualItems: ManualRecurringItemInput[],
  month: string,
  today: string,
): RecurringMonth;
```

- [ ] **Step 1: Write failing tests for date stepping**

```typescript
import { describe, expect, it } from "vitest";
import { occurrenceDatesInWindow } from "@/lib/recurring-page";

describe("occurrenceDatesInWindow", () => {
  it("returns every weekly occurrence anchored ahead of the window", () => {
    const dates = occurrenceDatesInWindow(
      "2026-08-05",
      { unit: "days", amount: 7 },
      "2026-07-01",
      "2026-08-01",
    );
    expect(dates).toEqual(["2026-07-01", "2026-07-08", "2026-07-15", "2026-07-22", "2026-07-29"]);
  });

  it("returns one monthly occurrence for the anchor's own month", () => {
    const dates = occurrenceDatesInWindow(
      "2026-07-15",
      { unit: "months", amount: 1 },
      "2026-07-01",
      "2026-08-01",
    );
    expect(dates).toEqual(["2026-07-15"]);
  });

  it("returns no annual occurrence for a month that isn't the anniversary month", () => {
    const dates = occurrenceDatesInWindow(
      "2026-03-01",
      { unit: "months", amount: 12 },
      "2026-07-01",
      "2026-08-01",
    );
    expect(dates).toEqual([]);
  });

  it("returns two semi-monthly occurrences within a 31-day month", () => {
    const dates = occurrenceDatesInWindow(
      "2026-07-01",
      { unit: "days", amount: 15 },
      "2026-07-01",
      "2026-08-01",
    );
    expect(dates.length).toBe(2);
    expect(dates[0]).toBe("2026-07-01");
  });

  it("carries a leap-day monthly anchor across February without throwing", () => {
    const dates = occurrenceDatesInWindow(
      "2028-01-29",
      { unit: "months", amount: 1 },
      "2028-02-01",
      "2028-03-01",
    );
    // JS month-stepping on a day-of-month past the target month's length
    // rolls into the following month (2028 is a leap year: Jan 29 + 1 month
    // lands on Feb 29, which does exist). This is a real date, not a bug.
    expect(dates).toEqual(["2028-02-29"]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/recurring-page.test.ts -t occurrenceDatesInWindow`
Expected: FAIL — `occurrenceDatesInWindow is not a function` (module doesn't exist yet).

- [ ] **Step 3: Implement the date-stepping core**

```typescript
export type RecurringFrequency =
  | "WEEKLY"
  | "BIWEEKLY"
  | "SEMI_MONTHLY"
  | "MONTHLY"
  | "ANNUALLY"
  | "UNKNOWN";

export type RecurringStreamStatus = "MATURE" | "EARLY_DETECTION" | "TOMBSTONED" | "UNKNOWN";

interface Cadence {
  unit: "days" | "months";
  amount: number;
}

const PLAID_CADENCE: Record<RecurringFrequency, Cadence> = {
  WEEKLY: { unit: "days", amount: 7 },
  BIWEEKLY: { unit: "days", amount: 14 },
  SEMI_MONTHLY: { unit: "days", amount: 15 },
  MONTHLY: { unit: "months", amount: 1 },
  ANNUALLY: { unit: "months", amount: 12 },
  UNKNOWN: { unit: "months", amount: 1 },
};

const FREQUENCY_LABELS: Record<RecurringFrequency, string> = {
  WEEKLY: "Every week",
  BIWEEKLY: "Every 2 weeks",
  SEMI_MONTHLY: "Twice a month",
  MONTHLY: "Every month",
  ANNUALLY: "Every year",
  UNKNOWN: "Recurring",
};

function parseDate(date: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const next = parseDate(date);
  next.setUTCDate(next.getUTCDate() + days);
  return isoDate(next);
}

function addMonths(date: string, months: number): string {
  const next = parseDate(date);
  next.setUTCMonth(next.getUTCMonth() + months);
  return isoDate(next);
}

function step(date: string, cadence: Cadence, direction: 1 | -1): string {
  if (cadence.unit === "days") return addDays(date, cadence.amount * direction);
  return addMonths(date, cadence.amount * direction);
}

/** Bounded so a corrupt or far-future anchor can never loop forever. */
const MAX_STEPS = 600;

/**
 * Every occurrence date in `[windowStart, windowEndExclusive)` reachable
 * from `anchor` by stepping at `cadence`'s pace, in either direction. Used
 * for both Plaid streams (whose anchor is usually a future predicted date)
 * and manual items (whose anchor is a user-entered next-due date).
 */
export function occurrenceDatesInWindow(
  anchor: string,
  cadence: Cadence,
  windowStart: string,
  windowEndExclusive: string,
): string[] {
  let cursor = anchor;
  for (let i = 0; i < MAX_STEPS && cursor >= windowStart; i++) {
    cursor = step(cursor, cadence, -1);
  }
  const dates: string[] = [];
  for (let i = 0; i < MAX_STEPS && cursor < windowEndExclusive; i++) {
    cursor = step(cursor, cadence, 1);
    if (cursor >= windowStart && cursor < windowEndExclusive) dates.push(cursor);
  }
  return dates;
}
```

- [ ] **Step 4: Run to verify the stepping tests pass**

Run: `npx vitest run tests/unit/recurring-page.test.ts -t occurrenceDatesInWindow`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/recurring-page.ts tests/unit/recurring-page.test.ts
git commit -m "feat(recurring): add cadence-based occurrence date stepping"
```

---

## Task 4: `lib/recurring-page.ts` — full month expansion, completion, totals, badge

**Files:**
- Modify: `lib/recurring-page.ts`
- Modify: `tests/unit/recurring-page.test.ts`

**Interfaces:**
- Consumes: `occurrenceDatesInWindow`, `Cadence`, `PLAID_CADENCE`, `FREQUENCY_LABELS` from Task 3.
- Produces: `countUnreviewedStreams`, `expandStreamsForMonth` (signatures above).

- [ ] **Step 1: Write failing tests for `countUnreviewedStreams`**

```typescript
import { countUnreviewedStreams, expandStreamsForMonth } from "@/lib/recurring-page";

describe("countUnreviewedStreams", () => {
  it("counts only active, MATURE, non-dismissed, unreviewed streams", () => {
    const count = countUnreviewedStreams([
      { isActive: true, status: "MATURE", dismissedAt: null, reviewedAt: null },
      { isActive: true, status: "MATURE", dismissedAt: null, reviewedAt: "2026-07-01T00:00:00Z" },
      { isActive: true, status: "MATURE", dismissedAt: "2026-07-01T00:00:00Z", reviewedAt: null },
      { isActive: true, status: "EARLY_DETECTION", dismissedAt: null, reviewedAt: null },
      { isActive: false, status: "MATURE", dismissedAt: null, reviewedAt: null },
    ]);
    expect(count).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify failure, then implement**

```typescript
export function countUnreviewedStreams(
  streams: Pick<RecurringStreamInput, "isActive" | "status" | "dismissedAt" | "reviewedAt">[],
): number {
  return streams.filter(
    (stream) =>
      stream.isActive &&
      stream.status === "MATURE" &&
      !stream.dismissedAt &&
      !stream.reviewedAt,
  ).length;
}
```

Run: `npx vitest run tests/unit/recurring-page.test.ts -t countUnreviewedStreams` → PASS.

- [ ] **Step 3: Write failing tests for `expandStreamsForMonth`**

```typescript
function stream(overrides: Partial<RecurringStreamInput> = {}): RecurringStreamInput {
  return {
    id: "stream-1",
    streamType: "outflow",
    merchantName: "Netflix",
    description: null,
    averageAmount: 15.49,
    lastAmount: 15.49,
    userAmount: null,
    frequency: "MONTHLY",
    status: "MATURE",
    isActive: true,
    accountName: "Checking",
    isCreditAccount: false,
    firstDate: "2026-01-15",
    lastDate: "2026-06-15",
    predictedNextDate: "2026-07-15",
    reviewedAt: "2026-01-16T00:00:00Z",
    dismissedAt: null,
    matchedTransactions: [],
    ...overrides,
  };
}

describe("expandStreamsForMonth", () => {
  it("marks an occurrence complete when a matched transaction lands near the due date", () => {
    const month = expandStreamsForMonth(
      [stream({ matchedTransactions: [{ id: "txn-1", date: "2026-07-16" }] })],
      [],
      "2026-07",
      "2026-07-20",
    );
    expect(month.occurrences).toHaveLength(1);
    expect(month.occurrences[0]).toMatchObject({
      status: "complete",
      matchedTransactionId: "txn-1",
      dueDate: "2026-07-15",
      amount: 15.49,
      isIncome: false,
    });
  });

  it("marks an unmatched past-due occurrence overdue and a future one upcoming", () => {
    const overdue = expandStreamsForMonth([stream()], [], "2026-07", "2026-07-20");
    expect(overdue.occurrences[0]!.status).toBe("overdue");

    const upcoming = expandStreamsForMonth([stream()], [], "2026-07", "2026-07-10");
    expect(upcoming.occurrences[0]!.status).toBe("upcoming");
  });

  it("excludes dismissed and tombstoned streams", () => {
    const month = expandStreamsForMonth(
      [
        stream({ id: "a", dismissedAt: "2026-07-01T00:00:00Z" }),
        stream({ id: "b", status: "TOMBSTONED" }),
      ],
      [],
      "2026-07",
      "2026-07-20",
    );
    expect(month.occurrences).toHaveLength(0);
  });

  it("skips streams with no usable anchor date", () => {
    const month = expandStreamsForMonth(
      [stream({ predictedNextDate: null, lastDate: null, firstDate: null })],
      [],
      "2026-07",
      "2026-07-20",
    );
    expect(month.occurrences).toHaveLength(0);
  });

  it("buckets income, expenses, and credit-card occurrences separately", () => {
    const month = expandStreamsForMonth(
      [
        stream({ id: "paycheck", streamType: "inflow", averageAmount: 3000 }),
        stream({ id: "card-bill", isCreditAccount: true, averageAmount: 200 }),
        stream({ id: "rent", averageAmount: 1500, matchedTransactions: [{ id: "t", date: "2026-07-15" }] }),
      ],
      [],
      "2026-07",
      "2026-07-20",
    );
    expect(month.totals.income.remaining).toBe(3000);
    expect(month.totals.creditCards.remaining).toBe(200);
    expect(month.totals.expenses.paid).toBe(1500);
  });

  it("expands enabled manual items and skips disabled ones", () => {
    const month = expandStreamsForMonth(
      [],
      [
        {
          id: "manual-1",
          name: "Piano lessons",
          amount: 80,
          frequency: "monthly",
          nextDate: "2026-07-05",
          itemType: "expense",
          category: "Education",
          enabled: true,
        },
        {
          id: "manual-2",
          name: "Old gym",
          amount: 40,
          frequency: "monthly",
          nextDate: "2026-07-01",
          itemType: "expense",
          category: null,
          enabled: false,
        },
      ],
      "2026-07",
      "2026-07-01",
    );
    expect(month.occurrences).toHaveLength(1);
    expect(month.occurrences[0]).toMatchObject({ source: "manual", sourceId: "manual-1", category: "Education" });
  });

  it("computes reviewCount independently of the viewed month's occurrences", () => {
    const month = expandStreamsForMonth(
      [stream({ reviewedAt: null }), stream({ id: "b", predictedNextDate: "2099-01-01", reviewedAt: null })],
      [],
      "2026-07",
      "2026-07-20",
    );
    expect(month.reviewCount).toBe(2);
  });
});
```

- [ ] **Step 4: Run to verify failure**

Run: `npx vitest run tests/unit/recurring-page.test.ts -t expandStreamsForMonth`
Expected: FAIL — `expandStreamsForMonth is not a function`.

- [ ] **Step 5: Implement**

```typescript
const MANUAL_CADENCE: Record<ManualRecurringFrequency, Cadence> = {
  weekly: { unit: "days", amount: 7 },
  biweekly: { unit: "days", amount: 14 },
  monthly: { unit: "months", amount: 1 },
  quarterly: { unit: "months", amount: 3 },
  yearly: { unit: "months", amount: 12 },
};

const MANUAL_FREQUENCY_LABELS: Record<ManualRecurringFrequency, string> = {
  weekly: "Every week",
  biweekly: "Every 2 weeks",
  monthly: "Every month",
  quarterly: "Every quarter",
  yearly: "Every year",
};

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function toleranceDays(frequency: RecurringFrequency): number {
  return frequency === "WEEKLY" || frequency === "BIWEEKLY" ? 5 : 10;
}

function nearestMatch(
  dueDate: string,
  matches: { id: string; date: string }[],
  tolerance: number,
): { id: string; date: string } | null {
  const lower = addDays(dueDate, -tolerance);
  const upper = addDays(dueDate, tolerance);
  const inRange = matches.filter((match) => match.date >= lower && match.date <= upper);
  if (inRange.length === 0) return null;
  return inRange.toSorted(
    (a, b) => Math.abs(dayDiff(a.date, dueDate)) - Math.abs(dayDiff(b.date, dueDate)),
  )[0]!;
}

function dayDiff(a: string, b: string): number {
  return (parseDate(a).getTime() - parseDate(b).getTime()) / 86_400_000;
}

interface Bucket {
  paid: number;
  remaining: number;
}

function addToBucket(bucket: Bucket, amount: number, complete: boolean): void {
  if (complete) bucket.paid = round2(bucket.paid + amount);
  else bucket.remaining = round2(bucket.remaining + amount);
}

export function expandStreamsForMonth(
  streams: RecurringStreamInput[],
  manualItems: ManualRecurringItemInput[],
  month: string,
  today: string,
): RecurringMonth {
  const windowStart = `${month}-01`;
  const windowEndExclusive = addMonths(windowStart, 1);
  const occurrences: RecurringOccurrence[] = [];
  const totals = {
    income: { paid: 0, remaining: 0 },
    expenses: { paid: 0, remaining: 0 },
    creditCards: { paid: 0, remaining: 0 },
  };

  for (const stream of streams) {
    if (stream.dismissedAt || stream.status === "TOMBSTONED" || !stream.isActive) continue;
    const anchor = stream.predictedNextDate ?? stream.lastDate ?? stream.firstDate;
    if (!anchor) continue;

    const cadence = PLAID_CADENCE[stream.frequency];
    const tolerance = toleranceDays(stream.frequency);
    const dueDates = occurrenceDatesInWindow(anchor, cadence, windowStart, windowEndExclusive);
    const amount = Math.abs(stream.userAmount ?? stream.averageAmount ?? stream.lastAmount ?? 0);
    const isIncome = stream.streamType === "inflow";

    for (const dueDate of dueDates) {
      const match = nearestMatch(dueDate, stream.matchedTransactions, tolerance);
      const complete = match !== null;
      occurrences.push({
        source: "plaid",
        sourceId: stream.id,
        merchant: stream.merchantName ?? stream.description ?? "Unknown",
        frequency: FREQUENCY_LABELS[stream.frequency],
        dueDate,
        account: stream.accountName,
        category: null,
        amount,
        status: complete ? "complete" : dueDate < today ? "overdue" : "upcoming",
        matchedTransactionId: match?.id ?? null,
        isIncome,
      });
      if (isIncome) addToBucket(totals.income, amount, complete);
      else if (stream.isCreditAccount) addToBucket(totals.creditCards, amount, complete);
      else addToBucket(totals.expenses, amount, complete);
    }
  }

  for (const item of manualItems) {
    if (!item.enabled) continue;
    const cadence = MANUAL_CADENCE[item.frequency];
    const dueDates = occurrenceDatesInWindow(item.nextDate, cadence, windowStart, windowEndExclusive);
    const amount = Math.abs(item.amount);
    const isIncome = item.itemType === "income";

    for (const dueDate of dueDates) {
      const complete = false; // Manual items have no linked transaction to confirm against.
      occurrences.push({
        source: "manual",
        sourceId: item.id,
        merchant: item.name,
        frequency: MANUAL_FREQUENCY_LABELS[item.frequency],
        dueDate,
        account: null,
        category: item.category,
        amount,
        status: dueDate < today ? "overdue" : "upcoming",
        matchedTransactionId: null,
        isIncome,
      });
      if (isIncome) addToBucket(totals.income, amount, complete);
      else addToBucket(totals.expenses, amount, complete);
    }
  }

  occurrences.sort(
    (a, b) => a.dueDate.localeCompare(b.dueDate) || a.merchant.localeCompare(b.merchant),
  );

  return {
    month,
    occurrences,
    totals,
    reviewCount: countUnreviewedStreams(streams),
  };
}
```

- [ ] **Step 6: Run to verify all tests pass**

Run: `npx vitest run tests/unit/recurring-page.test.ts`
Expected: PASS (all cases from Task 3 and Task 4).

- [ ] **Step 7: Commit**

```bash
git add lib/recurring-page.ts tests/unit/recurring-page.test.ts
git commit -m "feat(recurring): expand streams and manual items into monthly occurrences"
```

---

## Task 5: `lib/recurring.ts` — persist occurrence fields and resolve transaction joins

**Files:**
- Modify: `lib/recurring.ts`
- Modify: `tests/unit/recurring-lib.test.ts` (existing file — read it first to match its current mocking style before extending)

**Interfaces:**
- Consumes: `TransactionStream` fields `account_id`, `first_date`, `last_date`, `predicted_next_date`, `transaction_ids` (all present on the installed `plaid` SDK's `TransactionStream` interface).
- Produces: `refreshRecurringForItem` now also writes `recurring_streams.account_id/first_date/last_date/predicted_next_date` and replaces `recurring_stream_transactions` rows per stream; unchanged public signature.

- [ ] **Step 1: Read the existing test file's mocking pattern**

Open `tests/unit/recurring-lib.test.ts` and note how `createServiceClient`, `getPlaidClient`, and `decryptItemToken` are currently mocked — the new tests must extend that same `vi.mock` setup rather than introduce a second one.

- [ ] **Step 2: Write a failing test for account resolution and occurrence-field persistence**

```typescript
it("resolves the stream's Plaid account id to the local account and persists occurrence fields", async () => {
  // Arrange the same way the existing "refreshes recurring streams" test
  // does, but add a resolvable accounts row and occurrence fields on the
  // Plaid stream fixture:
  //   accounts table mock returns [{ id: "local-acct-1", plaid_account_id: "plaid-acct-1" }]
  //   the outflow stream fixture includes account_id: "plaid-acct-1",
  //   first_date: "2026-01-15", last_date: "2026-06-15",
  //   predicted_next_date: "2026-07-15", transaction_ids: []
  // Act: call refreshRecurringForItem(item)
  // Assert: the upsert payload passed to .from("recurring_streams").upsert(...)
  // contains { account_id: "local-acct-1", first_date: "2026-01-15",
  // last_date: "2026-06-15", predicted_next_date: "2026-07-15" } for that row.
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run tests/unit/recurring-lib.test.ts -t "resolves the stream's Plaid account id"`
Expected: FAIL — upsert payload lacks `account_id`/occurrence fields (current `mapStreamRow` doesn't set them).

- [ ] **Step 4: Extend `mapStreamRow` and `refreshRecurringForItem`**

```typescript
function mapStreamRow(
  userId: string,
  itemDbId: string,
  streamType: "inflow" | "outflow",
  stream: TransactionStream,
  accountIdByPlaidId: Map<string, string>,
) {
  return {
    user_id: userId,
    plaid_item_id: itemDbId,
    stream_id: stream.stream_id,
    stream_type: streamType,
    description: stream.description ?? null,
    merchant_name: stream.merchant_name ?? null,
    average_amount: stream.average_amount?.amount ?? null,
    last_amount: stream.last_amount?.amount ?? null,
    frequency: stream.frequency ?? null,
    status: stream.status ?? null,
    category: stream.personal_finance_category?.primary ?? null,
    is_active: stream.is_active ?? true,
    account_id: accountIdByPlaidId.get(stream.account_id) ?? null,
    first_date: stream.first_date ?? null,
    last_date: stream.last_date ?? null,
    predicted_next_date: stream.predicted_next_date ?? null,
  };
}

/** Local transaction ids matching a chunk of Plaid transaction ids. */
async function resolveLocalTransactionIds(
  supabase: ReturnType<typeof createServiceClient>,
  userId: string,
  plaidTransactionIds: string[],
): Promise<Map<string, string>> {
  const byPlaidId = new Map<string, string>();
  for (let i = 0; i < plaidTransactionIds.length; i += 500) {
    const chunk = plaidTransactionIds.slice(i, i + 500);
    if (chunk.length === 0) continue;
    const { data, error } = await supabase
      .from("transactions")
      .select("id, plaid_transaction_id")
      .eq("user_id", userId)
      .in("plaid_transaction_id", chunk);
    if (error) throw error;
    for (const row of data ?? []) {
      byPlaidId.set(row.plaid_transaction_id as string, row.id as string);
    }
  }
  return byPlaidId;
}

export async function refreshRecurringForItem(item: PlaidItemRow): Promise<number> {
  const plaid = getPlaidClient();
  const accessToken = decryptItemToken(item);

  const response = await plaid.transactionsRecurringGet({
    access_token: accessToken,
  });

  const supabase = createServiceClient();

  const { data: accountRows } = await supabase
    .from("accounts")
    .select("id, plaid_account_id")
    .eq("user_id", item.user_id);
  const accountIdByPlaidId = new Map(
    (accountRows ?? []).map((row) => [row.plaid_account_id as string, row.id as string]),
  );

  const tagged = [
    ...response.data.inflow_streams.map((s) => ({ stream: s, type: "inflow" as const })),
    ...response.data.outflow_streams.map((s) => ({ stream: s, type: "outflow" as const })),
  ];
  const rows = tagged.map(({ stream, type }) =>
    mapStreamRow(item.user_id, item.id, type, stream, accountIdByPlaidId),
  );

  if (rows.length === 0) return 0;

  // Snapshot stored amounts before the upsert overwrites them. Service
  // client bypasses RLS, so both filters are load-bearing.
  const { data: existing } = await supabase
    .from("recurring_streams")
    .select("stream_id, last_amount")
    .eq("user_id", item.user_id)
    .eq("plaid_item_id", item.id);

  const { data: upserted, error } = await supabase
    .from("recurring_streams")
    .upsert(rows, { onConflict: "stream_id" })
    .select("id, stream_id");
  if (error) throw error;

  // Mark-and-sweep: a stream that existed for this item but is absent from
  // this full, successful response is no longer current. This only runs
  // after the fetch and upsert above succeeded — a thrown error above skips
  // straight past this block, so a failed or partial refresh changes nothing.
  const currentStreamIds = new Set(rows.map((row) => row.stream_id));
  const staleStreamIds = (existing ?? [])
    .map((row) => row.stream_id as string)
    .filter((streamId) => !currentStreamIds.has(streamId));
  if (staleStreamIds.length > 0) {
    await supabase
      .from("recurring_streams")
      .update({ is_active: false })
      .eq("user_id", item.user_id)
      .in("stream_id", staleStreamIds);
  }

  // Resolve each stream's Plaid transaction ids to local rows and replace
  // the join table's rows for that stream. Ids that don't resolve (older,
  // pruned transactions) are counted safely and simply omitted.
  const localStreamIdByPlaidStreamId = new Map(
    (upserted ?? []).map((row) => [row.stream_id as string, row.id as string]),
  );
  const allPlaidTransactionIds = [
    ...new Set(tagged.flatMap(({ stream }) => stream.transaction_ids)),
  ];
  const localTransactionIdByPlaidId = await resolveLocalTransactionIds(
    supabase,
    item.user_id,
    allPlaidTransactionIds,
  );

  for (const { stream } of tagged) {
    const recurringStreamId = localStreamIdByPlaidStreamId.get(stream.stream_id);
    if (!recurringStreamId) continue;
    const localTransactionIds = stream.transaction_ids
      .map((plaidId) => localTransactionIdByPlaidId.get(plaidId))
      .filter((id): id is string => Boolean(id));

    await supabase
      .from("recurring_stream_transactions")
      .delete()
      .eq("recurring_stream_id", recurringStreamId);
    if (localTransactionIds.length > 0) {
      await supabase.from("recurring_stream_transactions").insert(
        localTransactionIds.map((transactionId) => ({
          user_id: item.user_id,
          recurring_stream_id: recurringStreamId,
          transaction_id: transactionId,
        })),
      );
    }
  }

  // Diff only when history exists — the first refresh seeds silently
  // instead of announcing every pre-existing subscription as "new".
  const previous = (existing ?? []).map((row) => ({
    streamId: row.stream_id as string,
    lastAmount: row.last_amount === null ? null : Number(row.last_amount),
  }));
  if (previous.length > 0) {
    const diff = diffRecurringStreams(
      previous,
      rows.map((row) => ({
        streamId: row.stream_id,
        streamType: row.stream_type,
        name: row.merchant_name ?? row.description ?? "Unknown",
        lastAmount: row.last_amount,
        isActive: row.is_active,
      })),
    );
    await notifyRecurringChanges(item.user_id, diff);
  }

  return rows.length;
}
```

- [ ] **Step 5: Run to verify the new test passes and nothing else regressed**

Run: `npx vitest run tests/unit/recurring-lib.test.ts`
Expected: PASS, including the pre-existing tests (price-hike/new-subscription notifications, empty-response short-circuit).

- [ ] **Step 6: Add a mark-and-sweep regression test**

```typescript
it("deactivates a stream missing from a full successful response without touching a failed refresh", async () => {
  // Arrange: existing rows include stream_id "gone-stream" (is_active true);
  // the new Plaid response omits it entirely.
  // Act: call refreshRecurringForItem(item).
  // Assert: .from("recurring_streams").update({ is_active: false }) was
  // called with .in("stream_id", ["gone-stream"]).
});

it("never calls the deactivation update when the Plaid call throws", async () => {
  // Arrange: plaid.transactionsRecurringGet rejects.
  // Act + Assert: refreshRecurringForItem(item) rejects, and
  // .from("recurring_streams").update was never called.
});
```

- [ ] **Step 7: Run full file, then commit**

Run: `npx vitest run tests/unit/recurring-lib.test.ts` → PASS.

```bash
git add lib/recurring.ts tests/unit/recurring-lib.test.ts
git commit -m "feat(recurring): persist occurrence anchors and resolve transaction joins"
```

---

## Task 6: `lib/recurring-data.ts` — scoped loader

**Files:**
- Create: `lib/recurring-data.ts`
- Test: `tests/unit/recurring-data.test.ts`

**Interfaces:**
- Consumes: `expandStreamsForMonth`, `RecurringStreamInput`, `ManualRecurringItemInput` from `lib/recurring-page.ts`; `parseFinancialScope`, `scopeQueryUserId` from `lib/financial-scope.ts`; `groupKeyFor` from `lib/accounts-page.ts`; `clientStub` from `tests/fixtures/supabase-query.ts`.
- Produces:

```typescript
export interface RecurringLoadResult {
  view: RecurringMonth;
  scope: FinancialScope;
  visibleHouseholdIds: string[];
  allStreams: RecurringStreamRow[]; // for the "All" manage list, unfiltered by month
  manualItems: ManualRecurringItemRow[];
  stale: boolean;
}

export interface RecurringStreamRow {
  id: string;
  merchantName: string | null;
  description: string | null;
  streamType: "inflow" | "outflow";
  status: RecurringStreamStatus;
  isActive: boolean;
  reviewedAt: string | null;
  dismissedAt: string | null;
  userAmount: number | null;
  averageAmount: number | null;
  accountName: string | null;
}

export interface ManualRecurringItemRow {
  id: string;
  name: string;
  amount: number;
  frequency: ManualRecurringFrequency;
  nextDate: string;
  itemType: "income" | "expense";
  category: string | null;
  enabled: boolean;
}

export async function loadRecurringData(
  supabase: SupabaseClient,
  input: { userId: string; anchorMonth: string; rawScope?: string | string[]; now?: Date },
): Promise<RecurringLoadResult>;
```

- [ ] **Step 1: Write a failing unit test using `clientStub`**

```typescript
import { describe, expect, it } from "vitest";
import { loadRecurringData } from "@/lib/recurring-data";
import { clientStub } from "../fixtures/supabase-query";

function makeClient(overrides: Record<string, { data?: unknown; error?: unknown }> = {}) {
  return clientStub({
    households: { data: [] },
    recurring_streams: {
      data: [
        {
          id: "stream-1",
          merchant_name: "Netflix",
          description: null,
          stream_type: "outflow",
          status: "MATURE",
          is_active: true,
          reviewed_at: "2026-01-01T00:00:00Z",
          dismissed_at: null,
          user_amount: null,
          average_amount: 15.49,
          last_amount: 15.49,
          frequency: "MONTHLY",
          first_date: "2026-01-15",
          last_date: "2026-06-15",
          predicted_next_date: "2026-07-15",
          account_id: "account-1",
        },
      ],
    },
    recurring_stream_transactions: { data: [] },
    manual_recurring_items: { data: [] },
    accounts: { data: [{ id: "account-1", name: "Checking", type: "depository", subtype: null }] },
    sync_jobs: { data: null },
    ...overrides,
  });
}

describe("loadRecurringData", () => {
  it("scopes every query to the requesting user in mine scope", async () => {
    const client = makeClient();
    const result = await loadRecurringData(client as never, {
      userId: "user-1",
      anchorMonth: "2026-07",
    });
    expect(client.scopedToUser("recurring_streams", "user-1")).toBe(true);
    expect(client.scopedToUser("manual_recurring_items", "user-1")).toBe(true);
    expect(result.view.occurrences).toHaveLength(1);
    expect(result.view.occurrences[0]!.merchant).toBe("Netflix");
  });

  it("reports stale when the newest done sync job is more than 48h old", async () => {
    const client = makeClient({
      sync_jobs: { data: { updated_at: "2020-01-01T00:00:00Z" } },
    });
    const result = await loadRecurringData(client as never, {
      userId: "user-1",
      anchorMonth: "2026-07",
      now: new Date("2026-07-20T00:00:00Z"),
    });
    expect(result.stale).toBe(true);
  });

  it("marks a stream's occurrences against a credit account in the creditCards bucket", async () => {
    const client = makeClient({
      accounts: { data: [{ id: "account-1", name: "Card", type: "credit", subtype: "credit card" }] },
    });
    const result = await loadRecurringData(client as never, {
      userId: "user-1",
      anchorMonth: "2026-07",
    });
    expect(result.view.totals.creditCards.remaining).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/recurring-data.test.ts`
Expected: FAIL — module `@/lib/recurring-data` doesn't exist.

- [ ] **Step 3: Implement the loader**

```typescript
import type { SupabaseClient } from "@supabase/supabase-js";
import { groupKeyFor } from "@/lib/accounts-page";
import {
  parseFinancialScope,
  scopeQueryUserId,
  type FinancialScope,
} from "@/lib/financial-scope";
import {
  expandStreamsForMonth,
  type ManualRecurringFrequency,
  type ManualRecurringItemInput,
  type RecurringMonth,
  type RecurringStreamInput,
  type RecurringStreamStatus,
} from "@/lib/recurring-page";

const DEPENDENCY_LIMIT = 5_000;

interface RecurringStreamRawRow {
  id: string;
  merchant_name: string | null;
  description: string | null;
  stream_type: "inflow" | "outflow";
  status: RecurringStreamStatus | null;
  is_active: boolean;
  reviewed_at: string | null;
  dismissed_at: string | null;
  user_amount: number | string | null;
  average_amount: number | string | null;
  last_amount: number | string | null;
  frequency: string | null;
  first_date: string | null;
  last_date: string | null;
  predicted_next_date: string | null;
  account_id: string | null;
}

export interface RecurringStreamRow {
  id: string;
  merchantName: string | null;
  description: string | null;
  streamType: "inflow" | "outflow";
  status: RecurringStreamStatus;
  isActive: boolean;
  reviewedAt: string | null;
  dismissedAt: string | null;
  userAmount: number | null;
  averageAmount: number | null;
  accountName: string | null;
}

export interface ManualRecurringItemRow {
  id: string;
  name: string;
  amount: number;
  frequency: ManualRecurringFrequency;
  nextDate: string;
  itemType: "income" | "expense";
  category: string | null;
  enabled: boolean;
}

interface ManualRecurringRawRow {
  id: string;
  name: string;
  amount: number | string;
  frequency: string;
  next_date: string;
  item_type: "income" | "expense";
  category: string | null;
  enabled: boolean;
}

interface AccountRow {
  id: string;
  name: string | null;
  type: string | null;
  subtype: string | null;
}

interface JoinRow {
  recurring_stream_id: string;
  transaction_id: string;
}

interface TransactionDateRow {
  id: string;
  date: string;
}

interface SyncRow {
  updated_at: string;
}

export interface RecurringLoadResult {
  view: RecurringMonth;
  scope: FinancialScope;
  visibleHouseholdIds: string[];
  allStreams: RecurringStreamRow[];
  manualItems: ManualRecurringItemRow[];
  stale: boolean;
}

function assertRecurringQuery(table: string, result: { error: { code?: string } | null }): void {
  if (!result.error) return;
  const code = result.error.code ? `:${result.error.code}` : "";
  throw new Error(`recurring_query_failed:${table}${code}`);
}

function isStale(lastSuccessfulSyncAt: string | null, now: Date): boolean {
  if (!lastSuccessfulSyncAt) return true;
  const parsed = Date.parse(lastSuccessfulSyncAt);
  return !Number.isFinite(parsed) || now.getTime() - parsed > 48 * 60 * 60 * 1000;
}

const KNOWN_FREQUENCIES = new Set(["WEEKLY", "BIWEEKLY", "SEMI_MONTHLY", "MONTHLY", "ANNUALLY"]);
const KNOWN_STATUSES = new Set(["MATURE", "EARLY_DETECTION", "TOMBSTONED"]);

export async function loadRecurringData(
  supabase: SupabaseClient,
  input: {
    userId: string;
    anchorMonth: string;
    rawScope?: string | string[];
    now?: Date;
  },
): Promise<RecurringLoadResult> {
  const householdResult = await supabase.from("households").select("id").limit(DEPENDENCY_LIMIT);
  assertRecurringQuery("households", householdResult);
  const visibleHouseholdIds = (householdResult.data ?? []).map((row) => row.id as string);
  const scope = parseFinancialScope({
    raw: input.rawScope,
    ownerUserId: input.userId,
    visibleHouseholdIds,
  });
  const userId = scopeQueryUserId(scope);

  let streamsQuery = supabase
    .from("recurring_streams")
    .select(
      "id,merchant_name,description,stream_type,status,is_active,reviewed_at,dismissed_at,user_amount,average_amount,last_amount,frequency,first_date,last_date,predicted_next_date,account_id",
    )
    .limit(DEPENDENCY_LIMIT);
  let manualQuery = supabase
    .from("manual_recurring_items")
    .select("id,name,amount,frequency,next_date,item_type,category,enabled")
    .limit(DEPENDENCY_LIMIT);
  let accountsQuery = supabase.from("accounts").select("id,name,type,subtype").limit(DEPENDENCY_LIMIT);
  let syncQuery = supabase
    .from("sync_jobs")
    .select("updated_at")
    .eq("status", "done")
    .order("updated_at", { ascending: false })
    .limit(1);

  if (userId) {
    streamsQuery = streamsQuery.eq("user_id", userId);
    manualQuery = manualQuery.eq("user_id", userId);
    accountsQuery = accountsQuery.eq("user_id", userId);
    syncQuery = syncQuery.eq("user_id", userId);
  }

  const [streamsResult, manualResult, accountsResult, syncResult] = await Promise.all([
    streamsQuery,
    manualQuery,
    accountsQuery,
    syncQuery.maybeSingle(),
  ]);
  assertRecurringQuery("recurring_streams", streamsResult);
  assertRecurringQuery("manual_recurring_items", manualResult);
  assertRecurringQuery("accounts", accountsResult);
  assertRecurringQuery("sync_jobs", syncResult);

  const streamRows = (streamsResult.data ?? []) as RecurringStreamRawRow[];
  const streamIds = streamRows.map((row) => row.id);

  let joinRows: JoinRow[] = [];
  for (let i = 0; i < streamIds.length; i += 500) {
    const chunk = streamIds.slice(i, i + 500);
    if (chunk.length === 0) continue;
    let joinQuery = supabase
      .from("recurring_stream_transactions")
      .select("recurring_stream_id,transaction_id")
      .in("recurring_stream_id", chunk)
      .limit(DEPENDENCY_LIMIT);
    if (userId) joinQuery = joinQuery.eq("user_id", userId);
    const joinResult = await joinQuery;
    assertRecurringQuery("recurring_stream_transactions", joinResult);
    joinRows = joinRows.concat((joinResult.data ?? []) as JoinRow[]);
  }

  const transactionIds = [...new Set(joinRows.map((row) => row.transaction_id))];
  let transactionDatesById = new Map<string, string>();
  for (let i = 0; i < transactionIds.length; i += 500) {
    const chunk = transactionIds.slice(i, i + 500);
    if (chunk.length === 0) continue;
    let txnQuery = supabase.from("transactions").select("id,date").in("id", chunk).limit(500);
    if (userId) txnQuery = txnQuery.eq("user_id", userId);
    const txnResult = await txnQuery;
    assertRecurringQuery("transactions", txnResult);
    for (const row of (txnResult.data ?? []) as TransactionDateRow[]) {
      transactionDatesById.set(row.id, row.date);
    }
  }

  const matchedByStreamId = new Map<string, { id: string; date: string }[]>();
  for (const row of joinRows) {
    const date = transactionDatesById.get(row.transaction_id);
    if (!date) continue;
    const existing = matchedByStreamId.get(row.recurring_stream_id) ?? [];
    existing.push({ id: row.transaction_id, date });
    matchedByStreamId.set(row.recurring_stream_id, existing);
  }

  const accountById = new Map(
    ((accountsResult.data ?? []) as AccountRow[]).map((row) => [row.id, row]),
  );

  const streamInputs: RecurringStreamInput[] = streamRows.map((row) => {
    const account = row.account_id ? accountById.get(row.account_id) : undefined;
    const frequency = KNOWN_FREQUENCIES.has(row.frequency ?? "")
      ? (row.frequency as RecurringStreamInput["frequency"])
      : "UNKNOWN";
    const status = KNOWN_STATUSES.has(row.status ?? "")
      ? (row.status as RecurringStreamStatus)
      : "UNKNOWN";
    return {
      id: row.id,
      streamType: row.stream_type,
      merchantName: row.merchant_name,
      description: row.description,
      averageAmount: row.average_amount === null ? null : Number(row.average_amount),
      lastAmount: row.last_amount === null ? null : Number(row.last_amount),
      userAmount: row.user_amount === null ? null : Number(row.user_amount),
      frequency,
      status,
      isActive: row.is_active,
      accountName: account?.name ?? null,
      isCreditAccount: account ? groupKeyFor(account.type, account.subtype) === "credit" : false,
      firstDate: row.first_date,
      lastDate: row.last_date,
      predictedNextDate: row.predicted_next_date,
      reviewedAt: row.reviewed_at,
      dismissedAt: row.dismissed_at,
      matchedTransactions: matchedByStreamId.get(row.id) ?? [],
    };
  });

  const manualRows = (manualResult.data ?? []) as ManualRecurringRawRow[];
  const manualInputs: ManualRecurringItemInput[] = manualRows.map((row) => ({
    id: row.id,
    name: row.name,
    amount: Number(row.amount),
    frequency: row.frequency as ManualRecurringFrequency,
    nextDate: row.next_date,
    itemType: row.item_type,
    category: row.category,
    enabled: row.enabled,
  }));

  const lastSuccessfulSyncAt =
    ((syncResult.data as SyncRow | null)?.updated_at as string | undefined) ?? null;

  return {
    view: expandStreamsForMonth(
      streamInputs,
      manualInputs,
      input.anchorMonth,
      (input.now ?? new Date()).toISOString().slice(0, 10),
    ),
    scope,
    visibleHouseholdIds,
    allStreams: streamRows.map((row) => ({
      id: row.id,
      merchantName: row.merchant_name,
      description: row.description,
      streamType: row.stream_type,
      status: KNOWN_STATUSES.has(row.status ?? "") ? (row.status as RecurringStreamStatus) : "UNKNOWN",
      isActive: row.is_active,
      reviewedAt: row.reviewed_at,
      dismissedAt: row.dismissed_at,
      userAmount: row.user_amount === null ? null : Number(row.user_amount),
      averageAmount: row.average_amount === null ? null : Number(row.average_amount),
      accountName: row.account_id ? accountById.get(row.account_id)?.name ?? null : null,
    })),
    manualItems: manualInputs,
    stale: isStale(lastSuccessfulSyncAt, input.now ?? new Date()),
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/unit/recurring-data.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/recurring-data.ts tests/unit/recurring-data.test.ts
git commit -m "feat(recurring): add scoped data loader for the recurring page"
```

---

## Task 7: `lib/feature-flags.ts` — add `recurringPage`

**Files:**
- Modify: `lib/feature-flags.ts`
- Modify: `tests/unit/feature-flags.test.ts` (read it first; extend its existing table-driven assertions)

- [ ] **Step 1: Write a failing test**

```typescript
it("includes recurringPage in the default flag set, enabled", () => {
  expect(FEATURE_FLAG_DEFAULTS.recurringPage).toBe(true);
  expect(isFeatureEnabled("recurringPage")).toBe(true);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/feature-flags.test.ts` → FAIL, `recurringPage` is not a known key (TypeScript error surfaces as a test failure once `tsc` runs, and the runtime property is `undefined`).

- [ ] **Step 3: Implement**

```typescript
export const FEATURE_FLAG_DEFAULTS = {
  accountsPage: true,
  cashFlowPage: true,
  budgetPage: true,
  recurringPage: true,
} as const;
```

- [ ] **Step 4: Run to verify it passes, then commit**

Run: `npx vitest run tests/unit/feature-flags.test.ts` → PASS.

```bash
git add lib/feature-flags.ts tests/unit/feature-flags.test.ts
git commit -m "feat(recurring): add recurringPage feature flag"
```

---

## Task 8: Icon, nav entry, sidebar badge

**Files:**
- Modify: `components/ui/icons.tsx`
- Modify: `components/shell/nav-model.ts`
- Modify: `components/shell/AppSidebar.tsx`
- Modify: `tests/unit/sidebar-nav.test.ts` (existing — extend its table-driven item assertions)
- Create: `tests/unit/recurring-badge.test.ts`

**Interfaces:**
- Consumes: `countUnreviewedStreams` from `lib/recurring-page.ts`.
- Produces: `NAV_ITEMS` includes a `recurring` entry with `featureFlag: "recurringPage"`; `AppSidebar` renders a numeric badge on that link when unreviewed streams exist.

- [ ] **Step 1: Write a failing nav-model test**

```typescript
it("includes a recurring entry gated by recurringPage in the planning category", () => {
  const recurring = NAV_ITEMS.find((item) => item.key === "recurring");
  expect(recurring).toBeDefined();
  expect(recurring!.category).toBe("planning");
  expect(recurring!.featureFlag).toBe("recurringPage");
  expect(recurring!.href).toBe("/recurring");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/sidebar-nav.test.ts -t recurring` → FAIL, no such entry.

- [ ] **Step 3: Add the `Repeat` icon and the nav entry**

```typescript
// components/ui/icons.tsx — add to the existing named re-export list, alphabetically:
  Repeat,
```

```typescript
// components/shell/nav-model.ts
import {
  ArrowLeftRight,
  Landmark,
  LayoutDashboard,
  Mail,
  PiggyBank,
  Repeat,
  Search,
  Settings,
  Sparkles,
  Target,
  Wallet,
} from "@/components/ui/icons";

export type NavItemKey =
  | "dashboard"
  | "accounts"
  | "transactions"
  | "cashflow"
  | "reports"
  | "budget"
  | "recurring"
  | "goals"
  | "investments"
  | "forecasting"
  | "advice"
  | "settings"
  | "notifications"
  | "wrapped";

export const NAV_ITEMS: NavItemDefinition[] = [
  { key: "dashboard", label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, category: "primary", hint: "Monitor, plan, and wealth views" },
  { key: "accounts", label: "Accounts", href: "/accounts", icon: Landmark, category: "primary", featureFlag: "accountsPage", hint: "Grouped balances and history" },
  { key: "transactions", label: "Transactions", href: "/transactions", icon: Wallet, category: "primary", hint: "Ledger" },
  { key: "cashflow", label: "Cash Flow", href: "/cash-flow", icon: ArrowLeftRight, category: "primary", featureFlag: "cashFlowPage", hint: "Income, expenses, savings rate" },
  { key: "budget", label: "Budget", href: "/budget", icon: PiggyBank, category: "planning", featureFlag: "budgetPage", hint: "Monthly envelopes" },
  { key: "recurring", label: "Recurring", href: "/recurring", icon: Repeat, category: "planning", featureFlag: "recurringPage", hint: "Bills, subscriptions, and income" },
  { key: "goals", label: "Goals", href: "/goals", icon: Target, category: "planning", hint: "Savings goals" },
  { key: "notifications", label: "Notifications", href: "/notifications", icon: Mail, category: "manage", hint: "Alerts and digests" },
  { key: "settings", label: "Settings", href: "/settings", icon: Settings, category: "manage", hint: "Control center" },
  { key: "wrapped", label: "Year in Money", href: "/wrapped", icon: Sparkles, category: "manage", hint: "Annual recap" },
];
```

- [ ] **Step 4: Run to verify the nav-model test passes**

Run: `npx vitest run tests/unit/sidebar-nav.test.ts` → PASS (including pre-existing order/uniqueness/parity assertions, since `recurring` slots into the existing `planning` category checked by those tests).

- [ ] **Step 5: Write a failing test for the sidebar badge**

```typescript
// tests/unit/recurring-badge.test.ts
import { describe, expect, it } from "vitest";
import { countUnreviewedStreams } from "@/lib/recurring-page";

describe("sidebar recurring badge count", () => {
  it("is the same countUnreviewedStreams used by the page, not a re-derived query", () => {
    const count = countUnreviewedStreams([
      { isActive: true, status: "MATURE", dismissedAt: null, reviewedAt: null },
    ]);
    expect(count).toBe(1);
  });
});
```

This documents the invariant `AppSidebar` must uphold (Step 6 below): it calls the shared pure counter over a fresh minimal query rather than re-deriving "unreviewed" some other way.

- [ ] **Step 6: Wire the badge into `AppSidebar`**

```typescript
// components/shell/AppSidebar.tsx — add near the existing collapse-state read:
import { countUnreviewedStreams } from "@/lib/recurring-page";

// Inside AppSidebar, after resolving `user`:
let unreviewedRecurringCount = 0;
if (user) {
  const { data: reviewRows } = await supabase
    .from("recurring_streams")
    .select("is_active,status,dismissed_at,reviewed_at")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .eq("status", "MATURE")
    .is("dismissed_at", null)
    .is("reviewed_at", null);
  unreviewedRecurringCount = countUnreviewedStreams(
    (reviewRows ?? []).map((row) => ({
      isActive: row.is_active,
      status: row.status,
      dismissedAt: row.dismissed_at,
      reviewedAt: row.reviewed_at,
    })),
  );
}
```

Extend `NavLink` to accept an optional `badge?: number` prop and render it next to the label (same visual language as `NotificationsBell`'s badge: `bg-danger`, white text, `9+` cap), then pass `badge={item.key === "recurring" ? unreviewedRecurringCount : undefined}` when rendering each planning item.

- [ ] **Step 7: Run the full sidebar/badge test files, then commit**

Run: `npx vitest run tests/unit/sidebar-nav.test.ts tests/unit/recurring-badge.test.ts` → PASS.

```bash
git add components/ui/icons.tsx components/shell/nav-model.ts components/shell/AppSidebar.tsx tests/unit/sidebar-nav.test.ts tests/unit/recurring-badge.test.ts
git commit -m "feat(recurring): add nav entry and unreviewed-stream sidebar badge"
```

---

## Task 9: `app/api/recurring/route.ts` — stream review/dismiss/restore/amount

**Files:**
- Create: `app/api/recurring/route.ts`
- Test: `tests/unit/recurring-route.test.ts`

**Interfaces:**
- Consumes: `requireUser`, `badRequest`, `errorResponse` from `lib/http.ts`; `writeAudit` from `lib/audit.ts` (add `"recurring_stream_reviewed" | "recurring_stream_dismissed" | "recurring_stream_restored" | "recurring_stream_amount_corrected"` to `AuditAction`).
- Produces: `PATCH /api/recurring` — body `{ stream_id: string; action: "review" | "dismiss" | "restore" | "correct_amount"; amount?: number }`.

- [ ] **Step 1: Add the four new audit actions**

```typescript
// lib/audit.ts — extend the AuditAction union:
  | "recurring_stream_reviewed"
  | "recurring_stream_dismissed"
  | "recurring_stream_restored"
  | "recurring_stream_amount_corrected";
```

- [ ] **Step 2: Write failing route tests**

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { PATCH } from "@/app/api/recurring/route";
import { writeAudit } from "@/lib/audit";
import { requireUser } from "@/lib/http";
import { clientStub } from "../fixtures/supabase-query";

vi.mock("@/lib/http", async () => {
  const actual = await vi.importActual<typeof import("@/lib/http")>("@/lib/http");
  return { ...actual, requireUser: vi.fn() };
});
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn() }));

const STREAM_ID = "123e4567-e89b-12d3-a456-426614174000";

function request(body: unknown): Request {
  return new Request("http://localhost/api/recurring", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("PATCH /api/recurring", () => {
  let client: ReturnType<typeof clientStub>;

  beforeEach(() => {
    vi.clearAllMocks();
    client = clientStub({
      recurring_streams: { data: [{ id: STREAM_ID, user_id: "user-1" }] },
    });
    vi.mocked(requireUser).mockResolvedValue({
      user: { id: "user-1", email: "test@example.com" },
      supabase: client as never,
    } as never);
  });

  it("rejects an unknown action", async () => {
    const response = await PATCH(request({ stream_id: STREAM_ID, action: "delete" }));
    expect(response.status).toBe(400);
  });

  it("rejects a malformed stream_id", async () => {
    const response = await PATCH(request({ stream_id: "not-a-uuid", action: "review" }));
    expect(response.status).toBe(400);
  });

  it("sets reviewed_at on review and audits it", async () => {
    const response = await PATCH(request({ stream_id: STREAM_ID, action: "review" }));
    expect(response.status).toBe(200);
    const written = client.writtenTo("recurring_streams") as Record<string, unknown>;
    expect(written.reviewed_at).toEqual(expect.any(String));
    expect(client.scopedToUser("recurring_streams", "user-1")).toBe(true);
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "recurring_stream_reviewed" }),
    );
  });

  it("sets dismissed_at on dismiss", async () => {
    await PATCH(request({ stream_id: STREAM_ID, action: "dismiss" }));
    const written = client.writtenTo("recurring_streams") as Record<string, unknown>;
    expect(written.dismissed_at).toEqual(expect.any(String));
  });

  it("clears dismissed_at on restore", async () => {
    await PATCH(request({ stream_id: STREAM_ID, action: "restore" }));
    const written = client.writtenTo("recurring_streams") as Record<string, unknown>;
    expect(written.dismissed_at).toBeNull();
  });

  it("requires a non-negative amount for correct_amount", async () => {
    const response = await PATCH(
      request({ stream_id: STREAM_ID, action: "correct_amount", amount: -5 }),
    );
    expect(response.status).toBe(400);
  });

  it("sets user_amount on correct_amount", async () => {
    await PATCH(request({ stream_id: STREAM_ID, action: "correct_amount", amount: 19.99 }));
    const written = client.writtenTo("recurring_streams") as Record<string, unknown>;
    expect(written.user_amount).toBe(19.99);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/unit/recurring-route.test.ts`
Expected: FAIL — `app/api/recurring/route.ts` doesn't exist.

- [ ] **Step 4: Implement**

```typescript
import { NextResponse } from "next/server";
import { badRequest, errorResponse, requireUser } from "@/lib/http";
import { writeAudit, type AuditAction } from "@/lib/audit";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIONS = ["review", "dismiss", "restore", "correct_amount"] as const;
type RecurringAction = (typeof ACTIONS)[number];

const AUDIT_ACTION_FOR: Record<RecurringAction, AuditAction> = {
  review: "recurring_stream_reviewed",
  dismiss: "recurring_stream_dismissed",
  restore: "recurring_stream_restored",
  correct_amount: "recurring_stream_amount_corrected",
};

interface PatchBody {
  stream_id: string;
  action: RecurringAction;
  amount?: number;
}

function hasAtMostTwoDecimals(value: number): boolean {
  return Math.abs(value * 100 - Math.round(value * 100)) < Number.EPSILON * 100;
}

function parseBody(value: unknown): { ok: true; value: PatchBody } | { ok: false; message: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, message: "Invalid JSON payload" };
  }
  const body = value as Record<string, unknown>;
  if (typeof body.stream_id !== "string" || !UUID_REGEX.test(body.stream_id)) {
    return { ok: false, message: "Invalid stream_id" };
  }
  if (typeof body.action !== "string" || !ACTIONS.includes(body.action as RecurringAction)) {
    return { ok: false, message: "Invalid action" };
  }
  if (body.action === "correct_amount") {
    if (
      typeof body.amount !== "number" ||
      !Number.isFinite(body.amount) ||
      body.amount < 0 ||
      !hasAtMostTwoDecimals(body.amount)
    ) {
      return { ok: false, message: "Invalid amount" };
    }
  }
  return {
    ok: true,
    value: {
      stream_id: body.stream_id,
      action: body.action as RecurringAction,
      amount: body.amount as number | undefined,
    },
  };
}

function patchFor(action: RecurringAction, amount: number | undefined): Record<string, unknown> {
  const now = new Date().toISOString();
  if (action === "review") return { reviewed_at: now };
  if (action === "dismiss") return { dismissed_at: now };
  if (action === "restore") return { dismissed_at: null };
  return { user_amount: amount };
}

export async function PATCH(request: Request) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { supabase, user } = auth;

  try {
    const parsed = parseBody(await request.json().catch(() => null));
    if (!parsed.ok) return badRequest(parsed.message);
    const { stream_id: streamId, action, amount } = parsed.value;

    const { data, error } = await supabase
      .from("recurring_streams")
      .update(patchFor(action, amount))
      .eq("id", streamId)
      .eq("user_id", user.id)
      .select("id")
      .maybeSingle();
    if (error) return errorResponse("recurring.update", error);
    if (!data) {
      return NextResponse.json({ error: "Recurring stream not found" }, { status: 404 });
    }

    await writeAudit({
      userId: user.id,
      action: AUDIT_ACTION_FOR[action],
      metadata: { stream_id: streamId },
    });

    return NextResponse.json({ stream_id: streamId, action });
  } catch (error) {
    return errorResponse("recurring.update", error);
  }
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run tests/unit/recurring-route.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add app/api/recurring/route.ts tests/unit/recurring-route.test.ts lib/audit.ts
git commit -m "feat(recurring): add stream review/dismiss/amount route"
```

---

## Task 10: `app/api/recurring/manual/route.ts` — manual item CRUD

**Files:**
- Create: `app/api/recurring/manual/route.ts`
- Test: `tests/unit/recurring-manual-route.test.ts`

**Interfaces:**
- Consumes: `requireUser`, `badRequest`, `errorResponse`; adds `"manual_recurring_item_created" | "manual_recurring_item_updated" | "manual_recurring_item_deleted"` to `AuditAction`.
- Produces: `POST` (create), `PATCH` (update, body includes `id`), `DELETE` (body includes `id`) at `/api/recurring/manual`. Writes go through the cookie-bound `supabase` client from `requireUser()` — `manual_recurring_items` already has full owner RLS, unlike the Plaid-synced `recurring_streams`.

- [ ] **Step 1: Add the three new audit actions to `lib/audit.ts`**

```typescript
  | "manual_recurring_item_created"
  | "manual_recurring_item_updated"
  | "manual_recurring_item_deleted";
```

- [ ] **Step 2: Write failing tests**

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { DELETE, PATCH, POST } from "@/app/api/recurring/manual/route";
import { writeAudit } from "@/lib/audit";
import { requireUser } from "@/lib/http";
import { clientStub } from "../fixtures/supabase-query";

vi.mock("@/lib/http", async () => {
  const actual = await vi.importActual<typeof import("@/lib/http")>("@/lib/http");
  return { ...actual, requireUser: vi.fn() };
});
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn() }));

const ITEM_ID = "123e4567-e89b-12d3-a456-426614174000";
const validCreate = {
  name: "Piano lessons",
  amount: 80,
  frequency: "monthly",
  next_date: "2026-08-05",
  item_type: "expense",
  category: "Education",
};

function req(method: string, body: unknown): Request {
  return new Request("http://localhost/api/recurring/manual", {
    method,
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("manual recurring items route", () => {
  let client: ReturnType<typeof clientStub>;

  beforeEach(() => {
    vi.clearAllMocks();
    client = clientStub({
      manual_recurring_items: { data: [{ id: ITEM_ID }] },
    });
    vi.mocked(requireUser).mockResolvedValue({
      user: { id: "user-1", email: "test@example.com" },
      supabase: client as never,
    } as never);
  });

  it("rejects a create with a non-positive amount", async () => {
    const response = await POST(req("POST", { ...validCreate, amount: 0 }));
    expect(response.status).toBe(400);
  });

  it("rejects an unknown frequency", async () => {
    const response = await POST(req("POST", { ...validCreate, frequency: "daily" }));
    expect(response.status).toBe(400);
  });

  it("creates a manual item scoped to the user and audits it", async () => {
    const response = await POST(req("POST", validCreate));
    expect(response.status).toBe(200);
    const written = client.writtenTo("manual_recurring_items") as Record<string, unknown>;
    expect(written.user_id).toBe("user-1");
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "manual_recurring_item_created" }),
    );
  });

  it("updates only the provided fields, scoped to the owner", async () => {
    const response = await PATCH(req("PATCH", { id: ITEM_ID, amount: 90 }));
    expect(response.status).toBe(200);
    expect(client.scopedToUser("manual_recurring_items", "user-1")).toBe(true);
  });

  it("deletes a manual item scoped to the owner", async () => {
    const response = await DELETE(req("DELETE", { id: ITEM_ID }));
    expect(response.status).toBe(200);
    expect(client.scopedToUser("manual_recurring_items", "user-1")).toBe(true);
  });

  it("404s an update for a row the owner filter doesn't match", async () => {
    client = clientStub({ manual_recurring_items: { data: null } });
    vi.mocked(requireUser).mockResolvedValue({
      user: { id: "user-1", email: "test@example.com" },
      supabase: client as never,
    } as never);
    const response = await PATCH(req("PATCH", { id: ITEM_ID, amount: 90 }));
    expect(response.status).toBe(404);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/unit/recurring-manual-route.test.ts`
Expected: FAIL — route file doesn't exist.

- [ ] **Step 4: Implement**

```typescript
import { NextResponse } from "next/server";
import { badRequest, errorResponse, requireUser } from "@/lib/http";
import { writeAudit } from "@/lib/audit";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FREQUENCIES = ["weekly", "biweekly", "monthly", "quarterly", "yearly"] as const;
const ITEM_TYPES = ["income", "expense"] as const;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

interface CreateBody {
  name: string;
  amount: number;
  frequency: (typeof FREQUENCIES)[number];
  next_date: string;
  item_type: (typeof ITEM_TYPES)[number];
  category: string | null;
}

function parseCreate(value: unknown): { ok: true; value: CreateBody } | { ok: false; message: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, message: "Invalid JSON payload" };
  }
  const body = value as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name.length < 1 || name.length > 140) return { ok: false, message: "Invalid name" };
  if (typeof body.amount !== "number" || !Number.isFinite(body.amount) || body.amount <= 0) {
    return { ok: false, message: "Invalid amount" };
  }
  if (typeof body.frequency !== "string" || !FREQUENCIES.includes(body.frequency as never)) {
    return { ok: false, message: "Invalid frequency" };
  }
  if (typeof body.next_date !== "string" || !DATE_REGEX.test(body.next_date)) {
    return { ok: false, message: "Invalid next_date" };
  }
  if (typeof body.item_type !== "string" || !ITEM_TYPES.includes(body.item_type as never)) {
    return { ok: false, message: "Invalid item_type" };
  }
  if (body.category !== undefined && body.category !== null && typeof body.category !== "string") {
    return { ok: false, message: "Invalid category" };
  }
  return {
    ok: true,
    value: {
      name,
      amount: body.amount,
      frequency: body.frequency as CreateBody["frequency"],
      next_date: body.next_date,
      item_type: body.item_type as CreateBody["item_type"],
      category: (body.category as string | null) ?? null,
    },
  };
}

export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { supabase, user } = auth;

  try {
    const parsed = parseCreate(await request.json().catch(() => null));
    if (!parsed.ok) return badRequest(parsed.message);

    const { data, error } = await supabase
      .from("manual_recurring_items")
      .insert({ user_id: user.id, ...parsed.value, enabled: true })
      .select("id")
      .single();
    if (error) return errorResponse("recurring.manual.create", error);

    await writeAudit({
      userId: user.id,
      action: "manual_recurring_item_created",
      metadata: { id: (data as { id: string }).id },
    });

    return NextResponse.json({ id: (data as { id: string }).id });
  } catch (error) {
    return errorResponse("recurring.manual.create", error);
  }
}

export async function PATCH(request: Request) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { supabase, user } = auth;

  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body.id !== "string" || !UUID_REGEX.test(body.id)) {
      return badRequest("Invalid id");
    }
    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) {
      if (typeof body.name !== "string" || body.name.trim().length < 1) return badRequest("Invalid name");
      patch.name = body.name.trim();
    }
    if (body.amount !== undefined) {
      if (typeof body.amount !== "number" || !Number.isFinite(body.amount) || body.amount <= 0) {
        return badRequest("Invalid amount");
      }
      patch.amount = body.amount;
    }
    if (body.frequency !== undefined) {
      if (typeof body.frequency !== "string" || !FREQUENCIES.includes(body.frequency as never)) {
        return badRequest("Invalid frequency");
      }
      patch.frequency = body.frequency;
    }
    if (body.next_date !== undefined) {
      if (typeof body.next_date !== "string" || !DATE_REGEX.test(body.next_date)) {
        return badRequest("Invalid next_date");
      }
      patch.next_date = body.next_date;
    }
    if (body.item_type !== undefined) {
      if (typeof body.item_type !== "string" || !ITEM_TYPES.includes(body.item_type as never)) {
        return badRequest("Invalid item_type");
      }
      patch.item_type = body.item_type;
    }
    if (body.category !== undefined) {
      if (body.category !== null && typeof body.category !== "string") return badRequest("Invalid category");
      patch.category = body.category;
    }
    if (body.enabled !== undefined) {
      if (typeof body.enabled !== "boolean") return badRequest("Invalid enabled");
      patch.enabled = body.enabled;
    }

    const { data, error } = await supabase
      .from("manual_recurring_items")
      .update(patch)
      .eq("id", body.id)
      .eq("user_id", user.id)
      .select("id")
      .maybeSingle();
    if (error) return errorResponse("recurring.manual.update", error);
    if (!data) return NextResponse.json({ error: "Manual item not found" }, { status: 404 });

    await writeAudit({
      userId: user.id,
      action: "manual_recurring_item_updated",
      metadata: { id: body.id, changed_fields: Object.keys(patch) },
    });

    return NextResponse.json({ id: body.id });
  } catch (error) {
    return errorResponse("recurring.manual.update", error);
  }
}

export async function DELETE(request: Request) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { supabase, user } = auth;

  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body.id !== "string" || !UUID_REGEX.test(body.id)) {
      return badRequest("Invalid id");
    }

    const { error } = await supabase
      .from("manual_recurring_items")
      .delete()
      .eq("id", body.id)
      .eq("user_id", user.id);
    if (error) return errorResponse("recurring.manual.delete", error);

    await writeAudit({
      userId: user.id,
      action: "manual_recurring_item_deleted",
      metadata: { id: body.id },
    });

    return NextResponse.json({ id: body.id });
  } catch (error) {
    return errorResponse("recurring.manual.delete", error);
  }
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run tests/unit/recurring-manual-route.test.ts`
Expected: PASS (6 tests). Note the 404 test's stub returns `data: null` for every table including the ownership check select — confirm this reads as "not found" not a thrown error.

- [ ] **Step 6: Commit**

```bash
git add app/api/recurring/manual/route.ts tests/unit/recurring-manual-route.test.ts lib/audit.ts
git commit -m "feat(recurring): add manual recurring item CRUD route"
```

---

## Task 11: `components/recurring/MonthSummary.tsx` and `ReviewBanner.tsx`

**Files:**
- Create: `components/recurring/MonthSummary.tsx`
- Create: `components/recurring/ReviewBanner.tsx`

**Interfaces:**
- Consumes: `RecurringMonth["totals"]` from `lib/recurring-page.ts`; `formatCurrency` from `lib/format.ts`; `Panel` from `components/ui/Panel.tsx`.
- Produces: two server components composed into `app/recurring/page.tsx` (Task 13). `ReviewBanner` itself is a thin server shell; the interactive Confirm/Not-recurring buttons live in `RecurringList.tsx` (Task 12) since they share the same client-side optimistic-update plumbing as amount correction.

- [ ] **Step 1: Build `MonthSummary`**

```typescript
import Panel from "@/components/ui/Panel";
import { formatCurrency } from "@/lib/format";
import type { RecurringMonth } from "@/lib/recurring-page";

function ProgressRow({
  label,
  paid,
  remaining,
  currency,
}: Readonly<{ label: string; paid: number; remaining: number; currency: string }>) {
  const total = paid + remaining;
  const pct = total > 0 ? Math.round((paid / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-semibold">{label}</span>
        <span className="text-muted">
          {formatCurrency(paid, currency)} of {formatCurrency(total, currency)}
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label} progress`}
        className="mt-1.5 h-2 overflow-hidden rounded-full bg-panel-hover"
      >
        <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function MonthSummary({
  totals,
  currency,
}: Readonly<{ totals: RecurringMonth["totals"]; currency: string }>) {
  return (
    <Panel title="This month" eyebrow="Progress">
      <div className="space-y-4">
        <ProgressRow label="Income" paid={totals.income.paid} remaining={totals.income.remaining} currency={currency} />
        <ProgressRow label="Expenses" paid={totals.expenses.paid} remaining={totals.expenses.remaining} currency={currency} />
        {(totals.creditCards.paid > 0 || totals.creditCards.remaining > 0) && (
          <ProgressRow
            label="Credit cards"
            paid={totals.creditCards.paid}
            remaining={totals.creditCards.remaining}
            currency={currency}
          />
        )}
      </div>
    </Panel>
  );
}
```

- [ ] **Step 2: Build `ReviewBanner`**

```typescript
import Panel from "@/components/ui/Panel";

export default function ReviewBanner({
  reviewCount,
  children,
}: Readonly<{ reviewCount: number; children: React.ReactNode }>) {
  if (reviewCount === 0) return null;
  return (
    <Panel tone="warning">
      <p className="text-sm font-semibold">
        There {reviewCount === 1 ? "is" : "are"} {reviewCount} new recurring
        merchant{reviewCount === 1 ? "" : "s"} for you to review.
      </p>
      <div className="mt-3">{children}</div>
    </Panel>
  );
}
```

- [ ] **Step 3: No unit test for these two — they're pure presentational wrappers over already-tested `RecurringMonth` data. Verify visually in Task 13's manual pass and the Task 15 E2E spec.**

- [ ] **Step 4: Commit**

```bash
git add components/recurring/MonthSummary.tsx components/recurring/ReviewBanner.tsx
git commit -m "feat(recurring): add month summary and review banner panels"
```

---

## Task 12: `components/recurring/RecurringList.tsx` — interactive occurrence and manage list

**Files:**
- Create: `components/recurring/RecurringList.tsx`

**Interfaces:**
- Consumes: `RecurringOccurrence` from `lib/recurring-page.ts`; `RecurringStreamRow` from `lib/recurring-data.ts`; calls `PATCH /api/recurring` and `POST|PATCH|DELETE /api/recurring/manual`.
- Produces: default export `RecurringList`, a client component mirroring `BudgetTable`'s local-state + `onUpdate` optimistic pattern.

- [ ] **Step 1: Implement**

```typescript
"use client";

import { useState, useTransition } from "react";
import { formatCurrency, formatDay } from "@/lib/format";
import type { RecurringOccurrence } from "@/lib/recurring-page";
import type { RecurringStreamRow } from "@/lib/recurring-data";

const STATUS_LABEL: Record<RecurringOccurrence["status"], string> = {
  upcoming: "Upcoming",
  overdue: "Overdue",
  complete: "Paid",
};

const STATUS_TONE: Record<RecurringOccurrence["status"], string> = {
  upcoming: "text-muted",
  overdue: "text-danger",
  complete: "text-success",
};

function OccurrenceRow({ occurrence, currency }: Readonly<{ occurrence: RecurringOccurrence; currency: string }>) {
  return (
    <li className="flex items-center justify-between gap-4 border-t border-panel-border py-3 first:border-t-0">
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold">{occurrence.merchant}</span>
        <span className="text-xs text-muted">
          {formatDay(occurrence.dueDate)} · {occurrence.frequency}
          {occurrence.account ? ` · ${occurrence.account}` : ""}
        </span>
      </span>
      <span className="flex items-center gap-3">
        <span className={`text-xs font-semibold ${STATUS_TONE[occurrence.status]}`}>
          {STATUS_LABEL[occurrence.status]}
        </span>
        <span className={`metric-value text-sm ${occurrence.isIncome ? "text-success" : ""}`}>
          {occurrence.isIncome ? "+" : ""}
          {formatCurrency(occurrence.amount, currency)}
        </span>
      </span>
    </li>
  );
}

function ManageRow({
  stream,
  onReview,
  onDismiss,
  onRestore,
  onCorrectAmount,
  pending,
}: Readonly<{
  stream: RecurringStreamRow;
  onReview: (id: string) => void;
  onDismiss: (id: string) => void;
  onRestore: (id: string) => void;
  onCorrectAmount: (id: string, amount: number) => void;
  pending: boolean;
}>) {
  const [amount, setAmount] = useState(String(stream.userAmount ?? stream.averageAmount ?? 0));
  const needsReview = stream.status === "MATURE" && !stream.dismissedAt && !stream.reviewedAt;

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 border-t border-panel-border py-3 first:border-t-0">
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold">{stream.merchantName ?? stream.description ?? "Unknown"}</span>
        <span className="text-xs text-muted">
          {stream.accountName ?? "Unlinked account"}
          {stream.dismissedAt ? " · Not recurring" : ""}
        </span>
      </span>
      <span className="flex items-center gap-2">
        <input
          aria-label={`Expected amount for ${stream.merchantName ?? "this stream"}`}
          type="number"
          min="0"
          step="0.01"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          onBlur={() => {
            const value = Number(amount);
            if (Number.isFinite(value) && value >= 0) onCorrectAmount(stream.id, value);
          }}
          disabled={pending}
          className="min-h-11 w-24 rounded-field border border-panel-border bg-background px-3 text-right"
        />
        {needsReview && (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={() => onReview(stream.id)}
              className="min-h-11 rounded-field bg-accent px-3 text-sm font-semibold text-accent-foreground"
            >
              Confirm
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => onDismiss(stream.id)}
              className="min-h-11 rounded-field border border-panel-border px-3 text-sm font-semibold"
            >
              Not recurring
            </button>
          </>
        )}
        {stream.dismissedAt && (
          <button
            type="button"
            disabled={pending}
            onClick={() => onRestore(stream.id)}
            className="min-h-11 rounded-field border border-panel-border px-3 text-sm font-semibold"
          >
            Restore
          </button>
        )}
      </span>
    </li>
  );
}

export default function RecurringList({
  occurrences,
  streams,
  currency,
}: Readonly<{
  occurrences: RecurringOccurrence[];
  streams: RecurringStreamRow[];
  currency: string;
}>) {
  const [tab, setTab] = useState<"upcoming" | "complete" | "manage">("upcoming");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function patchStream(streamId: string, action: string, amount?: number) {
    setError(null);
    const response = await fetch("/api/recurring", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stream_id: streamId, action, amount }),
    });
    if (!response.ok) setError("That update didn't save. Try again.");
  }

  function handle(streamId: string, action: string, amount?: number) {
    startTransition(async () => {
      await patchStream(streamId, action, amount);
    });
  }

  const upcoming = occurrences.filter((occurrence) => occurrence.status !== "complete");
  const complete = occurrences.filter((occurrence) => occurrence.status === "complete");

  return (
    <div>
      <div className="mb-4 flex gap-1 text-xs font-semibold" role="tablist">
        {(
          [
            { key: "upcoming", label: `Upcoming (${upcoming.length})` },
            { key: "complete", label: `Complete (${complete.length})` },
            { key: "manage", label: `All (${streams.length})` },
          ] as const
        ).map((option) => (
          <button
            key={option.key}
            type="button"
            role="tab"
            aria-selected={tab === option.key}
            onClick={() => setTab(option.key)}
            className={
              tab === option.key
                ? "min-h-11 rounded-field bg-accent-soft px-3 text-accent"
                : "min-h-11 rounded-field px-3 text-muted hover:bg-panel-hover hover:text-foreground"
            }
          >
            {option.label}
          </button>
        ))}
      </div>
      {error && <p className="mb-3 text-sm font-semibold text-danger">{error}</p>}
      {tab === "upcoming" && (
        <ul>
          {upcoming.length === 0 ? (
            <p className="py-6 text-sm text-muted">Nothing upcoming this month.</p>
          ) : (
            upcoming.map((occurrence, index) => (
              <OccurrenceRow key={`${occurrence.sourceId}-${occurrence.dueDate}-${index}`} occurrence={occurrence} currency={currency} />
            ))
          )}
        </ul>
      )}
      {tab === "complete" && (
        <ul>
          {complete.length === 0 ? (
            <p className="py-6 text-sm text-muted">Nothing paid yet this month.</p>
          ) : (
            complete.map((occurrence, index) => (
              <OccurrenceRow key={`${occurrence.sourceId}-${occurrence.dueDate}-${index}`} occurrence={occurrence} currency={currency} />
            ))
          )}
        </ul>
      )}
      {tab === "manage" && (
        <ul>
          {streams.length === 0 ? (
            <p className="py-6 text-sm text-muted">No recurring streams detected yet.</p>
          ) : (
            streams.map((stream) => (
              <ManageRow
                key={stream.id}
                stream={stream}
                pending={isPending}
                onReview={(id) => handle(id, "review")}
                onDismiss={(id) => handle(id, "dismiss")}
                onRestore={(id) => handle(id, "restore")}
                onCorrectAmount={(id, amount) => handle(id, "correct_amount", amount)}
              />
            ))
          )}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Manual verification (client components with `useTransition` are exercised end-to-end in Task 15's Playwright spec, not a unit test — there is no existing precedent in this codebase for unit-testing a client component's DOM interactions; `BudgetTable`/`BudgetPlanner` follow the same E2E-only verification path).**

- [ ] **Step 3: Commit**

```bash
git add components/recurring/RecurringList.tsx
git commit -m "feat(recurring): add interactive occurrence and manage list"
```

---

## Task 13: `app/recurring/page.tsx` — page wiring

**Files:**
- Create: `app/recurring/page.tsx`

**Interfaces:**
- Consumes: `loadRecurringData` from `lib/recurring-data.ts`; `isFeatureEnabled` from `lib/feature-flags.ts`; `serializeFinancialScope` from `lib/financial-scope.ts`; `MonthSummary`, `ReviewBanner`, `RecurringList` from `components/recurring/*`; `AppShell` from `components/shell/AppShell.tsx`.

- [ ] **Step 1: Implement**

```typescript
import { notFound } from "next/navigation";
import AppShell from "@/components/shell/AppShell";
import MonthSummary from "@/components/recurring/MonthSummary";
import ReviewBanner from "@/components/recurring/ReviewBanner";
import RecurringList from "@/components/recurring/RecurringList";
import Panel from "@/components/ui/Panel";
import Link from "next/link";
import { loadRecurringData } from "@/lib/recurring-data";
import { serializeFinancialScope } from "@/lib/financial-scope";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { formatMonth, UNKNOWN_CURRENCY } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    month?: string | string[];
    scope?: string | string[];
  }>;
}

const MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function shiftMonth(month: string, delta: number): string {
  const [year, oneBasedMonth] = month.split("-").map(Number);
  const total = year! * 12 + oneBasedMonth! - 1 + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

function recurringHref(input: { month: string; scope?: string }): string {
  const params = new URLSearchParams({ month: input.month });
  if (input.scope) params.set("scope", input.scope);
  return `/recurring?${params.toString()}`;
}

export default async function RecurringPage({ searchParams }: Readonly<PageProps>) {
  if (!isFeatureEnabled("recurringPage")) notFound();

  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const currentMonth = new Date().toISOString().slice(0, 7);
  const rawMonth = first(params.month);
  const month = rawMonth && MONTH_REGEX.test(rawMonth) ? rawMonth : currentMonth;

  const loaded = await loadRecurringData(supabase, {
    userId: user.id,
    anchorMonth: month,
    rawScope: params.scope,
  });
  const scope = serializeFinancialScope(loaded.scope);
  const baseLink = { month, scope };

  return (
    <AppShell active="recurring" email={user.email}>
      <header className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="eyebrow">{formatMonth(month)}</p>
          <h1 className="display mt-2 text-3xl sm:text-4xl">Recurring</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
            Bills, subscriptions, and income Plaid detects automatically, plus anything you track manually.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={recurringHref({ ...baseLink, month: shiftMonth(month, -1) })}
            className="inline-flex min-h-11 items-center rounded-field border border-panel-border bg-panel px-4 text-sm font-semibold"
          >
            Previous
          </Link>
          <Link
            href={recurringHref({ ...baseLink, month: shiftMonth(month, 1) })}
            className="inline-flex min-h-11 items-center rounded-field border border-panel-border bg-panel px-4 text-sm font-semibold"
          >
            Next
          </Link>
          <Link
            href={recurringHref({ ...baseLink, scope: undefined })}
            aria-current={loaded.scope.kind === "mine" ? "page" : undefined}
            className="inline-flex min-h-11 items-center rounded-field border border-panel-border bg-panel px-4 text-sm font-semibold"
          >
            Mine
          </Link>
          {loaded.visibleHouseholdIds[0] && (
            <Link
              href={recurringHref({ ...baseLink, scope: loaded.visibleHouseholdIds[0] })}
              aria-current={loaded.scope.kind === "household" ? "page" : undefined}
              className="inline-flex min-h-11 items-center rounded-field border border-panel-border bg-panel px-4 text-sm font-semibold"
            >
              Household
            </Link>
          )}
        </div>
      </header>

      <div className="mt-6 space-y-4">
        {loaded.stale && (
          <Panel tone="warning">
            <p className="text-sm font-semibold">Recurring data may be stale.</p>
            <p className="mt-1 text-sm text-muted">Refresh connected accounts before relying on this month.</p>
          </Panel>
        )}

        <ReviewBanner reviewCount={loaded.view.reviewCount}>
          <p className="text-sm text-muted">Open the &quot;All&quot; tab below to confirm or dismiss each one.</p>
        </ReviewBanner>

        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          <Panel title="Occurrences" eyebrow="This month">
            <RecurringList
              occurrences={loaded.view.occurrences}
              streams={loaded.allStreams}
              currency={UNKNOWN_CURRENCY}
            />
          </Panel>
          <MonthSummary totals={loaded.view.totals} currency={UNKNOWN_CURRENCY} />
        </div>
      </div>
    </AppShell>
  );
}
```

Note: unlike Budget/Cash Flow, recurring streams don't carry a per-transaction currency the same way (the canonical projection isn't consumed here — `RecurringMonth` totals are built from Plaid's own stream amounts, which are single-currency per account). Using `UNKNOWN_CURRENCY` as a placeholder is wrong if the user's accounts use a real currency; fix this in Step 2 below before treating the task as done.

- [ ] **Step 2: Thread a real currency through**

Extend `RecurringLoadResult` (Task 6) with a `currency: string` field derived from the scoped accounts query's `iso_currency_code` (same approach as `lib/budget-data.ts`'s `partitionCashFlowByCurrency`, simplified to a single dominant currency since Recurring doesn't yet split by currency — note this as a known simplification, not a silent bug, in the PR description). Update `loadRecurringData` to return it, and replace both `UNKNOWN_CURRENCY` usages above with `loaded.currency`.

- [ ] **Step 3: Manual smoke check**

Run: `npm run dev`, sign in, visit `/recurring?month=2026-07`. Confirm the page renders without a hydration error, month/scope links update the URL, and (with no demo data yet) the empty states from Task 12 render instead of a crash.

- [ ] **Step 4: Run the full gate**

Run: `npm run lint && npx tsc --noEmit && npm run test:unit && npm run build`
Expected: all pass; `/recurring` and `/api/recurring` (plus `/api/recurring/manual`) appear in the production route manifest.

- [ ] **Step 5: Commit**

```bash
git add app/recurring/page.tsx lib/recurring-data.ts
git commit -m "feat(recurring): release the recurring page"
```

---

## Task 14: Extend `tests/unit/recurring-lib.test.ts`'s existing suite for the sync route metadata (regression guard)

**Files:**
- Modify: `tests/unit/recurring-lib.test.ts` (if not already fully covered by Task 5)

- [ ] **Step 1: Confirm `app/api/plaid/sync/route.ts`'s existing behavior is unaffected**

`refreshRecurringForUser`'s public signature and return type (`Promise<number>`) are unchanged by Task 5, so the manual-refresh route and its existing tests (`tests/unit/recurring-alerts.test.ts` if it touches this path) need no code change. Run the full suite to confirm:

Run: `npx vitest run tests/unit/recurring-lib.test.ts tests/unit/recurring-alerts.test.ts`
Expected: PASS, no regressions.

- [ ] **Step 2: No commit needed if nothing changed — this is a verification step, not a code step.**

---

## Task 15: E2E acceptance and doc updates

**Files:**
- Create: `tests/e2e/recurring.spec.ts`
- Modify: `docs/HANDOFF.md`, `docs/TODO.md`

**Interfaces:**
- Consumes: same credentialed-live-Supabase Playwright pattern as `tests/e2e/planner-ia.spec.ts`/`tests/e2e/budget.spec.ts` (throwaway user via admin client, `describe.skip` without credentials).

- [ ] **Step 1: Read `tests/e2e/planner-ia.spec.ts` in full to copy its setup/teardown scaffolding exactly (admin client construction, throwaway user creation, sign-in helper, base URL resolution).**

- [ ] **Step 2: Write the spec**

```typescript
// Mirrors tests/e2e/planner-ia.spec.ts's scaffolding. Covers:
// - Recurring is reachable from the sidebar once recurringPage is enabled.
// - A demo MATURE stream with no reviewed_at shows the review banner and a
//   sidebar badge; clicking Confirm in the "All" tab clears both.
// - Editing the expected amount in "All" changes the Upcoming tab's total.
// - Month navigation preserves scope in the URL.
// - Mobile viewport (390x844) has no horizontal overflow on the occurrence list.
import { test, expect } from "@playwright/test";
// ... full scaffolding copied from planner-ia.spec.ts, adapted to seed one
// recurring_streams row (status MATURE, reviewed_at null, predicted_next_date
// in the current month) and assert the six behaviors above.
```

- [ ] **Step 3: Run it**

Run: `npm run dev` (background), then `npm run test:e2e -- tests/e2e/recurring.spec.ts`
Expected: PASS with live credentials; clean skip without them.

- [ ] **Step 4: Update `docs/TODO.md`'s active-program list**

```markdown
- **Phase 5: Recurring.** Done (2026-07-30), branch `feat/recurring-page`.
  Occurrence review workflow anchored on Plaid's predicted_next_date/transaction_ids, manual recurring items, sidebar badge, Mine and Household scope are complete.
```

- [ ] **Step 5: Add a `docs/HANDOFF.md` "START HERE" section**

Follow the exact structure of the Phase 4/Phase 1 sections already at the top of the file: what shipped, the migration applied to `zrxbmmtqqhlwtrinocww` with its recorded version, live verification results, the full local gate's real command output, and a "Next" pointer at Phase 6, 9A, or 11 (per the master plan's dependency graph — all three depend only on Phase 1, already merged).

- [ ] **Step 6: Run the complete final gate**

Run: `npm run lint && npx tsc --noEmit && npm test && npm run build && npm run test:e2e -- tests/e2e/recurring.spec.ts`
Expected: all pass. Record the exact test/file counts in the HANDOFF entry, matching the precision of prior phases' entries (no rounded or invented numbers).

- [ ] **Step 7: Commit**

```bash
git add tests/e2e/recurring.spec.ts docs/HANDOFF.md docs/TODO.md
git commit -m "test(recurring): add planner acceptance journey and record phase 5"
```

---

## Self-Review Notes

- **Spec coverage:** every checklist item in the master plan's Phase 5 section maps to a task above — migration/grants/RLS (Task 1-2), Plaid occurrence persistence and mark-and-sweep (Task 5), heuristic matching restricted to manual items only (Task 4/6 — Plaid completion never uses a heuristic), review/dismiss/restore/amount route (Task 9), manual CRUD (Task 10), Monthly tab with scope/month/filters/list-manage toggle (Task 12-13), review banner + sidebar badge (Task 8, 11), unread-badge test isolating household-shared streams from another member's badge (covered by Task 2's RLS test plus Task 8's shared counter design — the badge query is always `user_id = auth.uid()` scoped, so a shared stream never inflates a household member's own badge, since `reviewed_at`/`dismissed_at` are per-stream-owner facts, not per-viewer).
- **Placeholder scan:** no "TBD"/"handle it later" text; every step has runnable code or an explicit, justified reason a step is verification-only (Tasks 11 Step 3, 14).
- **Type consistency:** `RecurringStreamInput`, `RecurringOccurrence`, `RecurringMonth`, `ManualRecurringItemInput` are defined once in Task 3-4 and reused verbatim by Tasks 6, 8, 12, 13 — no renamed duplicate shape.
