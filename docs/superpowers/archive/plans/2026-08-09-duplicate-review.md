# Synced Transaction Duplicate Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect near-identical purchases across connected sources, let the owner choose the canonical transaction, and exclude only the confirmed duplicate from every finance projection without deleting synced data.

**Architecture:** A pure deterministic detector proposes pairs, a private database function confirms a link atomically, server routes persist decisions, and the canonical projection layer applies excluded ids before other finance transformations.

**Tech Stack:** Next.js 16.2 App Router, React 19, TypeScript 6, Supabase Postgres, Vitest 4, and Playwright 1.61.

## Global Constraints

The work remains on `fix/shipped-defects` and PR #99.
Confirming a duplicate never deletes or mutates a provider-synced transaction.
Every service-client operation includes an explicit `user_id` predicate.
Household visibility never grants authority to confirm or undo another member's pair.
Create migrations with `npx supabase migration new <slug>` and apply them live before code reads the table.

---

### Task 1: Add atomic duplicate-link persistence

**Files:**

- Create with Supabase CLI: migration slug `linked_transaction_duplicates`
- Modify: `tests/unit/roadmap-schema-completion.test.ts`
- Modify: `tests/integration/roadmap-rls.test.ts`

**Interfaces:** Adds owner-readable `linked_duplicates` and a service-only private confirmation function.

- [ ] Write failing schema tests for columns, foreign keys, timestamps, per-role uniqueness, owner-only select, revoked mutations, function schema, and execute grants.
- [ ] Run the focused schema test and confirm failure.
- [ ] Generate the migration and create the table with constraints that prevent an id from participating in conflicting links.
- [ ] Create the private atomic function that verifies both transactions belong to the supplied user, rejects equal ids and conflicts, inserts the link, and records the confirmed review decision.
- [ ] Revoke function execution from public, anon, and authenticated and grant it only to service role.
- [ ] Extend live RLS coverage for cross-user reads, confirmation attempts, and undo attempts.
- [ ] Apply the migration through the linked direct-query workflow and verify table policies, grants, constraints, and function privileges.
- [ ] Run focused tests and commit with `feat(duplicates): add atomic link persistence`.

### Task 2: Implement deterministic duplicate detection

**Files:**

- Modify: `lib/transaction-quality.ts`
- Modify: `tests/unit/transaction-quality.test.ts`

**Interfaces:** Produces `detectDuplicatePairs(transactions, decisions): DuplicatePair[]` with a stable subject id.

- [ ] Write failing tests for exact cent matching, normalized merchant equality, two-calendar-day boundaries, same-account rejection, different-item acceptance, non-expense rejection, dismissed decisions, and confirmed decisions.
- [ ] Add cases proving each transaction appears at most once and ambiguous repeated purchases resolve deterministically.
- [ ] Run the focused unit test and confirm failure.
- [ ] Implement candidate ordering by date distance, normalized merchant, amount, and transaction id.
- [ ] Build each subject id from lexicographically sorted transaction ids joined by a colon.
- [ ] Reuse the existing normalization and decision helpers where their contracts match.
- [ ] Run focused tests and commit with `feat(duplicates): detect cross-source duplicates`.

### Task 3: Implement duplicate-review APIs

**Files:**

- Create: `app/api/transactions/duplicates/route.ts`
- Create: `app/api/transactions/duplicates/[subjectId]/route.ts`
- Create: `tests/unit/duplicate-routes.test.ts`
- Modify: `lib/audit.ts`

**Interfaces:** Produces `GET` and `POST /api/transactions/duplicates`, plus `DELETE /api/transactions/duplicates/[subjectId]`.

- [ ] Write failing tests for authentication, malformed subjects, pair ownership, unresolved listing, dismissal persistence, atomic confirmation, conflicting links, undo, missing links, and audit metadata.
- [ ] Run route tests and confirm failure.
- [ ] Implement owner-scoped `GET` by loading owned candidate transactions and decisions before running the pure detector.
- [ ] Implement `POST` for exactly one `confirmed` or `dismissed` decision and validate that the subject matches the supplied ids.
- [ ] Call the private confirmation function only after explicit owner checks for both transactions.
- [ ] Implement `DELETE` with `RouteContext<'/api/transactions/duplicates/[subjectId]'>`, awaited params, and an owner-scoped transaction that removes both link and confirmed decision.
- [ ] Keep dismissal separate from projection exclusion and emit non-sensitive audit events.
- [ ] Run focused tests and commit with `feat(duplicates): add review API`.

### Task 4: Apply exclusions to canonical finance projections

**Files:**

- Modify: `lib/finance-query.ts`
- Modify: `lib/finance-domain.ts`
- Modify: `lib/dashboard.ts`
- Modify: direct `projectFinanceTransactions` callers identified with `rg`
- Create: `tests/unit/duplicate-projections.test.ts`
- Modify: projection tests selected by the changed callers

**Interfaces:** Extends canonical projection input with confirmed excluded ids and applies them before splits, refunds, grouping, sorting, pagination, and aggregation.

- [ ] Inventory every direct `projectFinanceTransactions` call and classify whether it consumes owner or household scope.
- [ ] Write failing tests proving Dashboard, Budget, Cash Flow, Reports, Transactions totals, and weekly reports exclude only the confirmed duplicate.
- [ ] Add cases proving dismissed pairs, kept transactions, unconfirmed candidates, and another household member's links remain financially active.
- [ ] Run the focused projection tests and confirm failure.
- [ ] Load linked duplicates in the same scope as the canonical transactions and return the excluded-id set with the projection input.
- [ ] Filter confirmed excluded ids before all other finance transformations.
- [ ] Thread the shared set into legacy direct callers without reimplementing duplicate rules.
- [ ] Run every affected projection suite and commit with `feat(duplicates): exclude confirmed duplicates from totals`.

### Task 5: Add duplicate review and ledger status

**Files:**

- Create: `components/transactions/DuplicateReview.tsx`
- Create: `tests/unit/duplicate-review-render.test.ts`
- Create: `tests/e2e/duplicate-review.spec.ts`
- Modify: `app/transactions/page.tsx`
- Modify: the transaction row component selected during implementation

**Interfaces:** Adds an owner-only review panel with dismiss, keep selection, confirm, visible exclusion badge, and undo.

- [ ] Write failing render tests for both transactions, account context, keep choice, confirm enablement, dismissal, error recovery, excluded badge, and undo.
- [ ] Follow the existing Refund Review interaction pattern while requiring an explicit kept-transaction choice.
- [ ] Update local state only after successful route responses and preserve the pair on server failure.
- [ ] Keep the excluded transaction visible in the ledger with an `Excluded duplicate` badge and an Undo action.
- [ ] Add E2E data from two connected sources and verify dismiss, confirm, changed totals, both ledger rows, reload persistence, undo, and cross-user denial.
- [ ] Run focused unit and E2E tests twice and commit with `feat(duplicates): add review workflow`.

### Task 6: Verify and document duplicate review

**Files:**

- Modify: `docs/HANDOFF.md`
- Modify: `docs/TODO.md`

- [ ] Run `npx tsc --noEmit`, `npm run lint`, affected unit suites, complete Vitest, production build, and `git diff --check`.
- [ ] Run Duplicate Review, Transactions, Dashboard, Budget, Cash Flow, Reports, and weekly-report E2E coverage twice without retries.
- [ ] Verify live conflicts, ownership, projection changes, and undo without deleting either source transaction.
- [ ] Record migration id, live verification, exact test totals, and browser results.
- [ ] Commit with `docs: record duplicate review completion`.
