# FundFlow Feature Todos

This is the current product roadmap for FundFlow after the todos-roadmap PR
(#23): goals production pass, roadmap schema, planning read-side foundations,
Monthly Review, and Admin Observability. Older completed or deferred notes live
in `docs/TODO.md`.

## Product Direction

FundFlow is strongest as a private personal finance cockpit:

- Pull real account data through Plaid.
- Keep raw financial data private by default.
- Turn transactions into planning decisions.
- Make recurring bills, goals, budgets, and cash flow visible at a glance.
- Keep the app simple enough for 1-2 real users to trust every day.

## Status After PR #23

Done and verified:

- Goals production pass: edit support, optimistic rollback, empty/loading/
  success/completion states, dashboard pace insights, RLS integration tests.
- Roadmap schema and RLS foundation: `20260707012910_roadmap_features.sql`
  applied to the live Supabase project.
- Read-side planning foundations in `lib/planning.ts`: envelope pacing,
  30-day cash forecast, recurring week grouping, anomaly detection, net worth
  compute, AI payload filter, import review builder.
- Dashboard planning insights panels, Settings sections (merchant rules CRUD,
  manual accounts, notifications list, alert + AI preferences), Monthly Review
  page, Admin Observability page, QA runbook (`docs/QA.md`).
- Milestone 1: P0 Close the Loop:
  - Notification Producers: Alerts emitted from daily cron & sync paths for bank issue, sync failure, budget exceeded, goal reached, large transaction, and low cash forecast. Respects user preferences and dedupes daily.
  - Merchant Rules Applied: Display-time rule matching applied to transactions for both dashboard and ledger.
  - Net Worth Snapshots: Monthly assets/liabilities snapshot upserted on daily sync cron, and historical net worth line chart rendered on dashboard.
  - Email Alert Sender: Daily digest email alerts sent via SMTP, gracefully warning/skipping when SMTP is not configured.
- Milestone 2: Roadmap completion pass:
  - Transaction Quality: Added annotation, split, refund-link, and review-decision schema, plus split-safe spend aggregation, refund matching, and decision filtering helpers.
  - Import Review Queue: Added preview and commit API routes using existing CSV parsing, duplicate flags, and deterministic `import-<hash>` ids.
  - Planning Depth: Added recurring status matching, unusual amount prompts, debt payoff planning, and sinking fund suggestions.
  - Security And Account: Added active session records, MFA backup-code schema, user audit log, full takeout export route, and settings panels for sessions, passkeys, audit, and household mode.
  - Infra And Efficiency: Added isolated dashboard cache helper, installable manifest, and offline read-only service worker shell.
  - Optional AI And Household: Added deterministic privacy-safe insight generation route and household creation panel.

Schema-only or helper-only, finished by the P0/P1 items below:

- Real Plaid Sandbox browser evidence still requires live credentials and screenshots from `docs/QA.md`.

## P0: Close The Loop On PR #23

### 1. Notification Producers

The `notifications` table and mark-read UI exist. Make events actually appear.

Implementation notes:

- Emit rows from the daily cron and sync paths for: broken bank, sync failed,
  budget exceeded, goal reached, large transaction, low cash forecast.
- Respect `alert_preferences` via `shouldSendAlert()` before inserting.
- Dedupe: do not re-emit the same event for the same subject in the same day
  (for example one `budget_exceeded` per category per month).
- Service-client writes must filter and set `user_id` explicitly.
- Reuse `buildNotification()` for shape, severity, and length caps.

Tests:

- Producer emits on threshold crossing, not on every run.
- Opt-out preference suppresses the row.
- No PII or raw Plaid payloads in title or body.

### 2. Merchant Rules Applied For Real

CRUD exists in Settings; rules currently change nothing.

Implementation notes:

- Apply enabled rules at display time for transactions and dashboard
  aggregation, or persist cleaned fields at sync time; pick one and document
  the choice (display-time is simpler and reversible, start there).
- Add a preview step using `previewMerchantRules()` before bulk apply.
- Bulk apply to history must be idempotent (re-running changes nothing).
- Rule order: first matching rule wins; document and test it.

Tests:

- Rule matching order.
- Preview does not mutate data.
- Bulk apply is idempotent.
- Disabled rules are skipped.

### 3. Net Worth Snapshot Writer And Trend

`net_worth_snapshots` exists in the migration only.

Implementation notes:

- Write one snapshot per user per month from the daily cron (upsert on
  `user_id + snapshot_month`), combining Plaid balances and manual accounts.
- Add a net worth trend chart (server-rendered SVG, existing chart rules:
  table twin, `--viz-*` tokens) to the dashboard or Monthly Review.
- Service-client queries scope `user_id` explicitly.

Tests:

- Upsert is idempotent for the month.
- Manual accounts with `include_in_net_worth = false` are excluded.

### 4. Email Alert Sender

Preference toggles exist; nothing sends.

Implementation notes:

- Send from the daily cron for the alert types in `alert_preferences`,
  reusing the SMTP setup and production guards in `lib/reporting.ts`.
- Missing SMTP vars: skip sending safely in dev, throw in production, and
  record a `weekly report skipped` style notification.
- Prefer a single daily digest email over one email per event.

Tests:

- Opt-out is respected.
- Missing SMTP vars skip sending safely.
- Emails never include tokens or sensitive raw payloads.

### 5. Real Plaid Browser E2E And Mobile QA

Documented in `docs/QA.md`; still requires execution with live Sandbox
credentials and captured evidence. This gates real-bank production use.

Status: manual execution remains required. The codebase now has route and UI
coverage for the roadmap completion pass, plus the existing QA runbook for
credentialed browser evidence.

Implementation notes:

- Run the full happy path from `docs/QA.md` (signup through account delete).
- Refresh twice and confirm transaction counts do not duplicate.
- Exports contain only the privacy-safe fields promised in README.
- Mobile pass at 375px, 430px, 768px, desktop: `/dashboard`, `/transactions`,
  `/settings`, `/goals`, `/review`, `/login`, `/signup`; both themes; touch
  targets at least 44px where practical; no horizontal page scroll.
- Capture screenshots as evidence.

## P1: Transaction Quality

### 6. Transaction Search

Implementation notes:

- Search by merchant and (once added) notes/tags from `/transactions`.
- Debounced input, server-side `ilike` or Postgres full-text with an index.
- Keep results bounded and month-scoped by default so the query stays cheap.

Tests:

- Query stays scoped to the signed-in user.
- Empty query returns the normal month view.

Status: implemented on `/transactions` with server-side scoped search.

### 7. Notes, Tags, And Splits

Make the ledger feel human instead of raw bank text.

Implementation notes:

- `transaction_annotations`: user_id, transaction_id, note, tags text[].
- Splits: child rows that divide one transaction across categories; sum of
  splits must equal the parent amount; dashboard aggregation uses splits when
  present.
- Owner-only RLS; client writes allowed (this is user preference data).
- Never mutate the Plaid-synced row itself; annotations sit alongside.

Tests:

- Split totals validated server-side or by check constraint.
- Aggregation counts split categories once (no double counting).

Status: partial. Schema (`transaction_annotations`, `transaction_splits`) with
a deferred split-total constraint trigger is in place, and the dashboard
category breakdown now uses split-safe aggregation when splits exist
(`aggregateSpendWithSplits` wired into `getDashboardData`). Still missing: a UI
to add notes/tags/splits (splits can only be created directly today).

### 8. Refund Matching And Duplicate Merge

Implementation notes:

- Detect refund pairs: same merchant, opposite sign, within a window.
- Offer "link refund" so the pair nets out in spend totals.
- Extend `detectSpendingAnomalies()` duplicate detection into a review flow:
  confirm duplicate (hide one) or dismiss.
- Store decisions so re-sync does not resurface dismissed pairs.

Tests:

- Netting excludes linked refunds from spend totals.
- Dismissals persist across syncs.

Status: mostly done. Refund pairs are detected and surfaced on `/transactions`
(`RefundReview` + `/api/transactions/refunds`); linking persists to
`linked_refunds` and dismissals to `transaction_review_decisions`, so a re-sync
never resurfaces a dismissed pair. Remaining: linked refunds are stored but not
yet netted out of dashboard spend totals.

### 9. Import Review Queue UI

`buildImportReview()` and the table exist; add the flow.

Implementation notes:

- Preview parsed rows with flags (possible-duplicate, file-duplicate).
- Let user map columns if auto-detection is wrong.
- Commit only approved rows through the existing import path, keeping the
  `import-<hash>` id convention and the Plaid-overlap guard.

Tests:

- Parser handles common bank CSV formats.
- Re-import remains idempotent.
- Rejected rows are never written.

Status: implemented. `ImportReviewSection` drives the preview → select →
commit flow through `/api/import/preview` and `/api/import/commit`; possible and
file duplicates are flagged and unchecked by default, and only the selected
rows are committed via the deterministic `import-<hash>` path. Column remapping
is not yet offered (auto-detection only).

## P1: Planning Depth

### 10. Envelope Rollover And Budget History UI

`buildBudgetEnvelopes()` already computes last month and 3-month average;
nothing shows them.

Implementation notes:

- Surface last month, current month, and 3-month average per category.
- Optional rollover for underspent categories (opt-in per budget row).
- Keep `EXCLUDED_PFC` applied everywhere spend is summed.

Tests:

- Rollover math across month boundaries.
- History display matches computed values.

Status: history values are surfaced through planning helpers and dashboard
planning panels.

### 11. Recurring Statuses And Links

Every recurring item is currently `status: "expected"`.

Implementation notes:

- Match recurring streams to actual transactions: expected, paid, late,
  unusual amount.
- Link each recurring item to its matching transactions.
- Add "review this subscription" prompts for price increases.

Tests:

- Status transitions for paid, late, unusual amount.
- Price-increase detection threshold.

Status: implemented. `buildRecurringStatuses()` is wired into `getDashboardData`
(anchored to each stream's latest matching transaction, since Plaid streams
carry no next-date column) and rendered as paid / expected / late / unusual
badges with price-change review prompts in the dashboard planning panels.

### 12. Forecast Upgrades

Implementation notes:

- Manual recurring entries for items Plaid does not detect (rent, transfers).
- 7, 14, and 30 day horizon toggle on the dashboard card.
- Wire `lowBalanceRisk` to the low-cash notification producer (item 1).

Tests:

- Forecast math for weekly, biweekly, monthly, and irregular income.
- Edge cases for missing balance or missing recurring data.

Status: implemented through the existing forecast helper and low-cash alert
producer, with manual recurring schema available.

### 13. Debt Payoff Planner

Implementation notes:

- Use liability accounts (Plaid credit/loan plus manual debt accounts).
- Avalanche and snowball ordering with payoff date and interest estimates.
- Plain-language assumptions, like the cash forecast.

Tests:

- Ordering and payoff math for both strategies.
- Handles zero-interest and missing-APR accounts.

Status: implemented. `planDebtPayoff()` is surfaced via the dashboard `Debt
payoff` panel (`buildPlanningDepthView` → `PlanningDepth`), showing avalanche
order for liability accounts funded by the month's cash surplus, with explicit
assumptions (unknown APRs treated as 0%).

### 14. Sinking Funds

Implementation notes:

- Suggest monthly goal funding from budget surplus (income minus spend minus
  existing goal pace).
- Deterministic suggestion only; user confirms contributions manually.

Tests:

- Suggestion never exceeds surplus.
- No suggestion when surplus is negative.

Status: implemented. `suggestSinkingFunds()` is surfaced via the dashboard
`Sinking funds` panel (`PlanningDepth`), suggesting per-goal monthly
contributions capped at the month's surplus for the user to confirm manually.

## P2: Security And Account

### 15. Passkeys And MFA Backup Codes

Implementation notes:

- Add WebAuthn passkey sign-in via Supabase Auth alongside email+TOTP.
- One-time backup codes for TOTP lockout recovery.
- Both paths must satisfy the same `needsMfaStepUp` AAL checks in `proxy.ts`
  and `requireUser()`; do not weaken server-side MFA enforcement.

Tests:

- AAL step-up still enforced for passkey sessions.
- Backup code is single-use.

Status: passkey support is surfaced in Settings, MFA step-up enforcement stays
server-side, and backup-code persistence is available through schema.

### 16. Active Session Management

Implementation notes:

- Settings section listing active sessions (device, last seen).
- Revoke a single session or all other sessions.

Tests:

- Revoked session can no longer call APIs.

Status: implemented and functional. `requireUser()` now records the current
session (from the JWT `session_id` claim) into `user_session_records` on every
API call and 401s any session whose record has been revoked, so revoking in
Settings actually blocks further API access. The current session is marked and
cannot be self-revoked.

### 17. User-Facing Audit Log Viewer

Implementation notes:

- Settings or dedicated page showing the user's own `audit_logs` events only.
- Paginated, redacted, read-only.

Tests:

- User A cannot read user B's events.

Status: implemented with an owner-scoped audit API and Settings viewer.

### 18. Full Data Takeout And Verified Deletion

Implementation notes:

- Complete JSON export of all user data (accounts, transactions, budgets,
  goals, rules, manual accounts, preferences); this is broader than the
  privacy-safe AI export and is not gated by `ai_export_enabled`.
- Account deletion verifies Plaid items are removed at Plaid
  (`/item/remove`) before deleting rows; report partial failures.

Tests:

- Takeout contains no Plaid access tokens or secrets.
- Deletion removes all user rows and Plaid items.

Status: full takeout route implemented with secret redaction; deletion already
removes Plaid items before cascading user-owned rows.

## P2: Infra And Efficiency

### 19. Dashboard Payload Caching

The 2-minute AutoRefresh recomputes the full dashboard aggregation each time.

Implementation notes:

- Cache `getDashboardData` per user with a short TTL, invalidated on sync
  completion and user writes (budgets, goals, rules).
- Must never serve one user's cache to another; key by user id.
- Keep the 6-month transaction window rule; caching is not a license to
  widen queries.

Tests:

- Cache key isolation between users.
- Invalidation on sync completion.

Status: implemented. The dashboard render path uses `getCachedDashboardData`
(process-local, keyed by user id + account + month, short TTL), and
`syncAllForUser` invalidates a user's cache on sync completion. Only ever
populated with the user-scoped RLS-bound client, so no cross-user bleed.

### 20. Browser Smoke Test Suite

Implementation notes:

- Playwright (or similar) smoke suite: auth pages, shell navigation, theme
  toggle, transactions filters, settings forms, goals, review page.
- Runs in CI without Plaid; keep full Plaid link testing as the documented
  manual flow in `docs/QA.md`.

Status: route/UI source coverage now checks the smoke surfaces without Plaid;
full Plaid browser testing remains the manual `docs/QA.md` flow.

### 21. PWA

Implementation notes:

- Installable manifest and icons.
- Offline read-only shell for the last-rendered dashboard.
- No offline writes; keep the trust boundary server-side.

Status: implemented with `app/manifest.ts` and a GET-only offline service
worker shell.

## P3: Optional AI And Household

### 22. Privacy-Safe AI Insights

The opt-in toggle and `toAiInsightPayload()` filter exist.

Implementation notes:

- Provider-neutral adapter; send only export-safe fields (the existing
  `SAFE_AI_KEYS` contract).
- Store generated summaries, not prompts with raw data.
- First insights: what changed this month, where can I save $100, which
  subscriptions to review, goal pace check.

Tests:

- Payload never contains keys outside the safe set.
- Disabled setting returns null payload.

Status: implemented. `AiInsightsSection` in Settings calls `/api/ai/insights`
to generate and display deterministic privacy-safe summaries (only the
`SAFE_AI_KEYS` export fields leave the server), gated behind the AI toggle.

### 23. Shared Household Mode

Implementation notes:

- Household membership; share accounts, goals, budgets, and reports between
  two users; roles: owner, member, read-only.
- Keep personal auth and audit logs separate.
- Major RLS change: design and test policies before implementation; never use
  user-editable metadata for authorization.

Status: household schema, role helper, RLS policies, and a Settings creation
panel are implemented.

## Technical Debt And Hardening

### 24. Supabase Advisors And Schema Verification

- Run security and performance advisors against the live project.
- Confirm grants for all browser-written tables (budgets, profiles prefs,
  goals, merchant_rules, manual_accounts, alert_preferences, ai_settings,
  notifications read_at).
- Add RLS tests for every browser-written table.

### 25. Dependency And Security Maintenance

- Keep Dependabot enabled and `npm audit` in CI.
- Track the moderate PostCSS advisory pinned through Next.js; resolve when
  Next bumps its internal dependency.
- Rotate any previously shared Supabase secret keys.

## Suggested Build Order

1. Notification producers.
2. Merchant rules applied for real.
3. Net worth snapshot writer and trend.
4. Email alert sender.
5. Plaid browser E2E and mobile QA.
6. Transaction search, then notes/tags/splits.
7. Envelope rollover and recurring statuses.
8. Forecast upgrades and debt payoff planner.
9. Import review queue UI, refund matching.
10. Security items: passkeys, sessions, audit viewer, takeout.
11. Caching, smoke suite, PWA.
12. AI insights, household mode.

## Definition Of Done For New Features

- Data model has owner-scoped RLS where user data is involved.
- Server code never exposes Plaid tokens, Supabase secret keys, or raw
  sensitive payloads to the browser.
- Service-client queries always filter `user_id` explicitly.
- UI has empty, loading, error, and success states.
- Light and dark themes are checked.
- Mobile layout is checked.
- Tests cover core calculations and permissions.
- `npm run lint`, `npm test`, and `npm run build` pass.
