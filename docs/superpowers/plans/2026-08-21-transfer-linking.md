# Transfer Detection and Linking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user mark two transactions (a checking withdrawal and the matching card credit, or any pair moving money between their own accounts) as the two sides of one transfer, auto-suggest candidate pairs, and have linked pairs net out of spend/income/cash-flow the same way linked refunds already do.

**Architecture:** This is a structural clone of the existing refund-pairing feature (`components/transactions/RefundReview.tsx`, `app/api/transactions/refunds/route.ts`, `linked_refunds`) — same detector-then-decision-then-link shape, same `transaction_review_decisions` dismiss table, same netting choke point in `lib/finance-domain.ts::projectFinanceTransactions`. A new `linked_transfers` table and a widened `transaction_review_decisions.kind` constraint are the only schema changes; the projection function gains a second netting input alongside `linkedRefunds`.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase Postgres, Vitest.

**Spec:** `features.md` §3 ("Transfer detection and linking between own accounts").

## Global Constraints

- Every spend/income total must exclude `TRANSFER_GROUPS` (`lib/finance-domain.ts`) and now also exclude linked-transfer pairs — do this once, at the `projectFinanceTransactions` choke point, so every page (`getDashboardData`, Reports, Cash Flow) inherits it automatically. Do not add a second, page-local netting step.
- Anything that joins a computed result back to its source rows keys on the id, never a display name.
- A table that FKs to `transactions` must check ownership of the referenced row in its RLS `with check` (the M8 pattern), not just `user_id = auth.uid()` on the child row.
- Route handlers: `requireUser()` → early-return the `NextResponse` → `badRequest()` → work → `writeAudit()` → JSON, wrapped so failures hit `errorResponse(context, error)`.
- Create migrations with `npx supabase migration new <slug>`; apply by hand before code reads the table.
- Tests mock with `vi.mock` and import route handlers directly, using `tests/fixtures/supabase-query.ts`.
- `npm run lint`, `npm test`, and `npm run build` must pass before this is done.

---

### Task 1: Decide the link table's uniqueness model, then add the schema

Two existing precedents differ in strictness: `linked_refunds` lets the client upsert directly and only enforces `unique (user_id, charge_transaction_id, refund_transaction_id)` (a transaction *could* appear in more than one refund pair). `linked_duplicates` is stricter — `unique (user_id, kept_transaction_id)` **and** `unique (user_id, excluded_transaction_id)`, enforced only through a `SECURITY DEFINER` RPC, because a transaction must never be on more than one side of more than one duplicate link, ever.

A transfer pair has the same real-world constraint as a duplicate link: a single withdrawal is the other side of at most one deposit, ever — so **follow the `linked_duplicates` model**, not `linked_refunds`.

**Files:**

- Create with Supabase CLI: migration slug `linked_transfers`
- Modify: `tests/unit/roadmap-schema-completion.test.ts` (or the nearest schema-assertion test file, matching the style used for `linked_duplicates`)

**Interfaces:** A `SECURITY DEFINER` function `private.confirm_transaction_transfer(p_user_id uuid, p_subject_id text, p_from_transaction_id uuid, p_to_transaction_id uuid)`, and a widened `transaction_review_decisions.kind` check constraint (`'duplicate', 'refund', 'transfer'`).

- [ ] Write failing schema tests asserting: `linked_transfers` has columns `id, user_id, from_transaction_id, to_transaction_id, amount, created_at, updated_at`; `check (from_transaction_id <> to_transaction_id)`; `unique (user_id, subject_id)`, `unique (user_id, from_transaction_id)`, `unique (user_id, to_transaction_id)`; RLS enabled with `select` granted to `authenticated` but `insert/update/delete` revoked; `private.confirm_transaction_transfer` exists, is `security definer`, and `EXECUTE` is granted only to `service_role`; and that `transaction_review_decisions`'s `kind` check constraint now accepts `'transfer'`.
- [ ] Run the focused test and confirm failure.
- [ ] Generate the migration, cloning `20260809194242_linked_transaction_duplicates.sql`'s shape with transfer-specific naming:
  ```sql
  alter table public.transaction_review_decisions
    drop constraint transaction_review_decisions_kind_check;
  alter table public.transaction_review_decisions
    add constraint transaction_review_decisions_kind_check
    check (kind in ('duplicate', 'refund', 'transfer'));

  create table public.linked_transfers (
    id                    uuid primary key default gen_random_uuid(),
    user_id               uuid not null references auth.users (id) on delete cascade,
    subject_id            text not null,
    from_transaction_id   uuid not null references public.transactions (id) on delete cascade,
    to_transaction_id     uuid not null references public.transactions (id) on delete cascade,
    amount                numeric(14, 2) not null,
    created_at            timestamptz not null default now(),
    updated_at            timestamptz not null default now(),
    check (from_transaction_id <> to_transaction_id),
    unique (user_id, subject_id),
    unique (user_id, from_transaction_id),
    unique (user_id, to_transaction_id)
  );

  create trigger linked_transfers_set_updated_at
    before update on public.linked_transfers
    for each row execute function public.set_updated_at();

  alter table public.linked_transfers enable row level security;
  revoke all on public.linked_transfers from anon;
  revoke insert, update, delete on public.linked_transfers from authenticated;
  grant select on public.linked_transfers to authenticated;

  create policy "linked_transfers_select_own" on public.linked_transfers
    for select to authenticated using (user_id = (select auth.uid()));

  create or replace function private.confirm_transaction_transfer(
    p_user_id uuid,
    p_subject_id text,
    p_from_transaction_id uuid,
    p_to_transaction_id uuid
  ) returns void
  language plpgsql security definer set search_path = ''
  as $$
  declare
    v_amount numeric(14, 2);
  begin
    if p_from_transaction_id = p_to_transaction_id then
      raise exception 'transfer_ids_equal' using errcode = '22023';
    end if;
    if p_subject_id <> least(p_from_transaction_id::text, p_to_transaction_id::text)
      || ':' || greatest(p_from_transaction_id::text, p_to_transaction_id::text) then
      raise exception 'transfer_subject_mismatch' using errcode = '22023';
    end if;
    if (
      select count(*) from public.transactions
      where user_id = p_user_id and id in (p_from_transaction_id, p_to_transaction_id)
    ) <> 2 then
      raise exception 'transfer_transactions_not_owned' using errcode = '42501';
    end if;
    if exists (
      select 1 from public.linked_transfers
      where user_id = p_user_id
        and (from_transaction_id in (p_from_transaction_id, p_to_transaction_id)
             or to_transaction_id in (p_from_transaction_id, p_to_transaction_id))
    ) then
      raise exception 'transfer_link_conflict' using errcode = '23505';
    end if;

    select abs(t.amount) into v_amount from public.transactions t where t.id = p_from_transaction_id;

    insert into public.linked_transfers (user_id, subject_id, from_transaction_id, to_transaction_id, amount)
    values (p_user_id, p_subject_id, p_from_transaction_id, p_to_transaction_id, v_amount);

    insert into public.transaction_review_decisions (user_id, kind, subject_id, decision)
    values (p_user_id, 'transfer', p_subject_id, 'confirmed')
    on conflict (user_id, kind, subject_id) do update set decision = 'confirmed';
  end;
  $$;

  revoke all on function private.confirm_transaction_transfer(uuid, text, uuid, uuid) from public, anon, authenticated;
  grant execute on function private.confirm_transaction_transfer(uuid, text, uuid, uuid) to service_role;
  ```
- [ ] Apply the migration and verify the table, constraints, function, and grants exist as written.
- [ ] Run the focused schema test again and confirm it passes.
- [ ] Add `linked_transfers` to `USER_DATA_TABLES` in `lib/user-data.ts` (columns: `from_transaction_id, to_transaction_id, amount, created_at`).
- [ ] Commit with `feat(transfers): add linked_transfers schema`.

### Task 2: Implement deterministic transfer-pair detection

**Files:**

- Modify: `lib/transaction-quality.ts`
- Modify: `tests/unit/transaction-quality.test.ts`

**Interfaces:** `detectTransferPairs(transactions: TransferCandidate[], decisions: ReviewDecision[], windowDays = 3): TransferPair[]`, following the exact contract shape of the existing `detectRefundPairs`/`detectDuplicatePairs` in the same file.

- [ ] Write failing tests covering: two transactions on different accounts, opposite sign, equal absolute amount, within `windowDays` of each other are matched; a same-account pair is rejected (that's not a transfer, both sides live in one account); amounts differing by more than a cent are rejected; a pair further apart than `windowDays` is rejected; a pair already present as a `dismissed` decision (`kind: "transfer"`) is excluded from the result; a pair already `confirmed` is excluded (it's already linked, so it shouldn't resurface as a suggestion); each transaction appears in at most one suggested pair (reuse the same greedy nearest-match ordering `detectDuplicatePairs` already uses — closest date distance first, then lexicographic id tie-break — for determinism); and the subject id is `${min(id_a, id_b)}:${max(id_a, id_b)}`, matching `duplicateSubjectId`'s convention.
- [ ] Run `npx vitest run tests/unit/transaction-quality.test.ts` and confirm the new tests fail.
- [ ] Implement `detectTransferPairs` alongside `detectDuplicatePairs`/`detectRefundPairs` in `lib/transaction-quality.ts`, reusing `filterReviewDecisions`-style dismissed/confirmed filtering (widen `ReviewAnomaly["kind"]`/`ReviewDecision["kind"]` to include `"transfer"` — this requires updating every call site that pattern-matches those literal unions, which is only the refund/duplicate routes plus this file; grep `"duplicate" | "refund"` to find them all).
- [ ] Run the test file again and confirm it passes.
- [ ] Commit with `feat(transfers): detect transfer pair candidates`.

### Task 3: Implement the transfer-review API

**Files:**

- Create: `app/api/transactions/transfers/route.ts`
- Create: `tests/unit/transfer-routes.test.ts`
- Modify: `lib/audit.ts`

**Interfaces:** `GET /api/transactions/transfers` (candidate pairs, dismissed/confirmed ones filtered out) and `POST /api/transactions/transfers` (`{ subject_id, decision: "confirmed" | "dismissed", from_transaction_id, to_transaction_id, amount }`), mirroring `app/api/transactions/refunds/route.ts` exactly.

- [ ] Add `"transfer_confirmed"` and `"transfer_dismissed"` to the `AuditAction` union in `lib/audit.ts`.
- [ ] Write failing tests covering: `GET` loads the caller's own transactions (a bounded lookback window, matching the refund route's 90-day window) plus `transaction_review_decisions` where `kind = 'transfer'`, runs `detectTransferPairs`, and returns only unresolved pairs; `POST` with `decision: "dismissed"` upserts `transaction_review_decisions` (`kind: "transfer"`) and does not call the RPC; `POST` with `decision: "confirmed"` calls the service client's `confirm_transaction_transfer` RPC with the four parameters, and returns `409` when the RPC raises `transfer_link_conflict`; a successful confirm audits `"transfer_confirmed"`, a dismiss audits `"transfer_dismissed"`.
- [ ] Run the test file and confirm failure.
- [ ] Implement the route, cloning `app/api/transactions/refunds/route.ts`'s `GET`/`POST` shape but calling `private.confirm_transaction_transfer` via the service client on `confirmed` (matching how `app/api/transactions/duplicates/route.ts` calls `confirm_transaction_duplicate`, since this feature follows the duplicate-link strictness model from Task 1) and translating the `transfer_link_conflict` Postgres error into a `409` the same way the duplicates route does.
- [ ] Run the test file and confirm it passes.
- [ ] Commit with `feat(transfers): add transfer-review API`.

### Task 4: Wire linked transfers into the canonical netting projection

**Files:**

- Modify: `lib/finance-domain.ts`
- Modify: `tests/unit/finance-domain.test.ts` (or the file that currently covers `projectFinanceTransactions`'s refund-netting behavior)
- Modify: `lib/dashboard.ts`

**Interfaces:** `ProjectFinanceInput` gains `linkedTransfers: LinkedTransferPair[]` (shape `{ fromTransactionId: string; toTransactionId: string }`, parallel to the existing `LinkedRefundPair`); `projectFinanceTransactions` nets both sides of a linked transfer to `flow: "transfer"` the same way it already does for linked refunds.

- [ ] Write failing tests proving: a transaction pair present in `linkedTransfers` gets `flow: "transfer"` on both sides (so `isSpending`/`isIncome` exclude them, matching the existing refund-pair test); a transaction present in *both* `linkedRefunds` and `linkedTransfers` (shouldn't happen given the DB-level exclusivity from Task 1, but the projection is pure and shouldn't crash) still nets correctly; and `financeTotals()` over a fixture with one linked transfer pair shows unchanged spend/income totals versus the same fixture with that pair removed entirely (proving it nets to exactly zero, not a residual).
- [ ] Run the focused test and confirm failure.
- [ ] Extend `ProjectFinanceInput`/`nettedIds` in `lib/finance-domain.ts`: add `linkedTransfers` to the input type, and extend the existing `nettedIds` construction loop (currently built only from `linkedRefunds`) to also add both `fromTransactionId`/`toTransactionId` from every `linkedTransfers` pair — the existing `flow = nettedIds.has(row.id) ? "transfer" : flowFor(...)` line needs no change, since it already treats any netted id uniformly.
- [ ] Run the test again and confirm it passes.
- [ ] Wire `lib/dashboard.ts::getDashboardData` to fetch `linked_transfers` in the same `Promise.all` batch as `linked_refunds`/`linked_duplicates`, and pass it into `projectFinanceTransactions` as `linkedTransfers`.
- [ ] Commit with `feat(transfers): net linked transfers out of spend and income`.

### Task 5: Build the transfer-review UI

**Files:**

- Create: `components/transactions/TransferReview.tsx`
- Modify: `app/transactions/page.tsx` (mount the new component alongside the existing `RefundReview`)

**Interfaces:** `TransferReview` is a client component with no props, fetching `/api/transactions/transfers` on mount and rendering nothing when there's nothing to review — an exact structural clone of `components/transactions/RefundReview.tsx` with "refund" language swapped for "transfer" and a Link/Dismiss button pair per candidate pair.

- [ ] Copy `RefundReview.tsx`'s structure (`useEffect` fetch, `busyId`/`error` state, `decide()` posting `{ subject_id, decision, from_transaction_id, to_transaction_id, amount }`) into `TransferReview.tsx`, renaming the local `RefundPair` interface to `TransferPair` with fields `{ subject_id, from_id, to_id, from_merchant, to_merchant, from_date, to_date, amount }` matching whatever shape Task 3's `GET` route actually returns.
- [ ] Mount `<TransferReview />` in `app/transactions/page.tsx` next to the existing `<RefundReview />` mount point.
- [ ] Add a "Transfer" badge to the ledger row (`LedgerTableRow` in `app/transactions/page.tsx`, and its mobile twin `components/transactions/MobileLedgerList.tsx`) for a transaction present in `linked_transfers`, following the exact pattern of the existing `pending`/`Excluded duplicate`/`manual` badges — this requires `loadLedgerRowDetails` in `app/transactions/page.tsx` to gain a fourth parallel query (or fold into the existing `linked_duplicates` query batch) fetching the caller's `linked_transfers` rows and building a `transferTransactionIds: Set<string>`.
- [ ] Verify the empty state (component renders nothing), the review flow (candidate appears, Link removes it and shows the Transfer badge on both rows, Dismiss removes it and doesn't resurface on reload), light/dark themes, and the 375px mobile layout, by hand in the dev server against demo data.
- [ ] Commit with `feat(transfers): add transfer-review UI and ledger badge`.

### Task 6: Full verification pass

**Files:** none (verification only)

- [ ] Run `npm run lint`, `npm run test:unit`, and `npm run build`; fix anything this feature introduced.
- [ ] Add an RLS-focused integration test (if `.env.local` + applied migrations are available) proving user B cannot read `linked_transfers` rows belonging to user A, and that calling `confirm_transaction_transfer` with a mix of user A's and user B's transaction ids raises `transfer_transactions_not_owned`.
- [ ] Manually verify in the dev server that Splits and Transfer linking compose without double counting: split a transaction that later gets linked as one side of a transfer, and confirm `financeTotals()` still nets to zero for that pair (acceptance criterion from `features.md` §3).
- [ ] Update `docs/HANDOFF.md` and `docs/TODO.md`.
