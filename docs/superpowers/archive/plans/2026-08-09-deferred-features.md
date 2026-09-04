# Deferred Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship persistent receipts, complete the Budget and Investments Dashboard widgets, add Plaid institution logos, and expose OFX and QFX imports.

**Architecture:** Each vertical slice owns its migration, domain logic, route boundary, UI, tests, live verification, and commit.
Receipt and Plaid mutations use owner-scoped server routes, while Dashboard additions reuse existing RLS-scoped loaders and OFX reuses the staged import pipeline.

**Tech Stack:** Next.js 16.2 App Router, React 19, TypeScript 6, Supabase Postgres and Storage, Plaid SDK 43, Sharp 0.35.3, Vitest 4, and Playwright 1.61.

## Global Constraints

The work remains on `fix/shipped-defects` and PR #99.
Every service-client operation includes an explicit `user_id` predicate.
Create migrations with `npx supabase migration new <slug>` and apply them live before code reads new columns.
No receipt image, OCR text, signed URL, or storage path enters logs or exports.
Run focused tests before each commit and the complete gate after the program.

---

### Task 1: Secure receipt persistence

**Files:**

- Create with Supabase CLI: migration slug `secure_receipts_server_writes`
- Modify: `tests/unit/roadmap-schema-completion.test.ts`
- Modify: `tests/integration/roadmap-rls.test.ts`

**Interfaces:** Produces owner-only receipt reads and route-only table and Storage mutations.

- [ ] Write failing schema assertions for revoking authenticated insert, update, and delete, replacing `receipts_all_own` with `receipts_select_own`, and dropping `receipt_objects_all_own`.
- [ ] Run `npm run test:unit -- tests/unit/roadmap-schema-completion.test.ts` and confirm failure.
- [ ] Run `npx supabase migration new secure_receipts_server_writes` and implement the exact grants and policies from the design.
- [ ] Extend the live RLS suite so user B cannot read or mutate user A's receipt row or object.
- [ ] Apply the migration through the linked direct-query workflow and verify `information_schema.role_table_grants`, `pg_policies`, and Storage policies.
- [ ] Run the focused unit and integration tests.
- [ ] Commit with `fix(receipts): require server-side mutations`.

### Task 2: Build receipt matching and image normalization

**Files:**

- Create: `lib/receipts.ts`
- Create: `lib/receipt-image.ts`
- Create: `tests/unit/receipts.test.ts`
- Modify: `app/api/ai/receipt/route.ts`
- Modify: `package.json`
- Modify mechanically: `package-lock.json`

**Interfaces:** Produces `findReceiptCandidates(input, transactions): ReceiptCandidate[]` and `normalizeReceiptImage(file): Promise<NormalizedReceiptImage>`.

- [ ] Run `npm install --save-exact sharp@0.35.3`.
- [ ] Write failing matcher tests for exact amount, one-percent tolerance, three-day boundaries, merchant ranking, zero totals, and deterministic ties.
- [ ] Write failing image tests for JPEG, PNG, WebP, GIF, MIME mismatch, malformed bytes, metadata removal, and the five-megabyte limit.
- [ ] Run `npm run test:unit -- tests/unit/receipts.test.ts` and confirm failure.
- [ ] Implement calendar-day comparison, percent difference, normalized merchant-token ranking, and stable transaction-id ordering.
- [ ] Implement Sharp decoding, orientation, metadata stripping, safe re-encoding, and decoded-format validation.
- [ ] Replace duplicated AI-route matching with `findReceiptCandidates`.
- [ ] Run receipt and AI-route tests.
- [ ] Commit with `feat(receipts): add secure image processing and matching`.

### Task 3: Implement receipt APIs

**Files:**

- Create: `app/api/receipts/route.ts`
- Create: `app/api/receipts/[id]/route.ts`
- Create: `tests/unit/receipts-route.test.ts`
- Modify: `lib/audit.ts`

**Interfaces:** Produces `POST` and `GET /api/receipts`, plus `PATCH` and `DELETE /api/receipts/[id]`.

- [ ] Write failing route tests for authentication, malformed multipart data, rate limiting, upload cleanup, signed URLs, owner-scoped list, attach ownership, ignore, restore, delete ordering, and audit metadata.
- [ ] Run the focused route tests and confirm failure.
- [ ] Implement `POST` in the order `requireUser`, rate limit, validate, normalize, service upload, service insert with `user_id`, audit, and JSON.
- [ ] Remove the object when row insertion fails after upload.
- [ ] Implement owner-visible `GET` with one-hour signed URLs and no returned storage paths.
- [ ] Implement `PATCH` with `RouteContext<'/api/receipts/[id]'>`, awaited params, one action per request, and ownership checks for both receipt and transaction.
- [ ] Implement `DELETE` by removing the object first and then the owner-scoped row, leaving the row recoverable when object deletion fails.
- [ ] Run route tests and commit with `feat(receipts): add persistent receipt API`.

### Task 4: Add the receipt inbox

**Files:**

- Create: `app/transactions/receipts/page.tsx`
- Create: `components/transactions/ReceiptInbox.tsx`
- Create: `tests/unit/receipt-inbox-render.test.ts`
- Create: `tests/e2e/receipts.spec.ts`
- Modify: `app/transactions/page.tsx`
- Modify: `components/settings/ReceiptScanSection.tsx`

**Interfaces:** Consumes Task 3 APIs and produces `/transactions/receipts`.

- [ ] Write failing render tests for unmatched-first ordering, signed viewing, candidate attachment, ignored restore, deletion, errors, and empty state.
- [ ] Implement the server page so data loads server-side and only interactive inbox behavior enters the client bundle.
- [ ] Implement upload, attach, ignore, restore, and delete with local updates only after successful responses.
- [ ] Add a Receipts link to Transactions and Save to receipt inbox to the successful scanner state.
- [ ] Reproduce the end-user journey with two users, including cross-user denial and console checks.
- [ ] Run focused unit and E2E tests twice.
- [ ] Commit with `feat(receipts): add persistent inbox`.

### Task 5: Complete Dashboard widget data

**Files:**

- Modify: `lib/dashboard.ts`
- Modify: `lib/dashboard-widgets-data.ts`
- Modify: `components/dashboard/OverviewView.tsx`
- Modify: `components/dashboard/DashboardWidgetGrid.tsx`
- Modify: `components/dashboard/widgets/BudgetWidget.tsx`
- Modify: `components/dashboard/widgets/InvestmentsWidget.tsx`
- Create: `tests/unit/dashboard-investments-data.test.ts`
- Modify: `tests/unit/dashboard-widgets-render.test.ts`
- Modify: `tests/unit/dashboard-extended.test.ts`

**Interfaces:** Produces `DashboardBudgetGroup[]` and `loadDashboardInvestmentSummary`.

- [ ] Write failing budget tests for three expense groups, income exclusion, zero-limit behavior, worst status, and sum preservation.
- [ ] Add `group_name` to the existing budgets query and derive grouped rows without another query.
- [ ] Replace envelope ranking with all non-empty group rows using `ProgressBar`.
- [ ] Write failing investment tests for latest-two-date filtering, nullable day change, top-three movers, and no hidden-widget query.
- [ ] Implement `loadDashboardInvestmentSummary` by reusing holdings, snapshots, and `buildInvestmentsPage` after retaining the latest two dates.
- [ ] Normalize widget preferences once in `OverviewView` and conditionally load the summary only when visible.
- [ ] Render total, nullable day change, top movers, and the existing honest empty state.
- [ ] Run Dashboard tests and commit with `feat(dashboard): complete budget and investment widgets`.

### Task 6: Capture and render institution logos

**Files:**

- Create with Supabase CLI: migration slug `plaid_institution_branding`
- Create: `lib/plaid-institution.ts`
- Create: `scripts/backfill-institution-logos.ts`
- Modify: `lib/plaid-service.ts`
- Modify: `app/api/plaid/exchange/route.ts`
- Modify: `app/api/plaid/reconnect/route.ts`
- Modify: `components/ui/Avatar.tsx`
- Modify: `lib/accounts-page.ts`
- Modify: `components/accounts/AccountRow.tsx`
- Modify: `app/accounts/page.tsx`
- Modify: `tests/unit/plaid-service-lib.test.ts`
- Modify: `tests/unit/api-plaid-direct-routes.test.ts`
- Modify: `tests/unit/plaid-reconnect-route.test.ts`
- Modify: `tests/unit/accounts-page.test.ts`

**Interfaces:** Produces nullable raw base64 `institution_logo`, `institution_brand_color`, and `fetchInstitutionBranding`.

- [ ] Create the migration, add both nullable text columns, write schema assertions, apply it live, and verify the columns before reader changes.
- [ ] Write failing tests for `include_optional_metadata: true`, base64 validation, best-effort failures, exchange persistence, and reconnect refresh.
- [ ] Implement a shared helper that returns validated logo, normalized brand color, and name without failing connections on metadata errors.
- [ ] Extend `storeItem`, exchange, and reconnect to persist branding.
- [ ] Implement a resumable backfill that calls Plaid once per institution id, scopes every update by `user_id`, and prints counts without payloads.
- [ ] Run the backfill live and record totals only.
- [ ] Write failing avatar and account-projection tests for data URI construction, malformed fallback, and no per-row queries.
- [ ] Thread logo data through account projection and render with deterministic initial fallback.
- [ ] Run focused tests and commit with `feat(plaid): add institution branding`.

### Task 7: Wire OFX and QFX into staged import

**Files:**

- Modify: `app/api/import/preview/route.ts`
- Modify: `components/settings/ImportReviewSection.tsx`
- Modify: `tests/unit/import-routes.test.ts`
- Modify: `tests/unit/import-ofx.test.ts`

**Interfaces:** Adapts `parseOfx` output to the existing normalized import-review contract.

- [ ] Add failing route tests proving SGML and XML fixtures reach `buildImportReview` without CSV mapping.
- [ ] Map OFX rows to `{ date, merchant: description, amount, category: null }` and reject files with no valid rows.
- [ ] Accept CSV, OFX, and QFX and hide CSV-only sign and mapping controls for detected OFX files.
- [ ] Run import tests and commit with `feat(import): add OFX and QFX review`.

### Task 8: Verify and document deferred features

**Files:**

- Modify: `docs/HANDOFF.md`
- Modify: `docs/TODO.md`

- [ ] Run `npx tsc --noEmit`, `npm run lint`, `npm run test:unit`, `npm test`, `npm run build`, and `git diff --check`.
- [ ] Run Receipts, Dashboard, Accounts, Settings import, and Transactions E2E journeys twice without retries.
- [ ] Record migration ids, live verification, logo-backfill counts, exact test totals, and remaining final visual work.
- [ ] Commit with `docs: record deferred feature completion`.
