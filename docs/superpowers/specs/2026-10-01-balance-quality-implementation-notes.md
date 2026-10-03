# Balance-quality implementation notes

Item 2.1 belongs to the six-feature data-quality/guidance group, not a separate PR.
These are implementation notes, not a new owner approval gate.
The detector, persistence, route, queue, and stale-history overlay are implemented in group 2.

## Intended behavior

Keep raw provider observations intact.
A pending review shows the raw balance, the last reliable same-currency observation and its date, and concrete reasons.
Accepting a genuine change makes that observation eligible as a future anchor.
Keeping the previous value affects account-history presentation only and is labelled stale, with the original anchor date.
The action should say "Keep previous in history" so its scope is explicit.
Do not silently alter current bank balances or rewrite raw daily observations.
A missing anchor is unknown, never zero, and cannot support carry-forward.

## Implemented integration

- Add default-off `balanceQualityReview`; skip all new snapshot processing and reads when off, and return 404 from new API routes/pages.
- Reuse `writeDailyAccountSnapshots` as the trigger after its existing raw snapshot upsert.
  Cron runs investment sync before this writer, and bank/manual request paths already call it.
- Load owner-scoped context for each recorded daily snapshot: its capture timestamp/raw value, the most recent prior unflagged or accepted account observation in the same currency, and relevant prior/current holding observations.
  A service-only SQL context function with indexed lateral lookups is preferable to unbounded PostgREST scans or silent row-limit truncation.
  Background reads must retain explicit owner filters; interactive reads use the cookie-bound client.
- Holding comparisons use stable security ids and actual successful same-item investment freshness.
  Unobserved holdings are null, not an empty list.
  Avoid comparing stale current holdings or inferring an empty response from a failed sync.
  Prior holding prices come from dates before the current daily snapshot so same-day upserts do not become their own baseline.
- Run `assessBalanceQuality` on that context, then record its result through an owner-scoped service-only RPC.
  Validate the current snapshot capture timestamp/value before recording so an older job cannot replace newer review context.
- New table: `balance_quality_reviews`, owner/account/date identity, frozen raw/anchor values, currency, reasons, captured/observed time, decision state, resolved time, and supersession metadata.
  Keep resolved decision history when a later changed observation triggers a new review.
  Repeated identical readings should not create duplicate pending reviews.
  Recovered clean observations supersede pending concerns.
- Resolution must validate the exact review and observation version and refuse a stale decision with 409.
  Keep decisions and their financial context transactionally consistent, then write the normal audit record without raw financial payloads.
- Gate every authenticated policy with session revocation and MFA checks.
  Tables are service-authored, so clients get no direct writes.
  If history overlays are shared, their read policy must exactly match existing snapshot visibility and never expand account access.
- Queue placement: Accounts, with a link to `/accounts/balance-review` and an owner-only review queue.
  Show pending and resolved history with the raw/anchor/chosen values, reasons, affected dates, and accessible actions.
- Overlay carried decisions in the Accounts history by account id/date only when their recorded raw observation still matches the snapshot.
  Extend the net-worth table twin and account trend labels to disclose carried-forward stale history.
  Exports and stored snapshots retain raw values.

## Detector currently implemented

Seven-day same-currency comparison window.
A balance jump requires both a 1,000-unit absolute change and a change at least as large as the absolute anchor balance.
Unit-price review requires a 50% change on a prior position worth at least 1,000 units, excluding a nearly conserved position value (within 2% or one currency unit).
These are review heuristics, not claims that genuine market changes are wrong.
Tests cover absent, zero, negative and unknown anchors, currency/date mismatch, stable holding ids, empty versus unobserved holdings, and offsetting stock splits.
Unit tests cover boundary validation, off-state routes/processing, and stale observation matching.
Local PostgreSQL checks cover atomic decisions, replay, stale versions, ownership and raw-value preservation.
Real component browser fixtures cover mobile/desktop keyboard actions and accessibility; signed-in Supabase journeys remain deferred.

## Reference and existing modules read

Tallyo's pinned `server-rs/src/wealth/flagging.rs` and `web/src/components/wealth/BalanceReviewModal.tsx` were read for behavior.
No implementation or fixture content was copied.
FundFlow: `lib/account-history.ts`, `lib/investment-sync.ts`, `lib/accounts-page.ts`, `app/accounts/page.tsx`, `components/accounts/NetWorthHero.tsx`, `app/api/cron/sync/route.ts`, and snapshot/RLS migrations.
Relevant architecture sections and `docs/PALETTE.md` were read.
The canonical plan and source report are included in this group as well as PR #198, so each PR can be reviewed independently.
