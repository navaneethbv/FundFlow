# Group 4: ledger interactions and loan projections

This grouped change covers plan items 6.2, 6.3, 6.4, 8.1, and 8.2.

The transaction ledger keeps its server-rendered rows and adds a client keyboard controller only when `ledgerKeyboardNavigation` is enabled.
The controller moves focus with `j` and `k`, opens a row with Enter or `e`, selects it with `x`, focuses category or tags with `c` or `t`, and leaves editable controls alone.
The shortcut list exposes these actions under a Ledger section.

Bulk editing uses selected transaction ids from both responsive copies of the ledger and deduplicates them before sending a request.
The route proves ownership through the cookie-bound client, then uses an explicit user id for the service write.
Category, tag, collection, exclusion, and reviewed actions are supported.
Multi-row writes have a status message but never an Undo toast.
The selection bar is sticky on desktop and its value editor uses the existing sheet modal on mobile.

Undo is limited to single-row annotations and classification overrides.
The routes compare the expected current state before restoring the recorded inverse and return a conflict when the row changed.
The toast uses a polite live region and a keyboard-reachable Undo button.
Import commits, rule application, merchant merges, and bulk edits have no toast undo path.

`lib/amortization.ts` is a pure calendar-date calculation.
It handles zero APR, clamped leap-month payment days, payment-date rate changes, hold or reamortize strategies, dated extra payments, capped final payments, non-amortizing payments, and an explicit period-cap refusal.
The loan detail panel is gated by both `amortizationEngine` and `loanDetails`.
It shows the projected schedule, a labelled balance chart with a table twin, and interest saved by an extra monthly payment.
The existing avalanche and snowball projections remain the strategy comparison.

No migration is required for this group.
All five flags default off.
No production migration, deployment, or flag flip is included.
Signed-in Supabase journeys remain deferred under the approved disposable-target exception.
