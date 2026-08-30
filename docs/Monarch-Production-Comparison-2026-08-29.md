# Monarch and FundFlow Production Comparison

## Privacy boundary

This document keeps only the technical conclusions needed to maintain PR #137.
All live-account values, transaction facts, account details, goal configuration, category names, screenshots, and personal identifiers have been removed.
The comparison was read-only and did not mutate either product.
No live-data screenshot is tracked in Git.

## Confirmed technical findings

### Recurring purchase classification

An ordinary purchase paid with a credit card must remain an expense.
A credit-card statement bill is a separate liability concept and must come from bill or liability data.
Transfer and loan-payment categories remain excluded from spending totals unless the user explicitly confirms an override.

### Recurring due dates

Dashboard and Recurring must use the provider's predicted next date when available.
Fallback dates must be deterministic and calendar calculations must use the user's configured timezone.

### Source coverage and repair

The app needs per-institution transaction and investment health so missing or stale provider data is diagnosable.
Repair must be authenticated, item-locked, bounded, resumable, and idempotent.
Cursor-health flags must remain set until a complete successful run proves that history is healthy.

### Classification overrides

Provider categories remain immutable source facts.
A user may apply a display-category or cash-flow override to one transaction.
Transfer-like rows require explicit confirmation before they can count as spending or income.
Dashboard, Cash Flow, Reports, Budget actuals, Year in Money, weekly reports, AI-safe exports, CSV, and JSON must consume the same projected classification.

### Configuration import

Monarch transaction, budget, and goal imports require a preview before writes.
Conflict decisions must be validated at the API boundary.
Newer FundFlow edits must never be overwritten without a separate explicit approval.
Budget replacement must use the matched budget identity rather than a case-sensitive category lookup.

### Investments and liabilities

Investment holdings, account-balance fallback, and sync status must tell a consistent story.
Holdings attached to an imperfectly typed provider account must remain visible.
Plaid Liabilities synchronization is opt-in because it adds a billed provider request per user and run.
Known bill fields must survive an otherwise successful provider response that omits optional values.

## Phase review on PR #137

Phase 0 fixes recurring correctness and Dashboard due-date parity.
Phase 1 adds item-level observability and exact account reconciliation through an owner-scoped database aggregate.
Phase 2 adds safe repair, bounded cursor progress, lock coordination, and durable health flags.
Phase 3 adds canonical transaction overrides and conflict-aware Monarch transaction import.
Phase 4 adds validated budget and goal configuration import with stable identities and explicit decisions.
Phase 5 adds investment status, honest holding coverage, and feature-gated credit-card bill synchronization.
Phase 6 adds the accessible recurring calendar, life-event forecasting, weekly-report discoverability, and advice priorities.

All seven phases are implemented in code with focused tests.
Production readiness still depends on deploying the pending migrations in timestamp order and rerunning the live database checks.
The exact Production deployment commit and authenticated read-only browser comparison remain external verification steps.

## Deliberate deferments

Credit-score functionality remains deferred until a real provider, explicit consent model, threat model, pricing decision, and deletion policy are approved.
Commercial referral and billing surfaces are not financial-planning parity requirements.
Investment benchmark overlays remain provider-dependent.
