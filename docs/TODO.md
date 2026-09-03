# FundFlow — Future Todos

Nice-to-have features and enhancements, deferred out of the initial build.

## Added 2026-09-02: backup restore redesign

The restore endpoint is disabled behind `FEATURE_FLAG_DEFAULTS.backupRestore: false` because restoring provider-synced tables (such as `accounts`) causes cascade deletions across the ledger and fails on missing `plaid_items` foreign keys.
Future restore redesign requirements:
- Treat provider-synced tables as non-restorable (a third scope beside shared/owner).
- Restore only user-authored configuration (budgets, goals, rules, manual accounts, tags, user annotations), rather than reconstructing accounts.
- If any multi-table restore is executed, run it within an atomic Postgres transaction (RPC) to guarantee all-or-nothing rollback on partial failures.

## Added 2026-08-30: PR #130 remaining verification

The hybrid recurring detection code, migrations, and tests are complete, and all three migrations are already applied to the linked project.
Two items remain before the browser regression can be called proven:

1. Run `npx playwright test tests/e2e/recurring.spec.ts --grep "infers a monthly stream when Plaid omits it" --project=chromium` in an environment with `PLAID_ENV=sandbox` and a matching sandbox `PLAID_SECRET`. The test self-skips everywhere else so it never spends production Plaid calls.
2. Run the two pgTAP suites (`supabase/tests/reconcile_inferred_recurring.test.sql`, `supabase/tests/reconcile_plaid_recurring.test.sql`) once Docker is available. Both reconciliation functions shipped with compile errors that only surfaced when applied to a real Postgres, so this suite is the regression net for the next change to them.

`tests/integration/api-routes.test.ts` "proceeds successfully even if one user's sync throws an error" timed out once at its 30s limit during a full-suite run against live Supabase, then passed on the two following full runs and in isolation.
Watch it: if it recurs, the fix is contention-aware timeouts for the live integration files, not a blanket timeout bump.

## Added 2026-08-29: PR #137 deployment actions

PR #137's Phase 0 through Phase 6 code and focused acceptance tests are complete.
Production rollout still requires the following owner-authorized actions:

1. Deploy `20260829170000_credit_card_bill_insert_ownership.sql`.
2. Deploy `20260829171000_life_event_retirement_amount.sql` before creating zero-amount retirement life events.
3. Deploy `20260829172000_goal_import_identity_unique.sql`.
4. Deploy `20260829173000_account_reconciliation_aggregate.sql` before opening the new Settings reconciliation surface.
5. Run `supabase db push --dry-run --linked` with `SUPABASE_DB_PASSWORD` available before applying the migrations.
6. Re-run the linked credit-card ownership, retirement life-event, goal identity, and reconciliation RPC checks after deployment.
7. Confirm the exact Production deployment commit and repeat the authenticated comparison read-only.

Plaid Liabilities bill sync remains off by default because it adds a billed provider request per user and run.
After Plaid product and quota approval, add `liabilitiesSync` to `FUNDFLOW_FEATURE_FLAGS` and monitor provider usage.
The existing APR enrichment path still requires its separate `PLAID_LIABILITIES_ENABLED=1` gate.

The PR removes current-tree personal media and sanitizes live financial fixtures.
A coordinated history rewrite is still required if the deleted historical blobs must be physically removed from every Git object and clone.

## Resolved 2026-09-02: two AI-surface findings — shipped

Resolved in `feat/ai-consent-dx-improvements`:

### 1. The default model id is now a valid Claude model
Updated `lib/ai-provider.ts`, `app/api/ai/ask/route.ts`, and `app/api/ai/receipt/route.ts` default fallback from the non-existent `claude-opus-4-8` to `claude-3-7-sonnet-latest` (supporting adaptive thinking).

### 2. Receipt scanning enforces double consent
`app/api/ai/receipt/route.ts` now enforces both `ai_settings.enabled === true` AND `profiles.ai_export_enabled !== false`, aligning with its documented security contract and user data export preferences.

## Added 2026-08-21: migration import (Mint, Monarch, YNAB) — shipped

Done on 2026-08-21 (`feat/production-readiness-2026-08`, plan
`docs/superpowers/plans/2026-08-21-migration-import.md`): Mint, Monarch, and
YNAB CSVs normalize into the existing `ImportedRow` pipeline via
`lib/import-mint.ts` / `lib/import-monarch.ts` / `lib/import-ynab.ts` and the
new `lib/import.ts::detectSourceFormat` dispatcher. `import_review_rows`
gained a nullable `category` column (migration
`20260821155029_import_review_row_category.sql`) so the commit route threads
the parsed category into `pfc_primary`. Remaining: a manual dev-server pass
(preview + commit each format with no mapping UI, re-import idempotency) and,
if a safe (non-user-data) Supabase project is ever available, an RLS/integration
test proving user B cannot read user A's staged review rows and that
re-importing the same file of each format does not duplicate.

## Added 2026-08-10: put production on a custom domain

`fund-flow-swart.vercel.app` is shared free-hosting, and the app's shape (a credential-collecting login form, Google OAuth, and bank linking) matches a phishing heuristic closely enough that filtering software flags it.
NordVPN Threat Protection served a malware block page for the domain during the 2026-08-10 session, and an ad blocker independently blocked the stylesheet, which rendered the app completely unstyled.
Neither was an app defect, but both will keep recurring and will reach real users on any security suite.
A custom domain is the durable fix; `NEXT_PUBLIC_APP_URL` and `.env.example`'s `your-domain` placeholder both need updating when it lands.

## Added 2026-08-20: owner decisions for production readiness (Phase 3)

These are the items a human must act on; each has exact steps so no research is
required. None of them can be done by an agent (they need a purchased domain,
a live test user + repo secrets, a Plaid dashboard toggle, or Vercel env vars).

### 1. Custom domain

1. Buy/own a domain (e.g. from a registrar of your choice) that you can point
   DNS at Vercel.
2. In the Vercel project (`fund-flow-swart`), go to **Settings → Domains** and
   add the domain. Vercel shows the exact DNS records (an `A` record and/or
   `CNAME` + the `_vercel` TXT) to create at your registrar.
3. Wait for Vercel to issue the SSL certificate and mark the domain ready.
4. Update `NEXT_PUBLIC_APP_URL` in the Vercel project env vars to
   `https://<your-domain>` and redeploy.
5. Update the placeholder in `.env.example` (`NEXT_PUBLIC_APP_URL=http://localhost:3000`)
   with a comment noting the production value is `https://<your-domain>`.
6. This is the durable fix for the phishing/malware-filter false positives
   documented above (2026-08-10) and in `docs/HANDOFF.md`.

### 2. E2E CI secrets (authenticated golden path)

The Playwright golden path (`tests/e2e/golden-path.spec.ts`) skips cleanly
without these, but to actually run in CI you need three GitHub repo secrets and
a disposable test user. The test user must be a **real account against the live
Supabase project** (this repo's Supabase signup rejects `@example.com`), so
create it first (e.g. via the Supabase Auth UI or the signup page), then:

```bash
gh secret set E2E_EMAIL --repo <owner>/<repo>     # paste the test user's email
gh secret set E2E_PASSWORD --repo <owner>/<repo>  # paste the test user's password
gh secret set E2E_PLAID --repo <owner>/<repo>     # paste "1" to enable the sandbox connect step
```

- `E2E_EMAIL` / `E2E_PASSWORD`: a disposable, dedicated test user on the live
  project (not a real personal account; the golden path creates/uses throwaway
  finance data).
- `E2E_PLAID=1`: only needed if you want the sandbox bank-connect step to run;
  leave unset to skip it.

### 3. Plaid Liabilities (real card APRs)

The app currently assumes a flat 22% APR (`lib/liabilities.ts` is behind
`PLAID_LIABILITIES_ENABLED=1`, which is unset). To get real card APRs:

1. In the Plaid dashboard, enable the **Liabilities** product on the app (this
   is an account-level action an agent cannot do).
2. Once enabled, set `PLAID_LIABILITIES_ENABLED=1` in the Vercel project env
   vars (and optionally `.env.local` for local testing) and redeploy.

### 4. VAPID keys (web push)

Web push is fully coded (`lib/push.ts`, `components/notifications/PushSection.tsx`)
but silently no-ops without VAPID keys. The pair generated during the
2026-08-20 pass was exposed in the PR description and must not be used.
Generate a fresh pair directly in the deployment environment, then set these env vars
(Vercel project env vars, and `.env.local` for local testing):

- `VAPID_PUBLIC_KEY` (server)
- `VAPID_PRIVATE_KEY` (server, keep secret — never commit)
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (same value as `VAPID_PUBLIC_KEY`, client-side)
- Optional `VAPID_SUBJECT` (defaults to `mailto:admin@fundflow.local`)

The exposed values were removed from the production-readiness PR description.
After setting a newly generated pair, redeploy and the Push section in Settings becomes functional.

### Applied migrations

- `supabase/migrations/20260814100000_performance_composite_indexes.sql` was
  corrected to index `transactions.pfc_primary` and applied to the linked live
  project on 2026-08-20. Direct catalog verification confirms all six indexes exist.
- `supabase/migrations/20260820000000_revoke_rls_auto_enable_grants.sql`
  revokes `PUBLIC`/`anon`/`authenticated` execute on the platform-managed
  `public.rls_auto_enable()`. It was applied on 2026-08-20; direct privilege
  checks and `scripts/check-rls.sql` pass, and the advisor finding is cleared.
  It remains a no-op where the function does not exist (self-hosted / fresh dev).

## Active program: financial-planner parity (started 2026-07-29)

Plan: `docs/superpowers/archive/plans/2026-07-29-monarch-parity.md`.
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
  The migration also added a `receipts` table and the app's first Supabase
  Storage bucket.
  The persistent receipt workflow was completed in PR #99 on 2026-08-09.
  The existing ephemeral AI receipt scan in Settings remains available separately.
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
`docs/archive/CHANGES-roadmap-2026-07-23.md`.
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


## Completed work

Finished todos and completed programs are in
[`archive/TODO-completed.md`](archive/TODO-completed.md).
