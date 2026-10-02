# Rules and transaction tools group

Status: implemented locally on `feat/rules-transaction-tools`; six features are grouped in one stacked review.

## Scope

This group covers checklist items 5.4 to 5.6 and 6.5 to 6.7.

The features are a Plaid category mapping editor, local Bayes categorization, a merchant directory and merge action, projected ledger rows, a transaction calendar, and quick add.

## Contract and data model

`plaid_category_mappings` is user-authored configuration keyed by `(user_id, pfc_detailed)`.

Its RLS policies require the authenticated owner, `private.session_not_revoked()`, and `private.mfa_satisfied()`.

`transaction_annotations.classification_source` records whether a displayed category came from a user, rule, Plaid mapping, or Bayes suggestion.

`merchant_aliases` records a user-scoped source-to-target name after a merge.

The `merge_merchants` function is service-role-only and accepts an explicit user id.

It updates the user's merchant rules and annotation tags in one transaction without rewriting provider transaction rows.

FundFlow's existing `category_overrides` table maps category codes rather than merchant names, so the merge leaves it unchanged instead of rewriting unrelated category data.

The migration is unapplied and must be applied only to an approved disposable Supabase project before enablement.

## API contract

`GET /api/settings/plaid-category-mappings` returns the calling user's mapping rows.

`PUT /api/settings/plaid-category-mappings` accepts at most 200 unique `{pfc_detailed, display_category}` entries and replaces the calling user's mapping set.

The replacement uses the owner-checked `replace_plaid_category_mappings` RPC so deletion and insertion commit atomically.

`POST /api/categorization/bayes` reads at most 5,000 user rows, applies suggestions only to uncategorized rows, and returns the bounded local result.

`POST /api/merchants/merge` accepts `{source_merchant, target_merchant}` and records a user-scoped merge through the SQL function.

All three routes return 404 while their feature flag is off.

The Bayes route is rate limited and all writes are audited.

## UI contract

Settings exposes mapping controls only when `plaidCategoryMappings` is on.

The transactions page exposes the merchants link, Bayes action, projected section, calendar switcher, and quick-add affordances only when their flags are on.

Each merchant row links to the existing ledger filtered to that merchant for transaction history.

The calendar defaults to the viewer's local month, uses the sequential `--viz-1` through `--viz-7` ramp, links each day back to the ledger, and includes a table twin.

Projected rows are labelled `Projected` and are excluded from posted ledger totals.

Quick add uses the existing atomic manual transaction route and ignores the keyboard shortcut while focus is inside an input or editable element.

## Verification

Unit tests cover mapping normalization, Bayes eligibility and confidence, merchant aggregation and transfer exclusion, calendar day generation, feature-off route behavior, and the six default-off flags.

Lint, typecheck, targeted unit tests, palette validation, and the production build are required before opening the grouped PR.

The signed-in browser journey and Supabase integration checks remain deferred because no disposable Supabase project or Docker-backed local stack is available.
