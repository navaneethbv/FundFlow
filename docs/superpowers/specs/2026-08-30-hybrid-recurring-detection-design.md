# Hybrid Recurring Transaction Detection Design

## Purpose

The Recurring page currently depends on rows returned by Plaid's `/transactions/recurring/get` endpoint plus user-created manual recurring items.
When Plaid does not return a stream, FundFlow does not inspect its own transaction ledger for a recurring pattern, so a valid subscription or bill can remain absent from the page indefinitely.

This design keeps Plaid as the highest-confidence source and adds a deterministic local detector that fills gaps from FundFlow's canonical transaction history.
The detector persists inferred streams so the existing calendar, review, dismissal, amount override, notification, and household visibility behavior continues working.

## Goals

- Show qualifying recurring transactions even when Plaid does not return a recurring stream.
- Preserve Plaid stream IDs, transaction IDs, account IDs, cadence, status, and predicted dates whenever they are available.
- Require enough consecutive history to avoid treating ordinary repeat purchases as subscriptions.
- Keep a subscription in the same stream when its price changes.
- Support fixed subscriptions and tightly bounded variable bills without inventing unavailable payment metadata.
- Produce stable, explainable inferred streams that users can review, dismiss, or override.
- Keep recurring detection user-scoped, deterministic, paginated, and safe to retry.

## Non-goals

- FundFlow will not replace Plaid's recurring detector.
- FundFlow will not infer annual streams because three annual occurrences exceed the reliably available history.
- FundFlow will not claim Card-on-File, Merchant-Initiated Transaction, standing-order, direct-debit, or user-authentication evidence because the current transaction schema does not persist those signals.
- FundFlow will not use fuzzy or machine-learning merchant matching in this version.
- The Recurring page will not perform database writes while rendering.
- This work will not redesign the Recurring page.

## Approaches considered

### Page-load inference

The page could query transaction history and infer streams on every request.
This avoids a migration, but it repeats expensive work, produces unstable identities, and cannot reliably preserve review, dismissal, override, or notification state.
This approach is rejected.

### Sync-time materialized inference

The transaction synchronization workflow can run a local detector and persist inferred streams after transaction data is current.
This gives inferred streams stable identities and lets them use the existing recurring-stream transaction join table and user controls.
This is the selected approach.

### Local-only replacement

FundFlow could stop using Plaid recurring streams and derive every stream locally.
This would discard stronger provider evidence such as stable Plaid stream IDs, exact stream transaction IDs, and predicted next dates.
This approach is rejected.

## Source precedence

Plaid streams are authoritative when Plaid and the local detector identify the same pattern.
Manual recurring items remain explicit user-authored schedules and are never replaced or deduplicated by the detector.
Locally inferred streams exist only when no compatible Plaid stream covers the pattern.

Deduplication uses the following order:

1. Any overlap between Plaid `transaction_ids` and the inferred stream's supporting transaction IDs.
2. The same user, account, direction, normalized merchant identity, and compatible cadence.

When a Plaid stream replaces an inferred stream, FundFlow transfers compatible user state such as `reviewed_at`, `dismissed_at`, and `user_amount` before deactivating the inferred row.
The same normalized identity is stored for both sources so this transfer does not depend on display text.

## Detection input

The detector reads canonical transactions for one authenticated owner's Plaid item at a time.
Every service-client query is explicitly scoped by both `user_id` and the affected item or its account IDs even though the service client bypasses RLS.
Large result sets use deterministic ordering and explicit `.range()` pagination.

Only financially active, posted transactions are candidates.
Pending transactions, confirmed duplicate exclusions, refunds that have been netted out, user-suppressed transactions, and excluded transfer or loan-payment categories are not candidates.
Detection uses `authorized_date` when present and falls back to the posted `date` because the authorization date more closely represents when the charge occurred.
The posted date remains the occurrence date used by the existing Recurring-page matching behavior.

Candidates are separated by user, account, transaction direction, and currency before merchant or cadence analysis.
An outflow can never join an inflow, and transactions from separate accounts can never establish one inferred stream.

## Merchant identity

Plaid's enriched `merchant_name` is the preferred identity source.
The transaction `name` is used only when `merchant_name` is absent.

Normalization is deterministic and conservative.
It applies Unicode compatibility normalization, case folding, whitespace normalization, punctuation normalization, and removal of transaction-specific trailing date, reference, and masked-card tokens.
It preserves meaningful merchant words and does not apply fuzzy similarity.
An empty normalized identity is not eligible for local detection.

Recurring signifiers are evaluated separately from identity normalization.
Supported signifiers include `AUTOPAY`, `AUTO PAY`, `SUB`, `SUBSCRIPTION`, `MEMBERSHIP`, `RECURRING`, `BILL PAY`, and `DIRECT DEBIT`.
A signifier strengthens an otherwise valid candidate but can never replace the merchant, occurrence, or cadence requirements.

## Occurrence thresholds and history

A qualifying sequence must be consecutive within its cadence window.
An out-of-window gap breaks the sequence rather than being ignored.

| Cadence | Required occurrences | History window | Adjacent interval |
| --- | ---: | ---: | ---: |
| Weekly | 8 | 8 weeks | 6 to 8 days |
| Biweekly | 4 | 8 weeks | 12 to 16 days |
| Monthly | 3 | 4 months | 26 to 35 days |
| Quarterly | 3 | 10 months | 80 to 100 days |
| Annual | Not inferred | Not applicable | Plaid or manual only |

The detector evaluates the most recent complete qualifying sequence in the applicable history window.
A single transaction cannot support two inferred streams in the same detection pass.
Deterministic tie-breaking prefers more occurrences, lower cadence deviation, stronger amount evidence, and then stable transaction ID order.

## Amount patterns

Every inferred stream must satisfy one of three amount patterns.

### Fixed

All supporting amounts are equal to the cent after currency normalization.
This is the strongest local amount signal.

### Single price step

All occurrences except the newest have the same amount, and only the newest amount changes.
The changed amount remains part of the existing stream rather than creating a new merchant stream.
Both increases and decreases are accepted because a plan upgrade, downgrade, tax change, or promotional expiration can legitimately change the latest charge.
The forecast amount for this pattern is the newest amount.

### Variable or metered

Merchant identity and cadence must still satisfy every mandatory rule.
The candidate must also have a utility or bill category or a recurring description signifier.
An `online` or `other` payment channel is supporting evidence only and can never establish a variable stream by itself.
An `in store` payment channel disqualifies variable local inference.
Amounts must remain positive within their direction and no occurrence may exceed 2.5 times the sequence median.
The forecast amount for this pattern is the recent median, while the UI retains the most recent amount as historical evidence.

Food, coffee, grocery, fuel, retail, and similar discretionary merchants do not qualify under the variable rule without an explicit recurring signifier.
They may qualify under the fixed or single-price-step rules only when the full occurrence and cadence thresholds are met and the payment channel is not `in store`.

## Cadence prediction

The inferred frequency maps to the existing Plaid-compatible values `WEEKLY`, `BIWEEKLY`, `MONTHLY`, and `UNKNOWN` only where necessary for legacy safety.
Quarterly receives first-class support instead of being flattened into monthly behavior.
The next date is calculated by advancing the latest qualifying transaction by the detected cadence using calendar-aware month arithmetic for monthly and quarterly streams.
The existing bounded month-expansion logic remains responsible for producing occurrences for the selected calendar month.

For fixed and single-price-step streams, the expected amount is the newest stable amount.
For variable streams, the expected amount is the recent median.
A user-entered amount override always has highest precedence.

## Persistence model

The existing `recurring_streams` table is extended instead of creating a parallel user-control system.
Existing rows default to source `plaid`.

The migration adds:

- `source`, constrained to `plaid` or `inferred`.
- `identity_key`, containing the versioned stable identity for both sources when it can be resolved.
- `detection_version`, identifying the local algorithm version.
- `detection_evidence`, containing non-sensitive explainability data such as pattern, occurrence count, cadence deviation, and matched signifiers.

A partial unique index on user and inferred identity prevents duplicate inferred rows while allowing Plaid to return separate provider streams that happen to share a merchant and cadence.

The stable inferred `stream_id` is a versioned hash of user, account, direction, normalized merchant identity, and cadence.
It contains no readable financial description.
The account's `plaid_item_id` satisfies the existing item ownership relationship.

Supporting transactions are stored in `recurring_stream_transactions` using the existing local transaction IDs.
Join rows are replaced only for the specific inferred stream and owner.
The detector preserves existing `reviewed_at`, `dismissed_at`, and `user_amount` values during upsert.

Plaid refresh queries and mark-and-sweep operations explicitly filter `source = 'plaid'` so they can never deactivate inferred rows.
The local mark-and-sweep explicitly filters `source = 'inferred'` and runs only after a complete successful detection pass.
A failed or partial detector run leaves existing inferred rows and joins unchanged.

## Synchronization behavior

The local detector runs for the affected item after current transaction data has been persisted and after the best-effort Plaid recurring refresh has completed.
It runs for manual user synchronization and scheduled synchronization.
It also runs when imported transactions enter the same canonical account ledger.

Plaid recurring failure does not block local inference.
Local inference failure does not roll back a successful transaction synchronization, but it is recorded through the existing structured sync logging and failure metadata.

FundFlow will handle Plaid's `RECURRING_TRANSACTIONS_UPDATE` webhook by refreshing Plaid recurring streams for the affected item before reconciling local duplicates.
A valid successful Plaid response with empty inflow and outflow arrays is treated as a complete empty snapshot for Plaid-source mark-and-sweep rather than leaving stale provider streams active forever.

No page request triggers detection or mutation.
Existing users receive inferred streams after the next successful manual sync, scheduled sync, or qualifying import refresh.

## Recurring page behavior

The calendar, totals, review banner, dismissal action, and amount override continue using the existing recurring-stream flow.
The occurrence source union adds `inferred` alongside `plaid` and `manual`.

An inferred entry receives a subtle `Detected from transactions` label and exposes its supporting occurrence count in accessible text.
Plaid entries are not relabeled because their current presentation remains valid.
Manual entries remain visually distinct through their existing controls.

The page uses the newest amount for a fixed or price-stepped inferred stream and the median expected amount for a variable stream.
Historical matched transaction IDs continue determining whether a calendar occurrence is complete.

## Review, dismissal, and alerts

Inferred mature streams participate in the existing unreviewed count.
The existing authenticated recurring route continues applying review, dismissal, restoration, and amount overrides because inferred rows use the same owner-scoped table.

The first successful local detection pass seeds existing inferred subscriptions silently.
Later newly inferred streams may use the existing new-subscription notification behavior.
A newest-amount change on a previously persisted fixed stream may use the existing price-change notification behavior.
Deduplication prevents Plaid and local detection from issuing duplicate notifications for the same identity.

## Security and household scope

Detection and persistence operate on the actual owner, never on an unscoped household result set.
Household visibility continues being provided by existing RLS policies when the page reads recurring rows.
Only the actual owner can mutate review, dismissal, or override state.

The migration adds no authenticated direct-write policy for inferred streams.
All inferred persistence uses the service client with explicit user, item, and source filters.
`detection_evidence` stores classification facts only and never stores access tokens, full account identifiers, or raw descriptions beyond values already present in the protected transaction tables.

## Observability

Synchronization metadata distinguishes Plaid streams returned, inferred streams active, inferred streams added, inferred streams deactivated, and deduplicated candidates.
Detector failures use stable error labels without logging merchant descriptions or transaction details.
The Recurring page's existing stale-data warning remains based on the most recent successful transaction sync.
Stable inferred IDs, the partial unique index, deterministic join replacement, and item-scoped mark-and-sweep make concurrent retries converge on the same state.

## Verification

Pure unit tests cover:

- Eight consecutive weekly occurrences across eight weeks.
- A missing weekly occurrence breaking continuity.
- Four consecutive biweekly occurrences across eight weeks.
- Three monthly occurrences within four months.
- Three quarterly occurrences within ten months.
- Annual exclusion.
- Authorized-date cadence with posted-date occurrence matching.
- Exact fixed amounts.
- A single newest price increase and decrease.
- A bounded variable utility bill.
- Rejection of irregular amounts and extreme outliers.
- Conservative merchant normalization and noisy reference suffixes.
- Rejection of empty identities, pending rows, transfers, refunds, duplicates, and in-store variable purchases.
- Account, direction, currency, and user isolation.
- Deterministic candidate selection and single-use transaction evidence.

Persistence and integration tests cover:

- Paginated canonical transaction loading.
- Stable inferred IDs and idempotent reruns.
- Join replacement scoped to one owner and stream.
- Plaid-first deduplication by transaction ID and normalized identity.
- User-state transfer when Plaid replaces an inferred stream.
- Independent Plaid and inferred mark-and-sweep behavior.
- Preservation of existing inferred rows after a failed or partial run.
- Empty successful Plaid snapshots deactivating stale Plaid streams.
- RLS and service-client ownership boundaries.
- Manual, scheduled, import, and recurring-webhook orchestration.

End-to-end coverage reproduces the user-facing defect:

1. Seed qualifying posted transactions while Plaid recurring streams are absent.
2. Run the same synchronization action available to a user.
3. Open the Recurring tab.
4. Verify the inferred stream, expected amount, cadence label, occurrence history, and source label.
5. Verify review, dismissal, reload persistence, restoration, and amount override.
6. Add a newest price change, synchronize again, and verify the same stream identity remains with the updated expected amount.
7. Add an overlapping Plaid stream and verify only the Plaid-backed entry remains while user state is preserved.

Local verification includes focused unit and integration tests, the complete unit suite, type checking, lint, production build, migration smoke checks, and recurring E2E coverage.
Remote verification requires the current PR head to pass CI, E2E smoke, Vercel, Sonar, CodeQL, and the repository's other required checks before merge readiness is reassessed.
