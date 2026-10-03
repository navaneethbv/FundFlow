# Group 5: bills and membership value

This grouped change adopts six reference behaviors from the recurring-bills and membership-value workstreams.

The recurring page gains a month-pulse summary, a paycheck view behind the existing paycheck prerequisites, confirmed recurring price-change history, and a user-authored subscription quick-add catalog.

Membership settings gain a user-maintained terms model and a local card-value calculation over the canonical projection.

## Data and privacy

Recurring price history is derived from linked settled transactions and is stored in `recurring_price_changes` with an explicit `user_id` and owner-only read policy.

Card terms are user-authored configuration stored as `profiles.card_value_terms`; the existing profile policies continue to protect the column.

The card-value calculation receives canonical spend rows on the server and sends no transaction rows to an external service or AI payload.

Refund rows remain negative eligible spend, while transfers and card payments are excluded through the existing transfer groups.

Credits expire within the entered anniversary window when the user supplies an expiry month count.

Measured rewards, projection, statement credits, subjective low/base/high perks, baseline-card advantage, membership value, and total value remain separate outputs.

## Routes and flags

`GET` and `POST /api/recurring/price-changes` require the recurring-price-history flag, authenticate through `requireUser`, apply a write rate limit, scope every read by the caller, and audit successful records.

`PATCH /api/settings/card-value` requires the membership-terms-entry flag, validates the full terms envelope, writes only the caller's profile row, and audits the update.

The six new flags are `billsViews`, `recurringPriceHistory`, `subscriptionCatalog`, `membershipCardValueModel`, `membershipCardValueCalculation`, and `membershipTermsEntry`.

All six flags default off, and the page, route, and quick-add entry points remain unavailable until their flags are enabled after verification.

## Acceptance evidence

Unit tests cover leap-day anniversary windows, refunds, excluded transfers, partial history projection, credit expiry, stale terms, terms validation, feature-off routes, authenticated writes, explicit user scoping, confirmed price changes, insufficient history, and rate limiting.

The synthetic browser journey covers the month pulse, catalog quick-add, price history presentation, terms editing, credit and perk entry, keyboard interaction, 375px and desktop layouts, no horizontal overflow, and axe accessibility checks.

The migration files are additive and remain unapplied to production until explicitly authorized.
