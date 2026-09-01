# Monarch Alignment Phase 1 TDD Evidence

## User journeys

As a FundFlow user, I want transaction and investment health reported separately for every institution so I can identify the source of missing data.
As a FundFlow user, I want a read-only account reconciliation view so I can distinguish a provider balance difference from incomplete transaction coverage.

## RED evidence

The initial focused unit run failed because `lib/sync-health.ts` did not exist.
The signed-in mobile Settings journey failed because the institution row had no Transactions or Investments status and the page had no Account reconciliation panel.
Commit `7cb49fa` preserves the failing tests that established both gaps.

## GREEN evidence

`tests/unit/sync-health.test.ts` covers healthy, stale, repair-required, product-unavailable, rate-limited, and never-synced states.
The same suite proves arbitrary stored error text is not exposed and every source query is scoped to the authenticated user.
`tests/unit/reconciliation-health.test.ts` proves asset and liability math, missing-anchor behavior, and incomplete-history behavior.
`tests/unit/reconciliation-section-render.test.ts` proves semantic table markup, a labeled mobile card twin, coverage dates, and freshness text.
The signed-in Playwright journey proves the product statuses and reconciliation surface are visible at a 390 pixel viewport without changing production data.

## Financial safety boundary

Ledger balance is calculated only when a persisted daily account balance snapshot provides an opening anchor and the post-anchor transaction history is completely paged.
When either condition is absent, FundFlow displays an unavailable state instead of inventing a number.
