# Data quality and spending guidance: group 2

[PR #199](https://github.com/navaneethbv/FundFlow/pull/199), based on main independently of deferred PR #198.
No merge, production migration, flag change, or deploy is authorized.

## Implementation checklist

- [x] 2.1 Balance-quality review queue: raw and reliable values, reasons, versioned decisions, stale carried history.
- [x] 2.2 Connection health: reconnect, sync error, account review, linked/unlinked counts, recovery actions.
- [x] 2.3 History provenance: observed/manual/estimated labels and protected observations.
- [x] 3.1 Paycheck planner: three periods, bill reserves, known/unknown bridge cash.
- [x] 3.2 Confirmed payday: explicit cadence/date and detected suggestions requiring confirmation.
- [x] 3.3 Budget allowance: budget left per day, separate from cash safe-to-spend.

## API contracts

All new endpoints use session authentication only and return 404 with their feature flag off.
Balance review reads are owner-scoped cookie-client queries with bounded pagination.
POST /api/accounts/balance-review accepts reviewId and version UUIDs plus decision accepted or carried.
It returns 200 on a committed decision, 404 for an unavailable owner review, 409 for a changed observation or previously resolved incompatible decision, and 400 for invalid input or absent carry-forward balance.
The write uses a service-only atomic function with an explicit owner argument, rate limiting, and an audit entry containing decision and identifiers only.
Raw snapshots are never changed by this decision.
The connection-health page reuses existing reconnect/repair entry points, with no new provider calls during reads.
Payday settings accept only bounded cadence/date/amount configuration through the authenticated configuration route, with independent validation of every field.
Financial computations use calendar date keys and integer minor-unit allocation, and never infer that unknown cash is zero.

## Verification

Unit behavior and off-state coverage, local lint/types/build/coverage, isolated PostgreSQL migration/RLS checks, and real component browser fixtures at 375px and desktop.
Full signed-in Supabase journeys remain deferred under the owner's Option B; no tests may use production credentials.

## Deliberate adaptations

Provider-side unlinked accounts cannot be counted from the authorized records FundFlow holds.
The connection page says "not reported" and separately counts manual accounts without a bank connection, rather than fabricating zero or making an extra provider call.
Provenance applies to per-account balance observations; existing monthly net-worth summaries and per-security holding snapshots retain their original contracts.
Legacy rows derive their source without rewriting user data.
No market, constituent, or valuation feed is added.
Paycheck plans currently require USD accounts and do not infer card statement settlement.
The allowance includes all net spending, including categories without a budget, and hides in filtered or mixed-currency views.

Paycheck bill totals exclude transfer-category loan repayments as well as internal transfers; reserve other debt payments separately until the later debt workstream connects them.
