# Account Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user enter a bank statement's ending balance and date, mark ledger rows cleared, see exactly which transactions are outstanding, and record an audited balance-correcting entry when the bank is right and the ledger needs a fix.

**Architecture:** A pure function computes cleared/outstanding totals against a statement balance from an owner-scoped `reconciliation_statements` table and a new `cleared_at` column on `transaction_annotations`. Two thin route handlers (toggle-cleared, statement CRUD) sit on the same `requireUser()` → validate → RLS-scoped write → `writeAudit()` shape every other route in this app uses. A balance correction reuses the existing manual-transaction path — no new provenance or table.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase Postgres, Vitest.

**Spec:** `features.md` §1 ("Account reconciliation").

## Global Constraints

- Every service-client query filters `user_id` explicitly; prefer the RLS-scoped `supabase` client from `requireUser()` for this feature's writes, matching `transaction_annotations`/`budgets`/`manual_recurring_items`.
- Amount sign follows Plaid: positive = money out, negative = money in.
- A table that FKs to `transactions`, `accounts`, or `manual_accounts` must check ownership of the referenced row in its RLS `with check`, not just `user_id = auth.uid()` on the child row (the M8 pattern in `20260810100000_security_hardening.sql`).
- Route handlers: `requireUser()` → early-return the `NextResponse` → `badRequest()` → work → `writeAudit()` → JSON, wrapped so failures hit `errorResponse(context, error)`.
- Create migrations with `npx supabase migration new <slug>`; apply by hand (CLI or dashboard) before code reads the table — there is no migration runner in CI.
- Tests mock with `vi.mock` and import route handlers directly, using `tests/fixtures/supabase-query.ts`'s `clientStub`/`queryStub`.
- UI needs empty, loading, error, and success states; check light/dark and the 375px mobile layout.
- `npm run lint`, `npm test`, and `npm run build` must pass before this is done.

---

### Task 1: Add the reconciliation schema

**Files:**

- Create with Supabase CLI: migration slug `account_reconciliation`
- Modify: `tests/unit/roadmap-schema-completion.test.ts` (or the nearest existing schema-assertion test file covering recent migrations — grep for how `transaction_annotations` columns are asserted there and follow the same style)

**Interfaces:** Adds `transaction_annotations.cleared_at timestamptz` and a new owner-scoped `reconciliation_statements` table with no update grant (a statement is deleted and re-created to correct it, never edited in place).

- [ ] Write a failing schema test asserting: `transaction_annotations` has a `cleared_at` column; `reconciliation_statements` exists with columns `id, user_id, account_id, manual_account_id, statement_date, statement_balance, created_at`; a check constraint requires exactly one of `account_id`/`manual_account_id`; unique constraints on `(user_id, account_id, statement_date)` and `(user_id, manual_account_id, statement_date)`; RLS is enabled; `authenticated` has `select, insert, delete` but not `update`.
- [ ] Run the focused test and confirm it fails (table/column don't exist yet).
- [ ] Generate the migration and write:
  ```sql
  alter table public.transaction_annotations
    add column if not exists cleared_at timestamptz;

  create table public.reconciliation_statements (
    id                 uuid primary key default gen_random_uuid(),
    user_id            uuid not null references auth.users (id) on delete cascade,
    account_id         uuid references public.accounts (id) on delete cascade,
    manual_account_id  uuid references public.manual_accounts (id) on delete cascade,
    statement_date     date not null,
    statement_balance  numeric(14, 2) not null,
    created_at         timestamptz not null default now(),
    check (
      (account_id is not null and manual_account_id is null)
      or (account_id is null and manual_account_id is not null)
    ),
    unique (user_id, account_id, statement_date),
    unique (user_id, manual_account_id, statement_date)
  );

  create index reconciliation_statements_user_account_idx
    on public.reconciliation_statements (user_id, account_id, statement_date desc);
  create index reconciliation_statements_user_manual_account_idx
    on public.reconciliation_statements (user_id, manual_account_id, statement_date desc);

  grant select, insert, delete on public.reconciliation_statements to authenticated;
  alter table public.reconciliation_statements enable row level security;

  create policy "reconciliation_statements_select_own" on public.reconciliation_statements
    for select to authenticated using (user_id = (select auth.uid()));

  create policy "reconciliation_statements_insert_own" on public.reconciliation_statements
    for insert to authenticated with check (
      user_id = (select auth.uid())
      and (
        account_id is null
        or exists (
          select 1 from public.accounts a
          where a.id = reconciliation_statements.account_id and a.user_id = (select auth.uid())
        )
      )
      and (
        manual_account_id is null
        or exists (
          select 1 from public.manual_accounts m
          where m.id = reconciliation_statements.manual_account_id and m.user_id = (select auth.uid())
        )
      )
    );

  create policy "reconciliation_statements_delete_own" on public.reconciliation_statements
    for delete to authenticated using (user_id = (select auth.uid()));
  ```
- [ ] Apply the migration (Supabase CLI against the linked project, or the dashboard SQL editor) and verify the table, constraints, indexes, grants, and policies exist as written.
- [ ] Run the focused schema test again and confirm it passes.
- [ ] Add `reconciliation_statements` to `USER_DATA_TABLES` in `lib/user-data.ts` (columns: `account_id, manual_account_id, statement_date, statement_balance, created_at`) so it's covered by takeout and backup.
- [ ] Commit with `feat(reconcile): add reconciliation schema`.

### Task 2: Implement the reconciliation math as a pure function

**Files:**

- Create: `lib/reconcile.ts`
- Create: `tests/unit/reconcile.test.ts`

**Interfaces:** `computeReconciliationSummary(input: ReconciliationSummaryInput): ReconciliationSummary`, consumed by both the summary route (Task 4) and the reconcile page (Task 6).

- [ ] Write failing tests covering: a fully-cleared window that exactly matches the statement balance (`balanced: true`, `difference: 0`); an outstanding transaction that leaves a nonzero `difference`; that the window excludes transactions dated on/before `priorStatementDate` and after `statementDate`; that a `null` `priorStatementDate` includes everything up to `statementDate`; that money-out (positive amount) reduces `clearedBalance` and money-in (negative amount) increases it; and that outputs are rounded to cents.
- [ ] Run `npx vitest run tests/unit/reconcile.test.ts` and confirm failure (`computeReconciliationSummary` doesn't exist).
- [ ] Implement:
  ```ts
  export interface ReconcileTransaction {
    id: string;
    date: string; // YYYY-MM-DD
    amount: number; // Plaid sign: positive = money out
    clearedAt: string | null;
  }

  export interface ReconciliationSummaryInput {
    priorStatementBalance: number;
    priorStatementDate: string | null;
    statementDate: string;
    statementBalance: number;
    transactions: ReconcileTransaction[];
  }

  export interface ReconciliationSummary {
    clearedTotal: number;
    clearedBalance: number;
    outstanding: ReconcileTransaction[];
    outstandingTotal: number;
    difference: number;
    balanced: boolean;
  }

  function round2(value: number): number {
    return Math.round(value * 100) / 100;
  }

  export function computeReconciliationSummary(
    input: ReconciliationSummaryInput,
  ): ReconciliationSummary {
    const inWindow = input.transactions.filter(
      (t) =>
        t.date <= input.statementDate &&
        (input.priorStatementDate === null || t.date > input.priorStatementDate),
    );
    const cleared = inWindow.filter((t) => t.clearedAt !== null);
    const outstanding = inWindow.filter((t) => t.clearedAt === null);

    const clearedTotal = round2(cleared.reduce((sum, t) => sum + t.amount, 0));
    const outstandingTotal = round2(outstanding.reduce((sum, t) => sum + t.amount, 0));
    // Plaid sign: a positive amount is money out, so it reduces the balance.
    const clearedBalance = round2(input.priorStatementBalance - clearedTotal);
    const difference = round2(input.statementBalance - clearedBalance);

    return {
      clearedTotal,
      clearedBalance,
      outstanding,
      outstandingTotal,
      difference,
      balanced: Math.abs(difference) < 0.01,
    };
  }
  ```
- [ ] Run the test again and confirm it passes.
- [ ] Commit with `feat(reconcile): add reconciliation math`.

### Task 3: Extend the audit action union

**Files:**

- Modify: `lib/audit.ts`

**Interfaces:** Adds three `AuditAction` values consumed by Tasks 4 and 5.

- [ ] Add `"transaction_cleared_toggled"`, `"reconciliation_statement_created"`, and `"reconciliation_statement_deleted"` to the `AuditAction` union in `lib/audit.ts`.
- [ ] Run `npx tsc --noEmit` to confirm nothing else needs updating.
- [ ] Commit with `feat(reconcile): extend audit action union`.

### Task 4: Implement the cleared-toggle route

**Files:**

- Create: `app/api/reconcile/cleared/route.ts`
- Create: `tests/unit/reconcile-cleared-route.test.ts`

**Interfaces:** `PATCH /api/reconcile/cleared` with body `{ transaction_id: string; cleared: boolean }`.

- [ ] Write failing tests covering: the auth-response passthrough when unauthenticated; `400` for a malformed `transaction_id` or non-boolean `cleared`; `404` when the transaction doesn't belong to the caller (own-row lookup returns nothing); a successful toggle upserts `transaction_annotations` with `cleared_at` set to an ISO timestamp when `cleared: true` and `null` when `cleared: false`, scoped to `user_id`; and that `writeAudit` is called with `action: "transaction_cleared_toggled"` and the transaction id and cleared state in `metadata`.
- [ ] Run the test file and confirm failure.
- [ ] Implement the route:
  ```ts
  import { NextResponse, type NextRequest } from "next/server";
  import { badRequest, errorResponse, requireUser } from "@/lib/http";
  import { writeAudit } from "@/lib/audit";

  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  interface PatchBody {
    transaction_id: string;
    cleared: boolean;
  }

  function parseBody(value: unknown): { ok: true; value: PatchBody } | { ok: false; message: string } {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { ok: false, message: "Invalid JSON payload" };
    }
    const body = value as Record<string, unknown>;
    if (typeof body.transaction_id !== "string" || !UUID_REGEX.test(body.transaction_id)) {
      return { ok: false, message: "Invalid transaction_id" };
    }
    if (typeof body.cleared !== "boolean") {
      return { ok: false, message: "Invalid cleared" };
    }
    return { ok: true, value: { transaction_id: body.transaction_id, cleared: body.cleared } };
  }

  export async function PATCH(request: NextRequest) {
    const auth = await requireUser();
    if (auth instanceof NextResponse) return auth;
    const { user, supabase } = auth;

    try {
      const parsed = parseBody(await request.json().catch(() => null));
      if (!parsed.ok) return badRequest(parsed.message);
      const { transaction_id: transactionId, cleared } = parsed.value;

      const { data: owned, error: ownedError } = await supabase
        .from("transactions")
        .select("id")
        .eq("id", transactionId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (ownedError) throw ownedError;
      if (!owned) {
        return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
      }

      const { error } = await supabase.from("transaction_annotations").upsert(
        {
          user_id: user.id,
          transaction_id: transactionId,
          cleared_at: cleared ? new Date().toISOString() : null,
        },
        { onConflict: "user_id,transaction_id" },
      );
      if (error) throw error;

      await writeAudit({
        userId: user.id,
        action: "transaction_cleared_toggled",
        metadata: { transaction_id: transactionId, cleared },
      });

      return NextResponse.json({ transaction_id: transactionId, cleared });
    } catch (error) {
      return errorResponse("reconcile.cleared", error);
    }
  }
  ```
  Note this upsert only ever supplies `user_id`, `transaction_id`, `cleared_at` — Postgres `ON CONFLICT ... DO UPDATE` (what `supabase-js` `.upsert()` generates) only overwrites the columns present in the payload, so an existing row's `note`/`tags` are left untouched.
- [ ] Run the test file and confirm it passes.
- [ ] Commit with `feat(reconcile): add cleared-toggle route`.

### Task 5: Implement the statement CRUD route

**Files:**

- Create: `app/api/reconcile/statements/route.ts`
- Create: `tests/unit/reconcile-statements-route.test.ts`

**Interfaces:** `GET /api/reconcile/statements?source=plaid|manual&id=<uuid>` (list, newest first), `POST /api/reconcile/statements` (create), `DELETE /api/reconcile/statements` (remove by id).

- [ ] Write failing tests covering: `GET` requires `source`/`id` query params and returns `400` when missing or malformed; `GET` scopes the list by `user_id` and the correct `account_id`/`manual_account_id` column; `POST` validates `account.source` is `"plaid"` or `"manual"`, `statement_date` is `YYYY-MM-DD`, and `statement_balance` is a finite number; `POST` returns `404` when the referenced account isn't visible to the caller; `POST` returns `400` (not a 500) when the unique `(user_id, account_id, statement_date)` constraint is violated (Postgres error code `23505`); a successful `POST` writes `writeAudit` with `action: "reconciliation_statement_created"`; `DELETE` scopes by both `id` and `user_id` and audits `"reconciliation_statement_deleted"`.
- [ ] Run the test file and confirm failure.
- [ ] Implement the route (`GET`/`POST`/`DELETE` in one file, mirroring `app/api/manual-accounts/route.ts`'s shape):
  ```ts
  import { NextResponse, type NextRequest } from "next/server";
  import { badRequest, errorResponse, requireUser } from "@/lib/http";
  import { writeAudit } from "@/lib/audit";

  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

  interface AccountRef {
    source: "plaid" | "manual";
    id: string;
  }

  function parseAccountRef(value: unknown): AccountRef | null {
    if (!value || typeof value !== "object") return null;
    const ref = value as Record<string, unknown>;
    if (ref.source !== "plaid" && ref.source !== "manual") return null;
    if (typeof ref.id !== "string" || !UUID_REGEX.test(ref.id)) return null;
    return { source: ref.source, id: ref.id };
  }

  export async function GET(request: NextRequest) {
    const auth = await requireUser();
    if (auth instanceof NextResponse) return auth;
    const { user, supabase } = auth;

    try {
      const url = request.nextUrl;
      const ref = parseAccountRef({
        source: url.searchParams.get("source"),
        id: url.searchParams.get("id"),
      });
      if (!ref) return badRequest("source and id are required");

      const column = ref.source === "plaid" ? "account_id" : "manual_account_id";
      const { data, error } = await supabase
        .from("reconciliation_statements")
        .select("id, statement_date, statement_balance, created_at")
        .eq("user_id", user.id)
        .eq(column, ref.id)
        .order("statement_date", { ascending: false });
      if (error) throw error;

      return NextResponse.json({ statements: data ?? [] });
    } catch (error) {
      return errorResponse("reconcile.statements.list", error);
    }
  }

  export async function POST(request: NextRequest) {
    const auth = await requireUser();
    if (auth instanceof NextResponse) return auth;
    const { user, supabase } = auth;

    try {
      const body = (await request.json().catch(() => null)) as {
        account?: unknown;
        statement_date?: unknown;
        statement_balance?: unknown;
      } | null;

      const ref = parseAccountRef(body?.account);
      if (!ref) return badRequest("account must reference a plaid or manual account id");
      if (typeof body?.statement_date !== "string" || !DATE_REGEX.test(body.statement_date)) {
        return badRequest("statement_date must be a YYYY-MM-DD date");
      }
      if (typeof body?.statement_balance !== "number" || !Number.isFinite(body.statement_balance)) {
        return badRequest("statement_balance must be a finite number");
      }

      const table = ref.source === "plaid" ? "accounts" : "manual_accounts";
      const { data: account, error: accountError } = await supabase
        .from(table)
        .select("id")
        .eq("id", ref.id)
        .maybeSingle();
      if (accountError) throw accountError;
      if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

      const { data: statement, error } = await supabase
        .from("reconciliation_statements")
        .insert({
          user_id: user.id,
          account_id: ref.source === "plaid" ? ref.id : null,
          manual_account_id: ref.source === "manual" ? ref.id : null,
          statement_date: body.statement_date,
          statement_balance: body.statement_balance,
        })
        .select("id, statement_date, statement_balance, created_at")
        .single();
      if (error) {
        if (error.code === "23505") {
          return badRequest("A statement already exists for this account and date.");
        }
        throw error;
      }

      await writeAudit({
        userId: user.id,
        action: "reconciliation_statement_created",
        metadata: { statement_id: statement.id, account: ref, statement_date: body.statement_date },
      });

      return NextResponse.json({ statement }, { status: 201 });
    } catch (error) {
      return errorResponse("reconcile.statements.create", error);
    }
  }

  export async function DELETE(request: NextRequest) {
    const auth = await requireUser();
    if (auth instanceof NextResponse) return auth;
    const { user, supabase } = auth;

    try {
      const body = (await request.json().catch(() => null)) as { id?: unknown } | null;
      if (typeof body?.id !== "string" || !UUID_REGEX.test(body.id)) {
        return badRequest("id is required");
      }

      const { error } = await supabase
        .from("reconciliation_statements")
        .delete()
        .eq("id", body.id)
        .eq("user_id", user.id);
      if (error) throw error;

      await writeAudit({
        userId: user.id,
        action: "reconciliation_statement_deleted",
        metadata: { statement_id: body.id },
      });

      return NextResponse.json({ ok: true });
    } catch (error) {
      return errorResponse("reconcile.statements.delete", error);
    }
  }
  ```
- [ ] Run the test file and confirm it passes.
- [ ] Commit with `feat(reconcile): add statement CRUD route`.

### Task 6: Build the reconcile page and its data loader

**Files:**

- Create: `lib/reconcile-data.ts`
- Create: `app/reconcile/page.tsx`
- Create: `app/reconcile/loading.tsx`
- Create: `app/reconcile/error.tsx` (copy the shape of `app/recurring/error.tsx`)
- Create: `tests/unit/reconcile-data.test.ts`

**Interfaces:** `loadReconcileData(supabase, { userId, accountRef }): Promise<ReconcilePageData>`, where `ReconcilePageData` carries the account list (Plaid + manual, for the account picker), the most recent two `reconciliation_statements` rows for the selected account (for `priorStatementBalance`/`priorStatementDate`), and the transactions in the reconciliation window mapped to `ReconcileTransaction`.

- [ ] Write failing tests for `loadReconcileData`: it lists both `accounts` and `manual_accounts` for the picker; when no account is selected it defaults to the first account and returns an empty statement history; when a prior statement exists it's used as `priorStatementBalance`/`priorStatementDate`, otherwise both are `null`/`0`; transactions are mapped with `clearedAt` read from `transaction_annotations.cleared_at` (left-joined, so a transaction with no annotation row is outstanding).
- [ ] Run the test file and confirm failure.
- [ ] Implement `loadReconcileData` following the query-batching shape of `lib/recurring-data.ts`/`lib/budget-data.ts` (`Promise.all` for the accounts list, the two most recent statements, and the transaction+annotation join), returning `{ accounts, statements, transactions }` ready for `computeReconciliationSummary`.
- [ ] Run the test file and confirm it passes.
- [ ] Build `app/reconcile/page.tsx` as a server component following `app/recurring/page.tsx`'s shape: resolve `?account=<source>:<id>` from `searchParams`, call `loadReconcileData`, compute the summary with `computeReconciliationSummary`, and render `AppShell` + `PageHeader` + a `ReconcileWorkspace` client component (Task 7) with the loaded data as props. Gate behind `isFeatureEnabled("reconciliationPage")` with `notFound()` when disabled, matching the pattern in `app/recurring/page.tsx`; add the flag to `lib/feature-flags.ts` the same way `recurringPage` is defined there.
- [ ] Add a `reconcile` link to the primary nav (find where `active="recurring"` is wired into the shell's nav item list — likely `components/shell/AppShell.tsx` or a nav-config file it imports — and add a matching entry for `active="reconcile"`).
- [ ] Commit with `feat(reconcile): add reconcile page and data loader`.

### Task 7: Build the reconcile workspace UI

**Files:**

- Create: `components/reconcile/ReconcileWorkspace.tsx`
- Create: `components/reconcile/StatementForm.tsx`

**Interfaces:** `ReconcileWorkspace` is a client component taking the loaded accounts, statement history, transactions, and the computed `ReconciliationSummary`; it renders the account picker, the statement form, a difference banner (green/balanced vs amber/outstanding), and the transaction list with a cleared checkbox per row.

- [ ] Build `StatementForm`: date + balance inputs, `POST`s to `/api/reconcile/statements` on submit, shows a busy state while submitting and an inline error on failure, calls `router.refresh()` on success (mirror `ImportSection.tsx`'s fetch/busy/error pattern).
- [ ] Build `ReconcileWorkspace`: an account `<Select>` (Plaid + manual accounts, changing it navigates via `router.push` to `?account=...`); a summary `Panel` showing cleared balance, statement balance, and the difference, styled `tone="success"` when `balanced` and `tone="warning"` otherwise; an outstanding-transactions list (reuse `MerchantAvatar`/`formatCurrency` like the ledger row) each with a checkbox that `PATCH`es `/api/reconcile/cleared` and optimistically moves the row between the cleared/outstanding lists; an empty state ("No statement entered yet for this account") when `statements` is empty; and a "Record balance adjustment" `ButtonLink` to `/transactions?openAdd=1` (or, if `AddTransactionModal` doesn't support a deep-link-to-open prop yet, render an inline `AddTransactionModal` instance scoped to the selected account) for the case where the bank is right and the ledger needs a correction — this reuses the existing audited, reversible manual-transaction path from `app/api/transactions/manual/route.ts` rather than inventing a new one.
- [ ] Verify all four UI states by hand in the dev server: empty (no statement yet), loading (React Suspense via `app/reconcile/loading.tsx`), error (`app/reconcile/error.tsx` shown on a thrown loader error), success (balanced and unbalanced cases) — check both light and dark themes and a 375px viewport.
- [ ] Commit with `feat(reconcile): add reconcile workspace UI`.

### Task 8: Full verification pass

**Files:** none (verification only)

- [ ] Run `npm run lint` and fix any violations introduced by this feature.
- [ ] Run `npm run test:unit` and confirm every new test passes alongside the existing suite.
- [ ] Run `npm run build` and confirm it succeeds (this is also the fastest full type/route check per `CLAUDE.md`).
- [ ] If integration tests are runnable in this environment (`.env.local` + applied migrations present), add an RLS-focused case to `tests/integration/roadmap-rls.test.ts` (or the nearest equivalent) proving user B cannot read, insert, or delete user A's `reconciliation_statements` rows, and cannot toggle `cleared_at` on user A's transaction via the cleared route.
- [ ] Update `docs/HANDOFF.md` and `docs/TODO.md` per the project convention of updating both when finishing significant work.
