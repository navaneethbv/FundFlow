# Monarch Alignment Phase 3 TDD Evidence

## User journeys

As a FundFlow user, I want to recategorize one transaction without weakening the global transfer rules, so a purchase Monarch calls Shopping but Plaid tagged TRANSFER_OUT counts as spending everywhere.
As a FundFlow user, I want Monarch notes, tags, and classification conflicts previewed before import, so re-importing never silently overwrites a newer edit.

## RED evidence

Commit `0a93b4a` preserves failing tests proving the override columns, projection handling, route, and ledger control do not exist.
Commit `91fff91` reproduces the RLS gap (user B could update/delete user A's annotation) and the missing cross-surface consistency.
Commit `1be3f3a` reproduces the missing Monarch notes/tags parsing, category-conflict detection, and review-schema columns.

## GREEN evidence

### Task 3.1: Transaction-level classification overrides

`tests/unit/transaction-override-projection.test.ts` proves a provider transfer becomes spending/income only through an explicit cash-flow classification, a display-category-only relabel never changes the flow, the override applies exactly once (split parents included), and global transfer/loan-payment exclusions stay intact for non-overridden rows.
`tests/unit/transaction-override-route.test.ts` proves ownership scoping, the deliberate-confirmation gate (transfer to spend/income without `confirmed: true` is refused), create/update/delete audit, and that the immutable provider row is never written.
`tests/unit/transaction-override-consistency.test.ts` proves the same override reaches `loadCanonicalProjection` (Reports, Budget, Year in Money, widgets), cash flow, and the privacy-safe CSV/JSON export, and that a non-overridden transfer stays excluded on every surface.
`tests/integration/transaction-override-rls.test.ts` proves, against the shared database, that the owner can set an override, user B cannot insert one on user A's transaction, and B's update/delete match zero rows while A's override survives.
The migration `20260829110000` adds `display_category` + `cash_flow_classification`; `20260829120000` hardens the write policies to the M8 ownership pattern.

### Task 3.2: Monarch import extension

`tests/unit/import-monarch-notes-tags.test.ts` proves Notes and Tags are parsed and default to absent.
`tests/unit/import-category-conflict.test.ts` proves `buildImportReview` flags a category-conflict only when an existing transaction classifies the same fingerprint differently.
`tests/unit/import-monarch-phase3.test.ts` proves the preview surfaces possible-duplicate + category-conflict and stages notes/tags, the commit refuses to overwrite an annotation edited after the batch (409) unless the row is explicitly approved, re-commit is idempotent, and a foreign batch is never touched.
Fixtures use synthetic identifiers only; no real account or transaction data is committed.

## Financial safety boundary

An override never rewrites `pfc_primary`/`pfc_detailed`; it lives beside notes/tags on the owner-scoped annotation row. Only an explicit, confirmed cash-flow classification can move a transfer into spend/income totals, and every create/update/delete is audited. Re-imports keep stable import ids and skip committed rows, so a newer FundFlow edit is never silently overwritten.