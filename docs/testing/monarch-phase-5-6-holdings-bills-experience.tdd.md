# Monarch Alignment Phases 5 and 6 TDD Evidence

## User journeys

As a FundFlow user, I want per-item investment sync status so a missing portfolio is explained instead of invented, and a real credit-card bill (statement balance, due date) so the Recurring credit-card bucket is populated only from real data.
As a FundFlow user, I want a calendar, editable life-event forecasting, a weekly recap entry point, and the ability to pin/reorder advice topics.

## RED evidence

Commit `e2d7293` preserves failing tests proving the credit-card bill model, liabilities sync, and recurring bucket do not exist.
Commit `e1f4bcf` reproduces the missing recurring calendar.
Commit `0f447a3` reproduces the missing life-event model and projection recalculation.
Commit `16d8f6e` reproduces the missing weekly-report delivery loader and dashboard widget.

## GREEN evidence

### Phase 5.1: Holdings synchronization

`tests/unit/investment-sync.test.ts` covers success, an empty portfolio (synced with 0), product-unavailable, product-not-ready, rate-limiting, partial responses, and mark-and-sweep safety. `tests/unit/investment-sync-status.test.ts` proves the Investments page loader reports per-item outcomes and staleness scoped to the caller, and the page renders a Sync status panel alongside the honest account-balance fallback.

### Phase 5.2: Credit-card bills

`tests/unit/credit-bill-schema.test.ts` and the applied migration `20260829150000_credit_card_bills.sql` model statement balance, minimum payment, due date, payment account, and sync timestamp separately from purchases, with owner-scoped RLS and an M8 account-ownership check.
`tests/unit/liabilities-sync.test.ts` proves the approved Plaid Liabilities sync distinguishes synced / product_not_ready / no_liabilities / rate_limited and never invents a bill; it is wired into the daily cron.
`tests/unit/recurring-credit-bill.test.ts` proves the Recurring credit-card bucket is populated only from real statement balances due in the selected month; card purchases stay Expenses and the bill payment is a transfer, so nothing is double-counted.
`tests/integration/credit-card-bill-rls.test.ts` proves the owner can write a bill and user B cannot write one against user A's credit account.

### Phase 6.1: Recurring calendar

`tests/unit/recurring-calendar-render.test.ts` proves the Sunday-first grid, roving-tabindex arrow-key day navigation (with edge clamping), and the accessible grid + table twin without leaking identifiers. The Recurring page gains a URL-backed List/Calendar toggle preserving month, scope, and tab.

### Phase 6.2: Life-event forecasting

`tests/unit/life-events.test.ts` proves typed events (home purchase, child, income change, expense change, retirement) are validated, apply deterministically over the existing projection engine, and stack cumulatively.
`tests/unit/life-events-route.test.ts` proves owner-scoped create/update/delete with audit and rejection of invalid values and cross-user edits. The Forecasting page renders the LifeEventsPanel (explicit assumptions, non-guarantee disclosure, live recalculation) backed by the `life_events` migration.

### Phase 6.3: Weekly recap and advice prioritization

`tests/unit/weekly-recap-widget.test.ts` and `weekly-recap-widget-render.test.ts` prove the delivery loader is caller-scoped and the dashboard widget renders empty, preparing, delivered, and delivery-failed states with a link to the full report.
`tests/unit/advice-priorities-route.test.ts` and `advice-priorities-render.test.ts` prove the authenticated priorities route validates ids against the educational library, persists scoped to the owner, and audits; the UI provides keyboard-accessible pin/reorder/remove controls without changing the content contract.

## Financial safety boundary

Holdings are never invented (empty portfolios report honestly, account balances fall back). Bills come only from Plaid Liabilities; the recurring credit-card bucket stays empty and clearly labeled without real data. Forecasts remain explicit editable assumptions, never guarantees.