# FundFlow Debt and Sinking Funds Design

## Debt payoff planner

### Data contract

`lib/debt-data.ts` will load owner-visible liability accounts through the existing financial-scope helpers.
Debt balances come from account current balances, and APR values come from the existing `accounts.apr` field.
Unknown APRs use the existing 22 percent planning assumption and are marked individually as assumed.
Minimum payments use `buildPayoffPlan`'s documented maximum of 25 dollars or two percent of starting balance because the schema has no minimum-payment field.

The loader will return the normalized debts plus separate avalanche and snowball plans for the requested extra monthly payment.
An empty debt list and a non-converging plan are distinct states.
No migration or persisted scenario table is required.

### Page behavior

`/debt` will be a server-rendered planning page under the Planning navigation group.
The URL contract is `strategy=avalanche|snowball` and `extra=<non-negative decimal>`.
Invalid values normalize to avalanche and zero without throwing.
Changing strategy or extra payment uses normal navigation so the result is shareable, reload-safe, and compatible with browser history.

The page shows total balance, total monthly budget, debt-free month count, total projected interest, strategy comparison, payoff order, per-debt payoff month, and per-debt projected interest.
Every future-looking label uses the word projection.
The page never uses prediction, certainty language, or an unqualified assumed APR.
Accounts using 22 percent assumptions link directly to APR settings.
When payment cannot outrun interest, the page explains that the entered payment is insufficient instead of rendering zero values.

### Verification

Unit tests will reconcile page data against the existing deterministic debt fixtures.
Render tests will cover assumed APR disclosure, empty debt state, non-converging state, comparison totals, and projection wording.
Credentialed E2E will exercise both strategies, a changed extra payment, browser history, mobile layout, and the APR-settings link.

## Recurring sinking funds

### Single source of truth

The existing `sinking_funds` table remains the only sinking-fund source.
The goals table will not gain a third goal type.
This avoids duplicating current Budget, Dashboard, Safe-to-Spend, Settings, and E2E integrations that already consume `sinking_funds`.

### Schema

The table will add `cadence`, `custom_interval_months`, and `cycle_anchor_date`.
`cadence` accepts `one_time`, `annual`, `semiannual`, `quarterly`, or `custom` and defaults existing rows to `one_time`.
`custom_interval_months` is required only for custom cadence and is constrained to 1 through 120.
`cycle_anchor_date` defaults to the existing due date and preserves the original recurrence anchor.

Authenticated direct writes will be revoked because the repo's security contract allows browser writes only on its explicit preference tables.
Owner-only reads remain available under RLS.
Create, update, and delete operations move to `/api/sinking-funds` and use the service client with an explicit `user_id` predicate.

### Recurrence semantics

One-time funds keep their current behavior and remain due when their date passes.
Recurring funds calculate the first due date on or after the planning date by advancing from `cycle_anchor_date` by the cadence interval.
Annual advances by 12 months, semiannual by 6, quarterly by 3, and custom by `custom_interval_months`.
Calendar clamping keeps end-of-month anchors valid, so a January 31 quarterly fund resolves to the final valid day of April.

Reaching a recurring due date begins the next cycle automatically through pure date calculation.
No cron mutation or read-time database write is required.
Required monthly set-aside is target amount divided by the whole months remaining in the resolved cycle, clamped to one month at the due date.
Budget and Safe-to-Spend continue using `computeSinkingFunds`, extended with cadence-aware due-date resolution.

### User experience

The Settings form will create and edit name, target amount, first due date, cadence, and custom interval when applicable.
Each row will show its next due date and required monthly set-aside.
The Budget surface will show each fund's required monthly contribution and next due date instead of only a combined total.

### Verification

Unit tests will cover every cadence, end-of-month clamping, multiple elapsed cycles, one-time past-due behavior, and monthly-set-aside calculation.
Route tests will cover validation, ownership, update, and delete behavior.
Credentialed E2E will create a recurring fund, verify its Budget contribution, edit its cadence, reload, and delete it.

