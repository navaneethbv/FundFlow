# Hybrid Recurring Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Materialize reliable local recurring streams from FundFlow transaction history whenever Plaid omits them, while preserving Plaid precedence and existing recurring controls.

**Architecture:** Add a pure deterministic detector and a server-only reconciliation layer that runs after transaction and Plaid recurring synchronization. Persist inferred rows in the existing recurring tables, deduplicate them against Plaid, and expose inferred provenance through the existing Recurring page.

**Tech Stack:** Next.js 16.3 App Router, TypeScript 6, Plaid Node 46, Supabase Postgres and RLS, Vitest 4, Playwright 1.62.

**Spec:** `docs/superpowers/specs/2026-08-30-hybrid-recurring-detection-design.md`

## Global Constraints

- Weekly requires 8 consecutive occurrences in 8 weeks with 6 through 8 day gaps.
- Biweekly requires 4 consecutive occurrences in 8 weeks with 12 through 16 day gaps.
- Monthly requires 3 consecutive occurrences in 4 months with 26 through 35 day gaps.
- Quarterly requires 3 consecutive occurrences in 10 months with 80 through 100 day gaps.
- Annual remains Plaid-provided or manual only.
- Plaid wins every deduplication conflict.
- Recurring text strengthens a candidate but never replaces identity, occurrence, and cadence requirements.
- Do not claim Card-on-File, Merchant-Initiated Transaction, standing-order, direct-debit, or authentication evidence that FundFlow does not persist.
- Scope service-client operations by `user_id`, item, and source.
- Page large reads with deterministic ordering and `.range()`.
- Do not add authenticated writes to provider-owned recurring tables.
- Do not write from the Recurring page render path.
- Preserve review, dismissal, restoration, overrides, household visibility, and manual entries.
- Do not edit generated changelogs or commit `graphify-out/`.
- Do not use an em dash character in source, tests, docs, commits, or PR text.

## File Structure

- `lib/recurring-detection.ts`: pure normalization, hashing, cadence, amount, and candidate logic.
- `lib/recurring-inference.ts`: server-only loading, persistence, deduplication, state transfer, and mark-and-sweep.
- `supabase/migrations/20260830190000_hybrid_recurring_detection.sql`: source and evidence schema.
- `lib/recurring.ts`: Plaid refresh and hybrid orchestration.
- `lib/recurring-page.ts` and `lib/recurring-data.ts`: quarterly and inferred projection.
- Recurring list and calendar components: accessible inferred provenance.
- Sync, cron, webhook, and import routes: approved refresh triggers.
- Focused Vitest and Playwright files: regression and lifecycle proof.

## E2E-first Bug Reproduction

- [ ] Add `infers a monthly stream when Plaid omits it` to `tests/e2e/recurring.spec.ts` before production code.
- [ ] Seed three monthly posted transactions named `E2E LOCAL RECURRING 130` in one connected test account with no matching recurring stream.
- [ ] Visit `/recurring` and expect the merchant and `Detected from 3 transactions`.
- [ ] Run the focused test below and record the expected pre-fix failure.

```bash
npx playwright test tests/e2e/recurring.spec.ts --grep "infers a monthly stream when Plaid omits it" --project=chromium
```

Expected before implementation: FAIL because the current page only reads persisted Plaid and manual streams.
Keep the failing test uncommitted until the completed vertical slice passes.

---

### Task 1: Add inferred stream schema

**Files:**

- Create: `supabase/migrations/20260830190000_hybrid_recurring_detection.sql`
- Create: `tests/unit/recurring-inference-schema.test.ts`

**Interfaces:**

- Consumes: `public.recurring_streams` and its service-only mutation model.
- Produces: `source`, `identity_key`, `detection_version`, `detection_evidence`, and inferred identity uniqueness.

- [ ] **Step 1: Write the failing schema test**

```ts
const sql = readFileSync("supabase/migrations/20260830190000_hybrid_recurring_detection.sql", "utf8");
expect(sql).toMatch(/source\s+text\s+not null\s+default 'plaid'/);
expect(sql).toContain("source in ('plaid', 'inferred')");
expect(sql).toContain("recurring_streams_inferred_identity_unique");
expect(sql).toContain("where source = 'inferred' and identity_key is not null");
expect(sql).toContain("revoke insert, update, delete on public.recurring_streams from authenticated");
expect(sql).not.toContain("for update to authenticated");
```

- [ ] **Step 2: Verify the test fails**

```bash
npx vitest run tests/unit/recurring-inference-schema.test.ts
```

- [ ] **Step 3: Add the exact migration contract**

```sql
alter table public.recurring_streams
  add column source text not null default 'plaid'
    check (source in ('plaid', 'inferred')),
  add column identity_key text,
  add column detection_version integer
    check (detection_version is null or detection_version > 0),
  add column detection_evidence jsonb not null default '{}'::jsonb
    check (jsonb_typeof(detection_evidence) = 'object');

create unique index recurring_streams_inferred_identity_unique
  on public.recurring_streams (user_id, identity_key)
  where source = 'inferred' and identity_key is not null;

create index recurring_streams_item_source_idx
  on public.recurring_streams (plaid_item_id, source, is_active);

revoke insert, update, delete on public.recurring_streams from authenticated;
revoke insert, update, delete on public.recurring_stream_transactions from authenticated;
```

- [ ] **Step 4: Verify and commit**

```bash
npx vitest run tests/unit/recurring-inference-schema.test.ts tests/unit/recurring-route.test.ts
```

```bash
git add supabase/migrations/20260830190000_hybrid_recurring_detection.sql tests/unit/recurring-inference-schema.test.ts
```

```bash
git commit -m "feat(recurring): add inferred stream metadata"
```

### Task 2: Implement the pure detector

**Files:**

- Create: `lib/recurring-detection.ts`
- Create: `tests/unit/recurring-detection.test.ts`

**Interfaces:**

- Consumes: Posted canonical transaction facts.
- Produces: `detectRecurringCandidates`, `recurringIdentityKey`, and `normalizeRecurringMerchant`.

```ts
export const RECURRING_DETECTION_VERSION = 1;
export type DetectedRecurringFrequency = "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "QUARTERLY";
export type RecurringAmountPattern = "fixed" | "price_step" | "variable";

export interface RecurringDetectionTransaction {
  id: string;
  userId: string;
  plaidItemId: string;
  accountId: string;
  postedDate: string;
  authorizedDate: string | null;
  amount: number;
  flow: "income" | "expense";
  merchant: string;
  rawName: string | null;
  category: string | null;
  detailedCategory: string | null;
  paymentChannel: string | null;
  currency: string | null;
}

export interface DetectedRecurringCandidate {
  streamId: string;
  identityKey: string;
  plaidItemId: string;
  accountId: string;
  streamType: "inflow" | "outflow";
  merchantName: string;
  description: string;
  frequency: DetectedRecurringFrequency;
  amountPattern: RecurringAmountPattern;
  expectedAmount: number;
  averageAmount: number;
  lastAmount: number;
  firstDate: string;
  lastDate: string;
  predictedNextDate: string;
  category: string | null;
  transactionIds: string[];
  evidence: {
    occurrenceCount: number;
    amountPattern: RecurringAmountPattern;
    maximumCadenceDeviationDays: number;
    matchedSignifiers: string[];
  };
}

export function detectRecurringCandidates(
  transactions: readonly RecurringDetectionTransaction[],
  today: string,
): DetectedRecurringCandidate[];
```

- [ ] **Step 1: Write failing threshold and false-positive tests**

Define one `series(dates, amounts, overrides)` fixture that returns fully populated `RecurringDetectionTransaction[]` rows with stable IDs.
Use these exact date and amount series:

- Weekly pass: `2026-07-06`, `07-13`, `07-20`, `07-27`, `08-03`, `08-10`, `08-17`, `08-24`, all `$12.99`.
- Weekly gap rejection: the same sequence with `07-20` removed and `08-31` appended.
- Biweekly pass: `2026-07-01`, `07-15`, `07-29`, `08-12`, all `$24.00`.
- Monthly price step: `2026-05-15`, `06-15`, `07-15` with `$15.99`, `$15.99`, `$17.99`.
- Quarterly pass: `2025-12-15`, `2026-03-15`, `06-15`, all `$90.00`.
- Annual rejection: `2024-08-15`, `2025-08-15`, `2026-08-15`, all `$120.00`.
- Variable utility pass: monthly `$80.00`, `$120.00`, `$100.00` with a utility category.
- Variable coffee rejection: the same dates and amounts with a food-and-drink category and no recurring signifier.

Assert the passing frequency, price-step amount, variable classification, and empty rejection results directly from those fixtures.

Cover account, user, item, direction, currency, empty identity, in-store variable rejection, deterministic ranking, and one-use evidence in named tests.

- [ ] **Step 2: Verify tests fail**

```bash
npx vitest run tests/unit/recurring-detection.test.ts
```

- [ ] **Step 3: Implement conservative normalization and hashing**

```ts
export function normalizeRecurringMerchant(value: string): string {
  return value.normalize("NFKC").toUpperCase()
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\b(?:REF|ID|CARD|ACCT)\s*\d{3,}\b/gu, " ")
    .replace(/\s+/g, " ").trim();
}
```

Hash `recurring-v1`, user, account, direction, normalized merchant, and cadence with SHA-256.
Use `inferred:<hash>` for the stream ID so it contains no readable merchant text.

- [ ] **Step 4: Implement exact cadence profiles**

```ts
const CADENCES = [
  { frequency: "WEEKLY", historyDays: 56, required: 8, minimumGap: 6, maximumGap: 8 },
  { frequency: "BIWEEKLY", historyDays: 56, required: 4, minimumGap: 12, maximumGap: 16 },
  { frequency: "MONTHLY", historyDays: 124, required: 3, minimumGap: 26, maximumGap: 35 },
  { frequency: "QUARTERLY", historyDays: 310, required: 3, minimumGap: 80, maximumGap: 100 },
] as const;
```

Use `authorizedDate ?? postedDate`, break on any invalid adjacent gap, and rank deterministically by occurrence count, cadence deviation, amount strength, and transaction ID.

- [ ] **Step 5: Implement amount qualification**

Treat cent-equal values as fixed.
Treat a sole newest change after an otherwise fixed sequence as a price step.
Allow variable only with a utility or bill category or recurring signifier, reject `in store`, and reject any value above 2.5 times the median.
Forecast fixed and stepped streams with the newest amount and variable streams with the median.

- [ ] **Step 6: Verify and commit**

```bash
npx vitest run tests/unit/recurring-detection.test.ts tests/unit/date-utils.test.ts
```

```bash
git add lib/recurring-detection.ts tests/unit/recurring-detection.test.ts
```

```bash
git commit -m "feat(recurring): detect transaction patterns"
```

### Task 3: Add canonical loading and inferred reconciliation

**Files:**

- Create: `lib/recurring-inference.ts`
- Create: `tests/unit/recurring-inference.test.ts`
- Modify: `tests/fixtures/supabase-query.ts` only when a required fluent method is absent.

**Interfaces:**

- Consumes: `loadCanonicalProjection`, Task 2 candidates, `PlaidItemRow`, and recurring tables.
- Produces: item and user inference refreshes.

```ts
export interface InferredRecurringRefreshResult {
  active: number;
  added: number;
  deactivated: number;
  deduplicated: number;
}

export async function refreshInferredRecurringForItem(item: PlaidItemRow, options?: { today?: string }): Promise<InferredRecurringRefreshResult>;
export async function refreshInferredRecurringForUser(userId: string, options?: { today?: string }): Promise<InferredRecurringRefreshResult>;
```

- [ ] **Step 1: Write failing loading and reconciliation tests**

Assert user, item-account, pending, date, order, and range filters.
Assert canonical refunds, transfers, duplicates, and manual-account-only rows never reach detection.
Assert imported rows mapped to a connected account remain eligible.
Assert stable persisted rows, exact join IDs, idempotent reruns, Plaid overlap, identity overlap, state transfer, item-scoped mark-and-sweep, failed-run preservation, and hashed IDs.

```ts
expect(result).toEqual({ active: 1, added: 1, deactivated: 0, deduplicated: 0 });
expect(inferredRow).toMatchObject({ source: "inferred", status: "MATURE", detection_version: 1 });
expect(inferredRow.detection_evidence).toMatchObject({ occurrenceCount: 3 });
expect(joinRows.map((row) => row.transaction_id)).toEqual(["txn-1", "txn-2", "txn-3"]);
```

- [ ] **Step 2: Verify tests fail**

```bash
npx vitest run tests/unit/recurring-inference.test.ts
```

- [ ] **Step 3: Implement bounded loading**

Call `loadCanonicalProjection` in mine scope with a ten-month window and `excludePending: true`.
Resolve accounts with both `user_id` and `plaid_item_id`.
Page raw metadata in 1,000-row date and ID order.
Select `id,account_id,date,authorized_date,amount,merchant_name,name,pfc_primary,pfc_detailed,payment_channel,iso_currency_code,pending`.
Join metadata to canonical rows by `sourceTransactionId` and collapse valid split rows back to one source transaction.

- [ ] **Step 4: Implement prepare-then-write persistence**

Build all candidates and deduplication decisions before mutation.
Load an existing inferred row by user and identity.
Update it by row ID, user, item, and inferred source when present.
Insert it when absent, and on PostgreSQL `23505` reload the concurrent winner by user and identity before continuing.
This update-or-insert flow uses the partial unique index safely because PostgREST cannot name a partial-index predicate in `onConflict`.
Persist source, hash identity, expected amount, last amount, cadence, dates, version, and evidence while omitting all user-owned control fields.
Replace joins after update or insert resolves the local row ID.
Deactivate stale inferred rows only after every candidate and join succeeds.

- [ ] **Step 5: Implement Plaid-first deduplication**

Match transaction overlap first, then account, identity, direction, and compatible cadence.
Copy non-null inferred `reviewed_at`, `dismissed_at`, and `user_amount` only into null Plaid fields through Plaid row ID plus user ID scope.
Deactivate the inferred duplicate after state transfer.

- [ ] **Step 6: Verify and commit**

```bash
npx vitest run tests/unit/recurring-inference.test.ts tests/unit/finance-query.test.ts tests/unit/transaction-override-projection.test.ts tests/unit/refund-netting.test.ts
```

```bash
git add lib/recurring-inference.ts tests/unit/recurring-inference.test.ts tests/fixtures/supabase-query.ts
```

```bash
git commit -m "feat(recurring): reconcile inferred streams"
```

### Task 4: Correct Plaid refresh and combine sources

**Files:**

- Modify: `lib/recurring.ts`
- Modify: `tests/unit/recurring-lib.test.ts`
- Modify: `tests/unit/recurring-alerts.test.ts`
- Modify: `tests/integration/recurring.test.ts`

**Interfaces:**

- Consumes: Task 3 refreshes and Task 2 identity hashing.
- Produces: source-safe Plaid refresh and structured hybrid counts.

```ts
export interface RecurringRefreshResult {
  plaid: number;
  inferred: InferredRecurringRefreshResult;
}
```

- [ ] **Step 1: Add failing source and empty-snapshot tests**

Assert every stored Plaid read and stale update filters `source = 'plaid'`.
Prove Plaid mark-and-sweep cannot deactivate an inferred row.
Prove a valid empty Plaid response deactivates stored Plaid rows and still runs inference.
Prove a thrown Plaid error leaves stored rows unchanged.

- [ ] **Step 2: Verify failures**

```bash
npx vitest run tests/unit/recurring-lib.test.ts tests/integration/recurring.test.ts
```

- [ ] **Step 3: Implement provider isolation and hybrid reporting**

Load stored Plaid rows before handling an empty result.
Remove the successful empty-result early return.
Persist `source: "plaid"` and an identity key when account and merchant resolve.
Filter stored reads and stale updates by Plaid source.
Keep exact Plaid transaction joins.
After the per-item Plaid loop, run user inference even when one Plaid call failed.
Return `{ plaid: plaidCount, inferred }` and deduplicate alerts by identity.

- [ ] **Step 4: Verify and commit**

```bash
npx vitest run tests/unit/recurring-lib.test.ts tests/unit/recurring-alerts.test.ts tests/integration/recurring.test.ts
```

```bash
git add lib/recurring.ts tests/unit/recurring-lib.test.ts tests/unit/recurring-alerts.test.ts tests/integration/recurring.test.ts
```

```bash
git commit -m "fix(recurring): combine plaid and local streams"
```

### Task 5: Wire sync, webhook, and import triggers

**Files:**

- Modify: `app/api/plaid/sync/route.ts`
- Modify: `app/api/cron/sync/route.ts`
- Modify: `app/api/plaid/webhook/route.ts`
- Modify: `app/api/import/commit/route.ts`
- Modify: `tests/unit/api-plaid-sync.test.ts`
- Modify: `tests/unit/cron-sync-route.test.ts`
- Modify: `tests/unit/api-plaid-webhook.test.ts`
- Modify: `tests/unit/plaid-webhook-route.test.ts`
- Modify: `tests/unit/import-routes.test.ts`

**Interfaces:**

- Consumes: `refreshRecurringForUser`, `refreshRecurringForItem`, `refreshInferredRecurringForUser`, and `refreshInferredRecurringForItem`.
- Produces: Source-specific counts and every approved inference trigger.

- [ ] **Step 1: Read the installed Next.js route-handler guide before editing**

```bash
sed -n '1,260p' node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md
```

- [ ] **Step 2: Add failing manual, auto, and cron assertions**

Manual refresh must expose the structured hybrid result.

```ts
expect(await response.json()).toMatchObject({
  recurring_streams: {
    plaid: 2,
    inferred: { active: 1, added: 1, deactivated: 0, deduplicated: 0 },
  },
});
```

Auto refresh must avoid the Plaid recurring endpoint but call `refreshInferredRecurringForUser("user-1")` after transaction sync.
Daily cron must continue calling full `refreshRecurringForUser("user-1")` before notification processing.

- [ ] **Step 3: Add failing recurring webhook assertions**

For `SYNC_UPDATES_AVAILABLE`, expect `syncItemTransactions(item)` followed by `refreshInferredRecurringForItem(item)`.
For `RECURRING_TRANSACTIONS_UPDATE`, expect `refreshRecurringForItem(item)` followed by `refreshInferredRecurringForItem(item)` without `syncItemTransactions(item)`.
Require `item_id` for both supported transaction webhook codes.

- [ ] **Step 4: Add failing import assertions**

After a commit to a connected account, expect `refreshInferredRecurringForUser(user.id)`.
For manual-account-only imports, expect no inference call.
When inference throws after the durable commit, expect `logError("import.commit.recurring", error)` and retain the successful import response.

- [ ] **Step 5: Verify route tests fail**

```bash
npx vitest run tests/unit/api-plaid-sync.test.ts tests/unit/cron-sync-route.test.ts tests/unit/api-plaid-webhook.test.ts tests/unit/plaid-webhook-route.test.ts tests/unit/import-routes.test.ts
```

- [ ] **Step 6: Implement trigger behavior**

Use local-only inference for auto refresh so Plaid request volume remains unchanged.
Use the full hybrid refresh for manual and cron paths.
Add a dedicated recurring webhook handler beside existing handlers.
After the existing transaction webhook synchronization succeeds, reconcile inference for the same item.
After the recurring webhook provider refresh succeeds, reconcile inference for the same item so Plaid-first deduplication sees current provider rows.
Run post-import inference only when at least one committed row targets a connected account and contain errors in a safe logged `try/catch`.

- [ ] **Step 7: Verify and commit**

```bash
npx vitest run tests/unit/api-plaid-sync.test.ts tests/unit/cron-sync-route.test.ts tests/unit/api-plaid-webhook.test.ts tests/unit/plaid-webhook-route.test.ts tests/unit/import-routes.test.ts
```

```bash
git add app/api/plaid/sync/route.ts app/api/cron/sync/route.ts app/api/plaid/webhook/route.ts app/api/import/commit/route.ts tests/unit/api-plaid-sync.test.ts tests/unit/cron-sync-route.test.ts tests/unit/api-plaid-webhook.test.ts tests/unit/plaid-webhook-route.test.ts tests/unit/import-routes.test.ts
```

```bash
git commit -m "feat(recurring): refresh inference from sync triggers"
```

### Task 6: Project and render inferred provenance

**Files:**

- Modify: `lib/recurring-page.ts`
- Modify: `lib/recurring-data.ts`
- Modify: `components/recurring/RecurringList.tsx`
- Modify: `components/recurring/RecurringCalendar.tsx`
- Modify: `tests/unit/recurring-page.test.ts`
- Modify: `tests/unit/recurring-data.test.ts`
- Modify: `tests/unit/recurring-list-render.test.ts`
- Modify: `tests/unit/recurring-calendar-render.test.ts`

**Interfaces:**

- Consumes: `source`, `detection_evidence`, and `QUARTERLY` from persistence.
- Produces: Inferred occurrences that retain all stream controls and expose accessible provenance.

```ts
export type RecurringStreamSource = "plaid" | "inferred";

export interface RecurringDetectionEvidence {
  occurrenceCount: number;
  amountPattern: "fixed" | "price_step" | "variable";
  maximumCadenceDeviationDays: number;
  matchedSignifiers: string[];
}
```

- [ ] **Step 1: Add failing data and projection tests**

Add `QUARTERLY` to `RecurringFrequency` and expect a three-month cadence.
Load an inferred row with evidence and assert:

```ts
expect(result.view.occurrences[0]).toMatchObject({
  source: "inferred",
  evidenceCount: 3,
  frequency: "Every quarter",
});
expect(result.allStreams[0]).toMatchObject({
  source: "inferred",
  detectionEvidence: { occurrenceCount: 3, amountPattern: "fixed" },
});
```

- [ ] **Step 2: Add failing render tests**

Render inferred list and calendar entries and expect `Detected from 3 transactions`.
Expect owned inferred rows to retain `More options`, `Expected amount`, `Confirm`, and `Not recurring`.
Expect shared inferred rows to remain `Shared · view only`.
Expect no inferred label on Plaid or manual entries.

- [ ] **Step 3: Verify projection and render tests fail**

```bash
npx vitest run tests/unit/recurring-page.test.ts tests/unit/recurring-data.test.ts tests/unit/recurring-list-render.test.ts tests/unit/recurring-calendar-render.test.ts
```

- [ ] **Step 4: Implement defensive source and evidence projection**

Select `source,detection_evidence` from `recurring_streams`.
Parse evidence defensively so invalid legacy JSON becomes null.
Pass source and occurrence count through `RecurringStreamInput` and `RecurringOccurrence`.
Add `QUARTERLY: { unit: "months", amount: 3 }` and `Every quarter` to cadence maps.

- [ ] **Step 5: Generalize controls and render provenance**

```ts
function isPersistedStreamSource(source: RecurringOccurrence["source"]): source is "plaid" | "inferred" {
  return source === "plaid" || source === "inferred";
}

function inferredSourceLabel(count: number | null): string | null {
  if (count === null) return "Detected from transactions";
  return `Detected from ${count} transactions`;
}
```

Use the persisted-source predicate for lookup, shared ownership, amount correction, review, dismissal, and restoration.
Render provenance as muted secondary text without adding a token or widening the table.
Keep provenance available in the calendar's accessible table twin.

- [ ] **Step 6: Verify and commit**

```bash
npx vitest run tests/unit/recurring-page.test.ts tests/unit/recurring-data.test.ts tests/unit/recurring-list-render.test.ts tests/unit/recurring-calendar-render.test.ts
```

```bash
git add lib/recurring-page.ts lib/recurring-data.ts components/recurring/RecurringList.tsx components/recurring/RecurringCalendar.tsx tests/unit/recurring-page.test.ts tests/unit/recurring-data.test.ts tests/unit/recurring-list-render.test.ts tests/unit/recurring-calendar-render.test.ts
```

```bash
git commit -m "feat(recurring): show inferred stream provenance"
```

### Task 7: Complete the browser regression

**Files:**

- Modify: `tests/e2e/recurring.spec.ts`
- Modify: `tests/e2e/__screenshots__/chromium/visual-baseline.spec.ts/recurring-light-desktop.png` only when the approved provenance text intentionally changes it.
- Modify: `tests/e2e/__screenshots__/chromium/visual-baseline.spec.ts/recurring-dark-desktop.png` only when the approved provenance text intentionally changes it.

**Interfaces:**

- Consumes: Full hybrid synchronization and page behavior.
- Produces: Browser proof of the missing-stream fix and control persistence.

- [ ] **Step 1: Complete deterministic setup and cleanup**

Create one unique monthly sequence in a connected test account, remove matching provider and inferred rows before setup, and clean transactions, joins, and inferred rows after the test.
Trigger `/api/plaid/sync` through the same browser or authenticated request path used by the product.

- [ ] **Step 2: Assert the lifecycle**

```ts
await expect(page.getByText("E2E LOCAL RECURRING 130", { exact: true })).toBeVisible();
await expect(page.getByText("Detected from 3 transactions", { exact: true })).toBeVisible();
await expect(page.getByText("Every month", { exact: true })).toBeVisible();
```

Confirm the stream, edit its expected amount, reload, dismiss, restore, and verify persistence.
Add a newest higher transaction, synchronize again, and verify the same inferred stream ID remains with its expected amount updated.
Keep Plaid replacement proof in Task 3 integration tests instead of synthesizing provider API behavior in the browser.

- [ ] **Step 3: Run focused and complete recurring E2E**

```bash
npx playwright test tests/e2e/recurring.spec.ts --grep "infers a monthly stream when Plaid omits it" --project=chromium
```

```bash
npx playwright test tests/e2e/recurring.spec.ts --project=chromium
```

Expected: PASS with no page errors, failed application requests, unexpected console messages, or horizontal overflow.

- [ ] **Step 4: Inspect visual changes when baselines differ**

Open every changed screenshot with the workspace image viewer.
Verify provenance is readable, contained, non-overlapping, and mobile-safe.
Accept only changes caused by the approved label.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/recurring.spec.ts
```

Add recurring baseline paths only when they were intentionally accepted.

```bash
git commit -m "test(recurring): cover inferred stream lifecycle"
```

### Task 8: Verify, refresh graph, push, and update PR #130

**Files:**

- Modify PR #130 title and body through `gh pr edit`.
- Do not modify generated changelogs or stage graph output.

**Interfaces:**

- Consumes: Plaid 46, Axios 1.20 compatibility, the approved docs, and Tasks 1 through 7.
- Produces: A verified remote PR head and accurate merge-readiness evidence.

- [ ] **Step 1: Run focused tests together**

```bash
npx vitest run tests/unit/recurring-detection.test.ts tests/unit/recurring-inference.test.ts tests/unit/recurring-inference-schema.test.ts tests/unit/recurring-lib.test.ts tests/unit/recurring-alerts.test.ts tests/unit/recurring-page.test.ts tests/unit/recurring-data.test.ts tests/unit/recurring-list-render.test.ts tests/unit/recurring-calendar-render.test.ts tests/unit/api-plaid-sync.test.ts tests/unit/cron-sync-route.test.ts tests/unit/api-plaid-webhook.test.ts tests/unit/plaid-webhook-route.test.ts tests/unit/import-routes.test.ts tests/integration/recurring.test.ts
```

- [ ] **Step 2: Run complete gates separately**

```bash
npm run typecheck
```

```bash
npm run lint
```

```bash
npm test
```

```bash
npm run build
```

```bash
npm audit
```

Expected: every command exits zero and audit reports zero vulnerabilities.

- [ ] **Step 3: Check the migration**

```bash
npx vitest run tests/unit/recurring-inference-schema.test.ts tests/unit/transaction-override-ownership-schema.test.ts
```

```bash
npx supabase db push --linked --dry-run
```

Expected: tests pass and the linked dry run lists only the new recurring migration.
If linked credentials are unavailable, report the exact blocker separately.

- [ ] **Step 4: Refresh graph and inspect the exact diff**

```bash
graphify update .
```

```bash
git status --short
```

```bash
git diff --check origin/main...HEAD
```

```bash
git diff --stat origin/main...HEAD
```

```bash
git log --oneline origin/main..HEAD
```

Expected: only the Plaid upgrade, Axios fix, approved docs, recurring implementation, migration, and tests appear.

- [ ] **Step 5: Push to the existing PR branch**

```bash
git push origin HEAD:dependabot/npm_and_yarn/plaid-46.0.0
```

- [ ] **Step 6: Repurpose the PR**

Set the title to `feat(recurring): add hybrid detection and upgrade Plaid 46`.
The body must document the Plaid and Axios changes, thresholds, Plaid-first deduplication, provenance UI, migration, local gates, migration verification status, and unavailable live Plaid Sandbox evidence.
Write the body to `/tmp/fundflow-pr-130-body.md` and run `gh pr edit 130 --body-file /tmp/fundflow-pr-130-body.md` so line breaks remain intact.

- [ ] **Step 7: Verify the exact remote head and checks**

```bash
gh pr view 130 --json headRefOid,state,isDraft,mergeable,mergeStateStatus,statusCheckRollup,url,title
```

Wait for CI, E2E smoke, Vercel, Sonar, CodeQL, Codacy, and every required check on the new head.
Do not report merge readiness while any required check is pending or failing.
