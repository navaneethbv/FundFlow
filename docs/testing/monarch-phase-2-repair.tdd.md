# Monarch Alignment Phase 2 TDD Evidence

## User journeys

As a FundFlow user, I want to know why an institution's transaction history may be incomplete (cursor health), so I can tell a safe repair from a broken connection.
As a FundFlow user, I want an authenticated, rate-limited repair action that safely backfills history without duplicating transactions, and explains when the provider needs consent or login.

## RED evidence

The first focused unit run failed because `lib/cursor-health.ts` did not exist and `plaid_items` had no cursor health columns.
Commits `8a17085` (cursor health) and `d99eebb` (repair route, bounded backfill, classification) preserve the failing tests that established both gaps.
The settings repair controls and their UI-state mapping were reproduced failing in commit `18098e8`.

## GREEN evidence

### Task 2.1: Item-scoped cursor health

`tests/unit/cursor-health.test.ts` proves `deriveCursorHealth` maps every stored fact to a state: never_synced, healthy, partial_page, backfill_incomplete, cursor_reset, failed, and non-exposure of arbitrary error text.
The same suite proves `recordCursorAttempt`/`recordCursorSuccess`/`recordCursorFailure` writes are scoped by `user_id` and `id`, clear incomplete flags on full success, and detect a reset only when a prior-success item starts with no cursor.
`tests/integration/sync.test.ts` proves re-syncing the same transaction does not create a duplicate row (idempotency by `plaid_transaction_id`) and that cursor health persists on success and on failure.
The migration `20260829100000_item_cursor_health.sql` was applied to the shared Supabase project; `tests/unit/cursor-health-schema.test.ts` asserts the columns exist in the migration set.
`updateItemCursor` and `setItemStatus` are now scoped by `user_id` across sync, webhook, reconnect, and token-rotation paths.

### Task 2.2: Authenticated repair action

`tests/unit/repair-classify.test.ts` proves `classifyRepairError` distinguishes product_not_ready, consent_required, institution_login_required, rate_limited, and generic_failure.
`tests/unit/repair-backfill.test.ts` proves `backfillItemTransactions` pages to the bound, reports a bounded result without claiming completion, applies only explicit Plaid tombstones (never sweeping absent rows), and upserts by `plaid_transaction_id` for idempotent retries.
`tests/unit/plaid-repair-route.test.ts` proves auth passthrough, missing/non-string itemId validation, 404 for a non-owned item, per-user rate limiting, each distinct provider state, unsafe-payload suppression, and the audited bounded-backfill result.
`tests/integration/repair.test.ts` proves the full route path against the shared database with a disposable owner: a stale item repairs without duplicates, a second user's repair attempt is rejected (404), and provider re-auth is flagged on the item.

### Task 2.3: Settings repair controls

`tests/unit/repair-bank-button.test.ts` and `repair-classify.test.ts` prove `runItemRepair` maps every route response (success, bounded backfill with progress, provider-conditional consent/login, rate limited, network failure) to an explicit UI state.
`tests/unit/banks-section-repair-render.test.tsx` proves one repair control renders per institution row without leaking identifiers.
`tests/e2e/repair.spec.ts` proves, with disposable seeded data and route interception, that the Repair control reaches Settings, surfaces bounded-backfill progress, and hands off to the Link update flow when the provider requires login.

## Financial safety boundary

A bounded repair never deletes local transactions merely because a partial provider response omits them: only Plaid's explicit `removed` tombstones are applied, and the intermediate cursor is persisted so a retry continues from the last completed page. Cursor health reports `partial_page` or `backfill_incomplete` until a later run drains every page, and a detected cursor reset is surfaced distinctly instead of being silently re-baselined.