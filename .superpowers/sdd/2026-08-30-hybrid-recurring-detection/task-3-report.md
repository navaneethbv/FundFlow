# Task 3 Report: Canonical Inferred Recurring Reconciliation

## Outcome

Implemented canonical transaction loading and inferred recurring stream reconciliation for one Plaid item or all active items owned by a user.

The implementation calls the canonical projection in mine scope, then joins bounded raw transaction metadata to canonical rows by source transaction ID.

It restricts metadata to accounts owned by the requested user and connected to the requested item.

It reads posted rows in a ten-month window using deterministic date and ID ordering with 1,000-row ranges.

It excludes pending rows, canonical transfers and refunds, canonical duplicate exclusions, and manual-account-only rows while retaining imported rows mapped to connected accounts.

## Reconciliation behavior

All candidates, existing inferred identities, Plaid streams, and Plaid join evidence are loaded before mutations begin.

Existing inferred rows are updated by ID, user, item, and inferred source without touching review, dismissal, or user amount controls.

Missing inferred rows are inserted without `onConflict`.

A PostgreSQL `23505` insert race reloads the winner by user, item, inferred source, and identity before updating it.

Join evidence is replaced exactly by deleting the scoped stream joins and inserting the current candidate transaction IDs.

Plaid wins first by exact local transaction overlap and then by account, normalized merchant identity, direction, and cadence.

Only non-null inferred review, dismissal, and amount values are transferred into null Plaid fields using Plaid row ID and owner scope.

Stale inferred rows are marked inactive only after every candidate and join operation succeeds, with item and owner filters applied.

## Test evidence

The RED test was run before the implementation and failed during module resolution because `lib/recurring-inference.ts` did not exist.

The focused Task 3 test suite now passes 6 tests.

The focused projection and refund regression suite passes 42 tests across 4 files.

TypeScript typecheck passes.

ESLint passes for both Task 3 files.

`npx npm-check-updates` reported available major updates for ESLint and TypeScript, which were not part of this task and were not applied.

## Remaining concerns

The browser E2E test remains intentionally unstaged and uncommitted for the later vertical-slice task.

Live database migration and Plaid Sandbox behavior were not exercised by this unit-focused task.
