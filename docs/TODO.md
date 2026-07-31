# FundFlow — Future Todos

Nice-to-have features and enhancements, deferred out of the initial build.

## Active program: financial-planner parity (started 2026-07-29)

Plan: `docs/superpowers/plans/2026-07-29-monarch-parity.md`.
Fourteen phases bringing FundFlow to parity with the reference planner screenshots: Accounts, Cash Flow, Budget, Recurring, Reports, Goals, Investments, Forecasting, Advice, Settings IA, and a customizable dashboard.

- **Phase 0 — canonical finance semantics.** Done (2026-07-29), branch `feat/finance-domain-foundation`.
  `lib/finance-domain.ts`, `lib/financial-scope.ts`, `lib/finance-query.ts`, `lib/feature-flags.ts`; dashboard refactored onto the projection with a parity test.
- **Phase 2: Accounts.** Done (2026-07-29), branch `feat/accounts-page`, PR #70.
  Live daily account snapshots, currency-safe summaries, history, preferences, manual accounts, export, and owner and household RLS are complete.
- **Phase 3: Cash Flow.** Done (2026-07-29), branch `feat/cash-flow-page`.
  Canonical Income, Expenses, Savings, period trends, complete breakdowns, Mine and Household scope, and currency separation are complete.
- **Phase 4: Budget.** Done (2026-07-30), branch `feat/monarch-parity-all-phases`, PR #72.
  Period budgets, Month/Year/Decade views, rollover, sinking funds, and a reviewed budget-seeding proposal are complete.
- **Phase 1: Navigation and IA.** Done (2026-07-30), branch `feat/planner-ia`, PR #74.
  Centralized `NAV_ITEMS`, top-bar search/notifications/settings, persisted sidebar collapse, gated Ask-AI link, and feature-flag-gated nav entries are complete.
- **Phase 5: Recurring.** Done (2026-07-30), branch `feat/recurring-page`.
  Occurrence review workflow anchored on Plaid's predicted_next_date/transaction_ids, manual recurring items, sidebar badge, Mine and Household scope are complete.
- **Phase 6: Reports.** Done (2026-07-30), branch `feat/reports-sankey`.
  Cash-flow Sankey (pure `lib/sankey.ts` layout + server-rendered
  `SankeyChart` with a full-detail table twin), a date-range/tab/scope report
  explorer, versioned saved reports, and a filtered privacy-safe CSV export are
  complete. **Released behind `reportsPage`, which defaults to OFF**: the page
  reads the new `saved_reports` table, so flip the default (or set
  `FUNDFLOW_FEATURE_FLAGS=reportsPage`) only after applying
  `20260730190000_saved_reports.sql` to the live project. Retire the
  "Year in Money" sidebar entry in that same change — the Reports page already
  links to `/wrapped`, and dropping it sooner would strand that page.
- **Phase 7: Goals.** Done (2026-07-30), branch `feat/goals-v2`.
  Funded goals with three progress sources (manual, account allocations, a dated
  event ledger), a transactional allocation function that holds a row lock,
  pay-down goals with a captured baseline, the four-step wizard on eight
  original SVG illustrations, goal linking in the ledger editor, and planned vs
  actual contributions feeding the Budget page. **Released behind `goalsV2`,
  which defaults to OFF** — unlike `reportsPage` this gates *already-released*
  pages: `/goals` and `/budget` both start reading `goal_accounts` and
  `goal_progress_events` when it turns on, so apply
  `20260730200000_goals_v2.sql` first.
- **Phase 8: Dashboard widgets.** Done (2026-07-30), branch `feat/dashboard-widgets`.
  A customizable seven-widget grid over the existing data, a cumulative
  spending-vs-last-month chart, per-widget empty/stale/error states, and
  reconciliation tests tying the dashboard, Budget, Cash Flow, and Reports to
  one canonical monthly total. **Released behind `dashboardWidgets`, default
  OFF — but no migration is involved**, so this one can be flipped as soon as
  the grid has been reviewed. Monitor, Plan, and Wealth are untouched.
- **Phase 9A: Investments.** Done (2026-07-30), branch `feat/investments`.
  Plaid-synced and manual investment holdings, grouped allocation by asset
  class, price-based top movers, a day-over-day change indicator, and full
  mark-and-sweep sync isolation from transaction sync. **Released behind
  `investmentsPage`, default OFF** — the page, the daily cron, and the
  HOLDINGS webhook all read/write `securities`/`holdings`/`holding_snapshots`,
  so apply `20260730210000_investments.sql` first. That migration also adds
  `sync_jobs.job_type` so an investments-only sync success can never be
  misread as "the bank sync is up to date" by the four surfaces that read
  `sync_jobs` for a stale-data banner.
- **Phase 9B: Investment performance.** Done (2026-07-30), branch
  `feat/investment-performance`.
  Investment-transaction sync (idempotent, cancellations deactivate rather
  than delete), a time-weighted-return calculator that removes deposits and
  withdrawals so a balance chart can't be mistaken for market performance,
  and a CSV export of the current allocation. The benchmark adapter exists as
  an interface and cache only — deliberately not wired into any page until a
  licensed market-data source is provisioned. **Released behind the same
  `investmentsPage` flag** — apply `20260730220000_investment_transactions.sql`
  in addition to Phase 9A's migration.
- **Phase 10: Forecasting.** Done (2026-07-30), branch `feat/forecasting`.
  Three deterministic net-worth scenarios (conservative/base/optimistic,
  spread by +/-2 points around the entered return so ordering holds even for
  a negative assumption) pre-filled from real account balances, with every
  assumption a plain GET query param so the page needs no client JS.
  Extracted the dashboard's What-if sandbox math into `lib/forecasting.ts`
  with the panel's behavior unchanged. **Released behind `forecastingPage`,
  default OFF** — a review gate only, no migration required.
- **Phase 11: Advice.** Done (2026-07-30), branch `feat/advice`.
  A versioned library of twelve original education items (two per category),
  sourced only from neutral federal-agency domains, with a content-review
  guard that already caught and fixed two items whose own risk disclaimers
  tripped the prohibited-guarantee-language check. Priority ordering,
  eligibility, and a profile questionnaire that's never used for advice
  eligibility without a separate, visible explanation. **Released behind
  `advicePage`, default OFF** — apply `20260730230000_advice.sql` first.
- **Phase 12: Transactions parity.** Done (2026-07-30), branch
  `feat/transactions-parity`.
  Manual ledger entries for anything Plaid doesn't cover, day-group headers
  with signed daily totals, and a Columns menu. `transactions.account_id` is
  now nullable with `manual_account_id` as the alternative — absorbed with no
  downstream breakage because Phase 0 designed the canonical projection for
  this from the start. Found and fixed a real latent bug along the way: the
  daily cron's integrity check would have flagged every manual transaction as
  "orphaned." **Released behind `transactionsParity`, default OFF** — unlike
  the other Phase 9-11 flags this gates an *already-live* page: with it off,
  `/transactions` runs the exact pre-Phase-12 query. Apply
  `20260730240000_manual_transactions_receipts.sql` first.
  The migration also adds a `receipts` table and the app's first Supabase
  Storage bucket (schema and RLS only) — the persistent receipt-upload UI and
  route are intentionally deferred as a separate follow-up, distinct from the
  completed manual-transactions work above. The existing ephemeral AI receipt
  scan in Settings is unaffected either way.
- **Phase 13: Settings IA.** Done (2026-07-30), branch `feat/settings-ia`.
  A section-based Settings page (a `section` query param + real side nav)
  replacing the old all-data-at-once layout, so each section queries only
  what it needs. Every existing settings component was reused unchanged, just
  remapped to a section. New: Profile (with the app's first avatar upload,
  through a second private Storage bucket), Display preferences, and a real
  tag registry (`rename_user_tag` merges/renames in one SQL statement so a
  rename can't race a concurrent annotation edit). **Released behind
  `settingsIa`, default OFF** — gates only the three sections that read new
  schema (Profile/Display/Tags redirect to Institutions when off); every
  other section stays reachable unmigrated. Apply
  `20260730250000_profile_and_tags.sql` first.

All fourteen phases of the program are now implemented. Remaining before any
of Phases 9A-13 ship to real users: apply their five migrations (in the order
listed above) to the live Supabase project, then flip each flag
independently, in any order, after review.

Excluded from the program by decision, revisit only if asked: credit score (no consented bureau integration), billing/free-trial/referrals (not a commercial product), Retail Sync (no authorized data source), and investment benchmark overlays (needs a licensed market-data feed, deferred inside Phase 9B).

## Must-have before real-bank production use

Gaps found in the 2026-07-05 review, ranked. These are not polish — each one
is a hole a real deployment would fall into.

1. ~~**Server-side MFA (AAL2) enforcement.**~~ **Done (2026-07-05):**
   `lib/mfa.ts` (`needsMfaStepUp`) is checked in `proxy.ts` (aal1-pending
   users are redirected to `/login`, which resumes at the TOTP prompt) and in
   `requireUser()` (401 `MFA verification required` from every API).
2. ~~**Bank reconnection (Plaid Link update mode).**~~ **Done (2026-07-05):**
   the webhook handles `ITEM` codes (`ERROR`, `PENDING_EXPIRATION`,
   `LOGIN_REPAIRED`, `USER_PERMISSION_REVOKED`); sync failures store the real
   Plaid error code; `/api/plaid/link-token` accepts `item_id` for update
   mode; `ReconnectBankButton` in Settings + `/api/plaid/reconnect` finalize.
3. ~~**Weekly-report email opt-out.**~~ **Done (2026-07-05):**
   `profiles.weekly_report_enabled` (migration `0003_hardening.sql`), toggle
   in Settings (`ReportsSection`), checked by the weekly cron.
4. ~~**Cron/sync failure observability.**~~ **Done (2026-07-05):** every item
   sync writes a `sync_jobs` row (running → done/failed with the Plaid error
   code); the dashboard shows a stale-data banner when a bank is broken or no
   sync succeeded in 48h; the daily cron prunes jobs older than 30 days.
   ~~*Still optional:* an alert email when a whole cron run fails.~~ **Done
   (2026-07-16):** `lib/cron-alert.ts` (`alertCronFailure`) emails the admin
   profile on cron failure, deduped to one alert per cron name per 24h via
   the rate limiter; wired into `/api/cron/sync` and
   `/api/cron/weekly-report`.
5. ~~**Origin check on mutating API routes.**~~ **Done (2026-07-05):**
   `lib/origin.ts` + `proxy.ts` reject cross-origin mutating `/api` requests
   (403); requests without an Origin header (webhooks, cron, curl) pass.
6. ~~**Encryption-key rotation support.**~~ **Done (2026-07-05):**
   `PLAID_TOKEN_ENC_KEY_PREVIOUS` gives a two-key decrypt window
   (`decryptSecretDetailed`), and the daily sync re-encrypts fallback-decrypted
   tokens with the current key (`decryptItemTokenAndUpgrade`).
7. ~~**Server-side MFA audit verification**~~ **Done (PR #11,
   `hardening/mfa-server-finalization`):** `/api/settings/mfa` now verifies
   the factor via `listFactors()` on enroll, performs unenroll server-side,
   and owns the `mfa_enrolled` profile flag.

Minor (same bucket): ~~prune `rate_limit_counters` periodically~~ (done — the
daily cron deletes windows older than a day), and finish the browser E2E run
from `docs/HANDOFF.md` (still pending Plaid Sandbox keys). **Remember to apply
`0003_hardening.sql` to the live Supabase project** — the weekly-report cron
and Settings read `profiles.weekly_report_enabled`.

## Added 2026-07-23 (four-session roadmap drop)

Shipped in one merge; the per-feature record is
`docs/CHANGES-roadmap-2026-07-23.md`.
This closed out most of the list below, plus phases 2-8 of the roadmap.

- ~~**Optional in-app AI insights**~~ Done: `lib/ai-provider.ts` (official
  `@anthropic-ai/sdk`) behind the existing double consent, capped at 4
  generations/user/day, falling back to the rule-based summaries whenever the
  key is absent or the provider errors.
- ~~**Self-hosted docker-compose**~~ Done: `docker-compose.selfhost.yml`, with
  the new `/api/health` endpoint wired into the container healthcheck.
- ~~**Browser E2E run**~~ Scaffolded: `playwright.config.ts`,
  `tests/e2e/smoke.spec.ts` (6 no-auth specs) and
  `tests/e2e/golden-path.spec.ts` (7 authenticated specs), plus
  `.github/workflows/e2e.yml`. The golden path skips cleanly without
  `E2E_EMAIL`/`E2E_PASSWORD`.

Still open, all needing credentials or an owner decision rather than code:

- Add `E2E_EMAIL` / `E2E_PASSWORD` repo secrets so the authenticated golden
  path actually runs in CI (and `E2E_PLAID=1` for the sandbox connect step).
- Enable the Plaid Liabilities product and set `PLAID_LIABILITIES_ENABLED=1`
  to get real card APRs instead of the 22% assumption.
- Generate VAPID keys to activate web push (it is a silent no-op without
  them).
- By design, not a gap: household-shared rows are read-only for members
  everywhere. No member ever writes to a partner's data.

## Requested enhancements

- ~~**Card designs by network/product**~~ Done — card-deck carousel
  (`lib/card-design.ts`), card selection filters the dashboard.
- ~~**Mobile support**~~ **Done (2026-07-16):** stacked card ledger below the
  `sm` breakpoint (`components/transactions/MobileLedgerList.tsx`), 44px
  minimum touch targets on nav links and month chips, a scroll-strip edge-fade
  affordance, and a site-wide mobile overflow fix (removed a negative-margin
  bleed on the mobile nav strip that broke every signed-in page at phone
  widths); screenshot-verified at 375px and 414px.
- ~~**Monthly history views**~~ Done — month browser on the dashboard plus the
  `/transactions` ledger with month/account/search filters.
- ~~**Current spend indicator**~~ Done — pacing widget (vs budget and vs
  pro-rated last month) + stat tiles with deltas and sparklines.
- ~~**Spend per card / per bank**~~ Done — Cards & Banks tab.
- ~~**Checking-account cash-flow insights**~~ Done — Cash Flow tab with a
  6-month diverging deposits/withdrawals chart.

## Added 2026-07-11 (drill-down & ledger filters)

- **Category & Merchant drilldown:** Interactive SVG category donut and merchant lists drill down in-place into subcategories, top merchants, and 6-month trends.
- **Interactive month/column links:** Charts preserve drill down states when pivoting months.
- **Exact ledger filters:** Ledger page supports filtering by `category`, `sub`, `merchant`, `flow`, and `accountType` with tag badges to clear filters.

## Added 2026-07-05 (charts / ledger / exports session)

- Server-rendered SVG chart kit (`components/charts/`): trend lines, category
  donut, diverging columns, sparklines, stat tiles — palette validated for
  CVD + contrast in light and dark (see `app/globals.css` viz tokens).
- `/transactions` ledger: search, month, account filters, pagination.
- In-app exports: CSV + JSON (privacy-safe contract in `lib/export.ts`) and
  the weekly PDF on demand (`/api/export/report`).

## Previously planned (from the build spec)

- ~~**Email the CSV/report** on a schedule so reports arrive in inbox.~~ Done:
  weekly PDF report cron (`/api/cron/weekly-report` + `lib/reporting.ts`).
- ~~**Plaid webhooks** with signature verification for real-time sync.~~ Done:
  `/api/plaid/webhook` verifies ES256 signatures outside sandbox.
- ~~**Optional in-app AI insights** endpoint (provider-agnostic) reusing the
  export data contract, gated by the per-user AI setting.~~ Done (2026-07-23):
  `lib/ai-provider.ts`.
- ~~**CSV import for pre-Plaid history**~~ Done (2026-07-05):
  `lib/import.ts` + `/api/import/csv` + Settings Import section. Dedupe: rows
  on/after the account's earliest Plaid-synced date are skipped; deterministic
  `import-<hash>` ids make re-imports idempotent.
- ~~**Self-hosted docker-compose** if moving off managed Supabase.~~ Done
  (2026-07-23): `docker-compose.selfhost.yml`.
- **Audit MFA enrollment** server-side — promoted to the must-have list above
  (item 7).
