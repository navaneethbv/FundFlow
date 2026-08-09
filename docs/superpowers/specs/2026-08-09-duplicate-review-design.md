# FundFlow Synced Transaction Duplicate Review Design

## Purpose

The duplicate review flow targets near-identical purchases that arrive from different connected sources.
Plaid idempotency already prevents a single Plaid transaction id from being inserted twice, so this feature does not repair sync duplication.
Confirming a duplicate never deletes or mutates either provider-synced transaction.

## Detection

`detectDuplicatePairs` will be a pure function beside `detectRefundPairs` in `lib/transaction-quality.ts`.
Only expense transactions with positive Plaid amounts are candidates.
A pair must have equal amounts to the cent, normalized merchant equality, dates within two calendar days, and different account ids or Plaid item ids.
Transactions from the same account are never paired because repeat purchases on one card are common.

Each transaction appears in at most one proposed pair per detection run.
Candidates are ordered by smallest date distance, then merchant, amount, and stable transaction id.
The subject id is the two transaction ids sorted lexicographically and joined by a colon.

## Persistence

The existing `transaction_review_decisions` table continues storing confirmed and dismissed duplicate decisions.
A new `linked_duplicates` table stores `user_id`, `kept_transaction_id`, `excluded_transaction_id`, and timestamps.
It has owner-only select access, no authenticated mutation grants, per-column uniqueness, and foreign keys that preserve referential integrity.

A private database function will confirm a duplicate atomically.
It will verify that both transactions belong to the supplied user, that the ids differ, and that neither id appears in either role of a conflicting link before writing the link and confirmed decision.
Execution will be revoked from public, anon, and authenticated roles and granted only to the service role.
The route will still scope every service operation by the authenticated user id.

## Projection behavior

The kept transaction remains financially active.
The excluded transaction remains stored and visible in the ledger with an Excluded duplicate badge.
Every canonical finance projection will remove confirmed excluded transaction ids before splits, refund netting, grouping, sorting, pagination, or aggregation.

`loadCanonicalProjection` will load duplicate links in the same owner or household scope as the transactions.
Legacy surfaces that call `projectFinanceTransactions` directly will supply the same excluded-id set rather than reimplement duplicate logic.
Household scope will never allow one member to confirm or undo another member's duplicate pair.

## API and UI

`GET /api/transactions/duplicates` returns unresolved owned candidate pairs.
`POST /api/transactions/duplicates` accepts a subject id, kept id, excluded id, and `confirmed` or `dismissed` decision.
`DELETE /api/transactions/duplicates/[subjectId]` removes a confirmed link and its decision so both rows return to projections.

The review panel follows the existing Refund Review interaction pattern.
It shows both dates, merchants, accounts, and amounts and requires the user to choose which transaction to keep.
Dismiss removes the suggestion without changing projections.
Confirm excludes the selected duplicate from projections and exposes an Undo action.

## Verification

Unit tests will cover detection thresholds, deterministic pairing, same-account rejection, and ambiguous repeated purchases.
Route and database tests will cover atomic confirmation, conflicting links, ownership, dismissal persistence, and undo.
Projection tests will prove Dashboard, Budget, Cash Flow, Reports, Transactions totals, and weekly reports exclude only the confirmed duplicate.
Credentialed E2E will seed transactions from two connected sources and verify dismiss, confirm, badge, changed totals, reload persistence, and undo.
