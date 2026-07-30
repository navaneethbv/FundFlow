# FundFlow — Session Handoff

Last updated: 2026-07-30. Read this first to resume.

## START HERE: Phase 1 Navigation and Information Architecture is implemented

Phase 1 is implemented on `feat/planner-ia`. The pull request follows Tasks 1-6 of the Monarch Parity test-first plan and delivers a nav-model-driven architecture for the app shell, gating future pages as they ship.

The navigation system now provides:

- A centralized `NAV_ITEMS` definition that drives the sidebar, command palette, and app shell active-view tracking.
- Responsive top-bar utility actions: search, notifications, and settings (hidden below the `sm` breakpoint at 640px per Tailwind, visible at `sm` and above; reachable on mobile via the existing pill nav).
- Sidebar collapse state persisted through `profiles.dashboard_prefs` with a toggle button and aria-pressed state.
- Gated Ask-AI lower-rail link that only renders when `isAskAiAvailable` returns true.
- Feature-flag-driven navigation entries so unreleased pages remain hidden from both sidebar and command palette.
- Dashboard subviews (monitor, plan, wealth) remain internal to the `/dashboard` route and are not exposed as top-level nav entries.

The implementation honors the existing `TRANSFER_GROUPS` exclusion set and the five Phase 0 finance-domain invariants carried forward from prior work.

The "move Year in Money under Reports" step from the master plan is intentionally deferred to Phase 6 because the Reports page does not yet exist. Phase 6's implementation plan must explicitly include a link-and-remove step to move `wrapped` from the `manage` category into the `reports` category once that page ships.

The sm-breakpoint utility icon scope decision (Task 4) is defined in the responsive Tailwind classes and covered by source-level unit tests.

Current gates, all green: `npm run lint` PASS, `npm run typecheck` PASS, `npm run test:unit` PASS (137 files, 983 tests including the two new regression tests), `npm run build` PASS.

Unit-level coverage only so far (readFileSync/mock-based source tests per this codebase's convention). Credentialed browser and E2E acceptance across viewports and themes is Task 8's job, not yet run.

Next, Phase 2 (Accounts, PR #70), Phase 3 (Cash Flow, PR #71), and Phase 4 (Budget, PR #72) have already shipped on `main`. Phase 5 onwards remains future work.

## START HERE: Phase 4 Budget is implemented

Phase 4 is implemented on `feat/monarch-parity-all-phases` in PR #72.
The pull request is intentionally limited to the Phase 4 Budget vertical slice.
The Phase 5 through Phase 13 placeholder implementation was reverted without rewriting shared history.
Start Phase 5 only after PR #72 merges, from a fresh branch based on `main`.

The released `/budget` server page now provides:

- Month, Year, and Decade views built from canonical transaction actuals and real period calculations.
- Income, Fixed, Flexible, Non-Monthly, and honest empty Contributions sections.
- Planned, actual, remaining, Left to Budget, rollover carry, and computed sinking-fund totals.
- Inline planned amount, group, rollover, and sort-order edits with complete optimistic rollback.
- A reviewed proposal dialog based on three complete months of canonical history, recurring sources, and existing sinking funds.
- Mine and Household scope through `parseFinancialScope`.
- Currency-separated totals that never invent exchange rates.
- Bounded canonical reads through `loadCanonicalProjection` and `fetchFinanceTransactions`.
- Loading, empty-section, stale-data, bounded-data, and route-level error states.
- A simple Settings link to the full planner rather than a duplicate planning surface.

Budget and Cash Flow reconcile for the same month, scope, and currency.
The Budget loader consumes real transaction splits, merchant rules, category overrides, linked refunds, transfer classification, account names, and stable canonical sorting.
The canonical split adapter now reads the real `transaction_splits` schema and hydrates all projection dependencies with bounded reads.

The live Supabase project `zrxbmmtqqhlwtrinocww` contains these Phase 4 migrations:

- `20260730013820` named `budget_groups`.
- `20260730013939` named `budget_household_index`.
- `20260730014055` named `budget_mutation_conflict_fix`.
- `20260730015035` named `budget_select_policy`.

The first migration creates `budget_periods`, its indexes, four owner-safe and household-readable RLS policies, and the authenticated `SECURITY INVOKER` atomic mutation function.
The roll-forward migrations add the household foreign-key index, correct the named conflict target in the applied function, and combine Budget owner and household reads into one authenticated policy.
Reader code and the `budgetPage` feature flag were released only after all four migrations were live.

Live verification reports:

- Zero `budget_periods` rows linked across owners.
- RLS enabled on `budget_periods`.
- Four intended `budget_periods` policies.
- One authenticated `budgets_select_visible` policy.
- Anonymous callers cannot execute `update_budget_period`.
- Authenticated callers can execute `update_budget_period`.
- The live owner, household-member, outsider, atomic-mutation, and cascade suite passes at 6 tests.

Supabase Advisors report no new Phase 4 security finding.
The Budget missing-index and duplicate-policy performance findings were corrected.
The new `budgets_household_id_idx` is reported as unused because it has not accumulated production query usage yet.
Older project-wide advisor findings remain outside this vertical slice.

Credentialed browser acceptance is green for:

- Proposal preview, editing, exclusion, confirmation, and persistence.
- Planned amount edits, group moves, rollover changes, successful saves, and forced 500 rollback.
- Month, Year, and Decade navigation.
- Budget and Cash Flow actual-expense reconciliation.
- Mine and Household isolation.
- USD and CAD separation.
- Desktop 1440 by 900, tablet 768 by 1024, and mobile 390 by 844.
- Light and dark themes at every viewport.
- Horizontal overflow containment, 44px controls, browser exceptions, console errors, request failures, and server failures.

The final local gate is:

- `npm run lint`: pass with zero warnings.
- `npm run typecheck`: pass.
- `npm test`: pass at 149 files and 1,043 tests.
- `npm run test:coverage`: pass with 91.52 percent statements, 79.19 percent branches, 93.17 percent functions, and 94.66 percent lines.
- `npm run build`: pass with `/budget` and `/api/budget` in the production route manifest.
- Credentialed `npm run test:e2e -- tests/e2e/budget.spec.ts`: pass.
- `git diff --check`: pass.
- `npm audit --audit-level=high`: still reports the existing `brace-expansion` advisory through the dev-only ESLint chain.
  The installed patched backports are `brace-expansion` 1.1.17 and 5.0.8.
  Do not force an incidental ESLint 10 major upgrade inside Phase 4.

Next, expand only Phase 5 from `docs/superpowers/plans/2026-07-29-monarch-parity.md` into its own test-first plan.
Phase 5 is the Recurring page and its reviewed occurrence ledger.

## START HERE: Phase 3 Cash Flow is implemented

Phase 3 is implemented on `feat/cash-flow-page`, stacked on `feat/accounts-page` until PR #70 merges.
Retarget the Cash Flow pull request to `main` after PR #70 merges.

The released `/cash-flow` server page now provides:

- Monthly, quarterly, and yearly Income, Expenses, Savings, and Savings Rate using the canonical Phase 0 projection.
- URL-driven range, selected-period, category, group, merchant, Mine, Household, and currency controls.
- A bounded 24-month and 25,000-row transaction read through `fetchFinanceTransactions`.
- Real split forwarding to `projectFinanceTransactions`, plus merchant rules, category overrides, linked-refund netting, account names, and transfer exclusion.
- Currency-separated summaries, period bars, per-period net savings, complete breakdown tables, and an honest unknown-currency state.
- Loading, empty, partial-data, stale-data, permission-safe, and error states.
- Accessible chart table twins, 44px controls, and responsive light and dark layouts.

Analytical Cash Flow uses canonical `flow` values so Income and Expenses reconcile with Budget and Reports.
The existing dashboard cash-movement chart remains a literal depository deposit and withdrawal view and was not changed.
The page makes no Plaid calls.
Its sidebar entry remains deferred with Phase 1.

Browser testing and the final code review exposed two existing household projection RLS defects.
Household members could read a shared account, but the transaction policy directly joined token-protected `plaid_items` rows that members intentionally cannot select.
The migration `20260729203107_shared_transaction_authorization.sql` replaces the two permissive transaction read policies with one authenticated policy that uses `private.can_read_shared_account(account_id)`.
It was committed before reader code and applied to live Supabase project `zrxbmmtqqhlwtrinocww` as migration version `20260729203351`.
Live policy inspection shows one `transactions_select_visible` policy for `authenticated`.
Transaction splits and linked refund pairs were also owner-only even when their source transactions were shared.
The migration `20260729204345_shared_projection_metadata_authorization.sql` makes read visibility follow the source transactions, preserves owner-only writes, and adds transaction-key indexes.
It was also committed before reader code and applied live as migration version `20260729204429`.
The live RLS regression suite passes at 6 tests, and the credentialed Cash Flow browser journey now includes a partner-owned split transaction and refund pair.

Supabase Advisors show no new transaction-policy finding after the migration.
They still report older project-wide security and performance findings that predate Phase 3 and were not expanded into this vertical slice.
Local `supabase db lint --local` remains unavailable because local Postgres is not running.

Visual acceptance is green at 1440 by 900, 768 by 1024, and 390 by 844 in light and dark themes.
The checks cover canonical totals, owner and partner splits, owner and partner refund netting, merchant renames, category overrides, Mine and Household scope, USD and CAD separation, URL state, touch targets, horizontal overflow, same-origin failures, server errors, browser exceptions, and console errors.
The visual pass also found and fixed the preexisting mobile header defect where `Sign out` wrapped to two lines.

The current full code gate is:

- `npm run lint`: pass with zero warnings.
- `npm run typecheck`: pass.
- `npm test`: pass at 141 files and 978 tests.
- `npm run build`: pass with `/cash-flow` in the production route manifest.
- Credentialed `npm run test:e2e -- tests/e2e/cash-flow.spec.ts`: pass.
- The same Playwright file with `SUPABASE_SECRET_KEY` absent: clean skip.
- `git diff --check`: pass.
- `npm audit --audit-level=high`: reports the existing `brace-expansion` advisory through the dev-only ESLint chain.
  Do not use the suggested forced ESLint 10 major upgrade as an incidental Phase 3 change.

Phase 1 remains deferred until more production pages exist.
Next, expand and build Phase 4 (Budget) test-first from `docs/superpowers/plans/2026-07-29-monarch-parity.md`.
Continue carrying the Phase 0 canonical projection, real splits, bounded query, parsed scope, and feature-flag invariants into that page.

## Phase 2 Accounts is implemented

Phase 2 is implemented on `feat/accounts-page`.
The migration-first ordering constraint was honored before reader code was made eligible to merge.

The live FundFlow project `zrxbmmtqqhlwtrinocww` now has these Phase 2 migrations:

- `20260729182910_account_snapshots.sql`, recorded live as version `20260729183147`.
- `20260729183248_shared_account_rls.sql`, recorded live as version `20260729183347`.
- `20260729193500_private_shared_account_authorization.sql`, recorded live as version `20260729193421`.

Daily balance history starts on `2026-07-29`.
Earlier history is unavailable and must not be inferred or backfilled.
The one-time current-state backfill created 16 snapshots for 16 eligible source accounts.
There are zero missing current-day sources, duplicate source-day rows, or invalid source rows.
Ongoing daily capture begins when this branch is merged and deployed because the cron and refresh writers live in the application code.

The Accounts experience now includes:

- A released `/accounts` server page with mine and household scope, institution, account-type, visibility, owner, and history-range filters.
- Currency-safe asset, liability, and net-worth summaries that never combine currencies without exchange rates.
- Honest one-day and insufficient-history states, per-account freshness, 30-day change, sparklines, and a data-table twin.
- Grouped Plaid and manual accounts, account ordering and visibility preferences, and an exact privacy-safe CSV export.
- Authenticated manual-account create, balance-update, and delete routes with audit records and immediate snapshots.
- Daily snapshot capture after explicit Plaid refreshes, successful scheduled syncs, manual-account mutations, and demo-data creation.
- Snapshot retention in encrypted backups and user takeout exports, plus cascade-deletion coverage.

Live access verification is green.
Authenticated clients have `SELECT` only, service clients have full CRUD, owner and household-member reads pass, cross-user reads stay isolated, and cookie-client writes are denied.
The shared-account authorization helper now lives in the non-exposed `private` schema.
Supabase Advisors report no Phase 2 findings after the final hardening migration.

Browser acceptance is green at 1440 by 900, 768 by 1024, and 390 by 844 in light and dark themes.
The checks cover filters, scope, preferences, CSV export, touch targets, horizontal overflow, same-origin request failures, server errors, browser exceptions, and application console errors.
The manual in-app browser pass also verified the Percent interaction and an empty warning/error console.

The current full code gate is:

- `npm run lint`: pass with zero warnings.
- `npm run typecheck`: pass.
- `npm test`: pass at 137 files and 946 tests.
- `npm run build`: pass with `/accounts` and `/api/export/accounts-csv` in the production route manifest.
- `git diff --check`: pass.
- `npm audit --audit-level=high`: reports the current `brace-expansion` advisory through the dev-only ESLint chain.
  `npm audit fix` updated the lockfile to patched `brace-expansion` versions `1.1.17` and `5.0.8`.
  Do not use the suggested forced ESLint 10 major upgrade as an incidental Phase 2 change.

Phase 1 remains deferred until more production pages exist.
After this branch is delivered, expand and build Phase 3 (Cash Flow) test-first.
Continue carrying the five Phase 0 finance-domain invariants from the parity plan into every transaction-derived page.

The protected-main anomaly is explained.
Repository ruleset `Protect main` lists user `8563761` as an `always` bypass actor, and GitHub reports that the current user can always bypass it.
That is why direct commit `8d2dcea` landed even though the push also printed `Cannot update this protected ref`.
Change that actor to pull-request-only bypass, or remove it after confirming another recovery path.
No repository rule was mutated during this phase.

<!-- Previous kickoff retained for historical context.
## START HERE — next session (as of 2026-07-29)

Phase 0 is **merged to main** (PR #69). Main is green: 801 unit tests, 114 files.

**Do Phase 2 (Accounts) next. Skip Phase 1 for now.**
Phase 1 is navigation, and its own plan says nav entries stay hidden until a page is production-ready, so on its own it would ship almost nothing visible; one of its steps (move "Year in Money" under Reports) also needs a Reports page that does not exist yet.
Do Phase 1 later as a small cleanup once two or three real pages exist.
Phase 2 is the right next move because its daily `account_balance_snapshots` table is what Phase 8 (dashboard widgets) and Phase 10 (forecasting) both read, and history only accumulates once the table is live: every day you wait is a day of missing chart data.

Sequence for the next session:

1. Read Phase 2 in `docs/superpowers/plans/2026-07-29-monarch-parity.md`, plus the "Phase 0 implementation notes" in the same file (four interface decisions that differ from the plan's original sketch).
2. Expand Phase 2 into its own dated plan file with `superpowers:writing-plans`, breaking each checkbox into red-green-refactor-commit steps.
3. Branch `feat/accounts-page`, then build it test-first.

**The one step only a human can do:** this repo has no migration runner, so `supabase/migrations/<ts>_account_snapshots.sql` must be applied to the live Supabase project (CLI or dashboard SQL editor) *before* any code reading those columns is merged. Plan the PR so the migration lands and is applied first, then the reading code.

Carry these forward into every later phase — they are already true on main:

- Consume `projectFinanceTransactions` from `lib/finance-domain.ts`. Never re-apply merchant rules, category overrides, refund netting, or `EXCLUDED_PFC` in a page; that is exactly the drift Phase 0 exists to prevent.
- New pages pass **real splits** to the projection. Only `lib/dashboard.ts` passes `splits: []`, because it distributes splits downstream over active-month spend and would otherwise apply them twice.
- Read transactions through `fetchFinanceTransactions` in `lib/finance-query.ts` (column-explicit, paginated, upper-bounded). No `select("*")`, no unbounded reads.
- Take scope from `parseFinancialScope`; pass `scopeQueryUserId(scope)` to service-client queries so `user_id` is always explicit.
- Gate any unreleased page behind `lib/feature-flags.ts`. Flags control reachability only, never auth or RLS.

-->
## Session of 2026-07-29 (branch `feat/finance-domain-foundation`, merged as PR #69)

Started the financial-planner parity program.
The reviewed master plan is `docs/superpowers/plans/2026-07-29-monarch-parity.md`: 14 phases, each its own branch and PR, each expanded into TDD steps before implementation.

**Phase 0 (canonical finance semantics) is complete and committed.**
It exists because the draft plan had four separate phases re-deriving transaction meaning, which would have produced pages that disagree about the same month's totals.

Four new modules, all pure and unit-tested:

- `lib/finance-domain.ts` — `projectFinanceTransactions` decides transaction meaning once: merchant rules, then category overrides, then split expansion, then refund netting, then transfer classification, then a stable `(date, id)` sort.
  `financeTotals` is the only place income/expense/net are summed.
- `lib/financial-scope.ts` — `mine` vs `household` scope; a household id is honored only when it appears in the RLS-visible list, so a guessed id degrades to personal scope instead of erroring.
- `lib/finance-query.ts` — column-explicit, paginated, upper-bounded reads.
  Reports truncation rather than silently dropping rows.
- `lib/feature-flags.ts` — server-side flags for unreleased pages; they gate reachability only, never auth or RLS.

`lib/dashboard.ts` now consumes the projection instead of re-deriving semantics inline, and `EXCLUDED_PFC` is an alias of `TRANSFER_GROUPS` so there is one definition.
`tests/unit/dashboard-finance-parity.test.ts` pins dashboard totals to `financeTotals` over the same ledger — if they ever drift, that test fails.

Read "Phase 0 implementation notes" in the plan before starting any later phase: it records four interface decisions that differ from the plan's original sketch, most importantly that the dashboard deliberately passes `splits: []` (it applies splits downstream) while new pages should pass real splits.

Gates at completion, all green: `npm run lint`, `npm run typecheck`, `npm run test:unit` (114 files / 801 tests), `npm run build`.
No migrations in this phase, so nothing to apply to the live project.

Next: Phase 1 (navigation and information architecture), which adds nav entries only as each vertical slice becomes usable — no authenticated "Coming soon" pages.

## Latest session (2026-07-23, branch `feat/remaining-must-haves`)

Merged the four-session roadmap drop (previously staged in a `new_changes/`
folder) into the repo at its real paths.
The full per-feature record lives in `docs/CHANGES-roadmap-2026-07-23.md` —
read that for what shipped; this note only covers what a resuming session
needs to act on.

Headline additions: financial-intelligence tiles (Safe to Spend, next
paycheck, emergency runway), encrypted monthly backups, integrity checks and
a `/api/health` endpoint, real Anthropic-backed AI insights with rule-based
fallback, full per-connection household sharing behind an explicit scope chip,
iCal feed, OFX/QFX import, personal API tokens, web push, demo mode, command
palette, saved ledger views, bulk tagging, and a `/wrapped` year-in-review
page.

Gates run after the merge, all green: `npm run lint` PASS, `npm run typecheck`
PASS, `npm run test:unit` PASS (87 files / 517 tests), `npm run build` PASS.

**Before deploying, work the checklist at the top of
`docs/CHANGES-roadmap-2026-07-23.md`.** The short version:

1. Apply all three new migrations in filename order —
   `20260723100000_phase_features.sql`,
   `20260723150000_bucket_features.sql`,
   `20260723200000_full_sharing_push_prefs.sql`.
   Pages read columns these create and fail until they run.
2. Set `BACKUP_ENC_KEY` (32 bytes base64) in Vercel env; the backup cron fails
   closed without it. It is deliberately a different key from
   `PLAID_TOKEN_ENC_KEY`.
3. Optional: `ANTHROPIC_API_KEY` (real AI insights; rule-based summaries keep
   working without it), `PLAID_LIABILITIES_ENABLED=1` (paid Plaid product, auto
   card APRs), and VAPID keys for web push (`VAPID_PUBLIC_KEY`,
   `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`).

New deps: `@anthropic-ai/sdk`, `web-push`, `@playwright/test`,
`@types/web-push`. New script: `npm run test:e2e` (Playwright; needs
`npx playwright install chromium` and a running app).

## Previous session (2026-07-16, branch `feat/remaining-must-haves`)

Delivered the three remaining must-have items from `docs/TODO.md`: session
revocation enforced on page renders, cron-failure alert emails, and a mobile
polish pass. All gates green: `npm run build` PASS, `npm run lint` PASS,
`npm run test:unit` PASS (374 tests). See
`.superpowers/sdd/task-9-report.md` for the full session record.

- **Session revocation on page renders.** `proxy.ts` now calls
  `isSessionRevoked` (from `lib/session-revocation.ts`) for every logged-in,
  non-MFA-pending, non-API page request; a revoked session triggers
  `supabase.auth.signOut({ scope: "local" })` and a redirect to `/login` with
  the queued cookie clears copied onto the redirect response. API calls were
  already 401'd on a revoked session via `requireUser()` in `lib/http.ts`.
  Files: `proxy.ts`, `lib/session-revocation.ts`. QA: end-to-end browser
  verification with Playwright (see `.superpowers/sdd/revocation-e2e-report.md`)
  confirmed a revoked session redirects `/dashboard` to `/login`, clears
  `sb-*` cookies, and 401s a follow-up authenticated API call.
- **Cron-failure alert emails.** `lib/cron-alert.ts` (`alertCronFailure`)
  emails the admin profile (`profiles.role = 'admin'`) when a cron run has
  failures, deduped to one alert per cron name per 24h via the existing
  Postgres rate limiter; the email body includes the cron name, failure
  count, and a truncated first error. Wired into `/api/cron/sync` (per-user
  sync failures plus the whole-run catch) and `/api/cron/weekly-report`
  (report failures plus the whole-run catch). Never throws: a failing alert
  send cannot break the cron's own response. Files: `lib/reporting.ts`
  (`sendCronAlertEmail`), `lib/cron-alert.ts`,
  `app/api/cron/sync/route.ts`, `app/api/cron/weekly-report/route.ts`. QA:
  unit tests cover the success, rate-limit-dedupe, no-admin-profile,
  no-admin-email, and send-failure paths (`tests/unit/cron-alert.test.ts`,
  `tests/unit/cron-sync-route.test.ts`,
  `tests/unit/cron-weekly-report-route.test.ts`).
- **Mobile polish.** A stacked card ledger below the `sm` breakpoint
  (`components/transactions/MobileLedgerList.tsx`, wired into
  `app/transactions/page.tsx`), 44px minimum touch targets on nav links and
  month chips, and a scroll-strip edge-fade affordance on the mobile nav.
  Also fixed a site-wide mobile overflow bug: the mobile nav strip's
  `-mx-4`/`-mx-6` bleed pattern had no matching parent padding to cancel
  against, causing horizontal scroll on every signed-in page at phone
  widths. Files: `components/transactions/MobileLedgerList.tsx`,
  `app/transactions/page.tsx`, `components/dashboard/MonthChips.tsx`,
  `components/shell/AppSidebar.tsx`. QA: screenshot-verified with Playwright
  at 375px and 414px across all nine signed-in routes plus `/login`, before
  and after the overflow fix; a programmatic scan confirmed no control
  overlaps or sub-24px tap targets.
- **Deployment consideration:** cron alert emails require an admin profile
  (`profiles.role = 'admin'`) and production `SMTP_*` env; if either is
  missing, `alertCronFailure` logs and skips the send rather than throwing.

## Previous session (2026-07-13, weekly report scheduler repair)

The weekly report had never once delivered. Four independent faults were
stacked on top of each other; each one only became visible after the one in
front of it was cleared. End state: a `workflow_dispatch` run returned
`{"ok":true,"users":1,"due":1,"reports_sent":1,"reports_failed":0}`, the
2026-07-06..07-12 report landed, and an immediate re-run returned
`reports_skipped:1`, confirming the delivery claim prevents duplicates.

1. **Wrong scheduler URL.** `FUNDFLOW_APP_URL` held a URL that Vercel
   redirects (an `http://` origin or a Deployment-Protection-gated alias), so
   curl got a 3xx `Redirecting...` body and never reached the app. The secret
   now holds the canonical production domain `https://fund-flow-swart.vercel.app`.
   **If that alias ever changes, update the secret.** Note curl cannot simply
   follow the redirect: it strips `Authorization` across hosts.
2. **One-hour due window.** `isWeeklyReportDue` matched a single local hour
   (Monday 08:00), and GitHub Actions cron is best-effort: it delayed and
   dropped hours, including that one, so the report was never owed to anyone.
   It is now "Monday 08:00 local onward, all week", so a skipped or failed run
   catches up later. Safe because the period is constant for the seven days
   after it rolls over, and `claimWeeklyDelivery` dedupes on `period_start`.
   Consequence: a `failed` delivery now retries hourly for the rest of the
   week rather than being abandoned.
3. **pdfkit fonts missing from the bundle.** pdfkit reads its standard-font
   metrics off disk at render time. It is not auto-externalized, so Turbopack
   bundled it and rewrote the read to `/ROOT/node_modules/pdfkit/js/data/
   Helvetica.afm`, which does not exist in the deployed function. Every send
   died with ENOENT before an email was attempted, and `/api/export/report`
   was broken the same way. Fixed in `next.config.ts` with
   `serverExternalPackages: ["pdfkit"]` plus `outputFileTracingIncludes` for
   both PDF routes. **Any new route that renders a PDF must be added there.**
4. **No SMTP.** Production had no `SMTP_*` vars at all, so `lib/reporting.ts`
   refused to send (by design). Now configured against Resend. Resend's shared
   `onboarding@resend.dev` sender only delivers to the Resend account's own
   address; sending to any other recipient returns `550`. If the recipient
   address ever changes, either verify a domain and set `SMTP_FROM`, or move
   to an SMTP provider without that restriction.

## Previous session (2026-07-12, branch `feat/weekly-insights-notifications`)

Implemented timezone-aware weekly spending insights and a first-class notification center. Reports cover the previous Monday through Sunday and include categorized spending, prior-week comparison, top merchants, budget pace, depository cash flow, and bank and credit card spend. The HTML email and attached PDF exclude balances, masks, account numbers, and transaction detail.

Delivery is idempotent through `weekly_report_deliveries`, retries failed or stale work, isolates per-user failures, and sends to the Supabase Auth signup email. `/notifications` controls optional weekly and daily email plus optional planning alerts. Broken-bank, sync, Auth, and security messages remain mandatory.

Deployment requirements:

- `20260713051741_weekly_insights_notifications.sql` was applied to the live FundFlow project on 2026-07-12 through the Supabase migration API.
- Configure production `SMTP_*` values.
- GitHub Actions provides the hourly trigger because the linked Vercel project is on Hobby. Repository secrets `FUNDFLOW_APP_URL` and `CRON_SECRET` were configured on 2026-07-12.
- Run the weekly email visual QA section in `docs/QA.md` with a signed-in browser and real email client before production rollout.

## Latest session (2026-07-11, branch `feat/todos-roadmap`)

Three-level dashboard drill-down and advanced ledger filters completed. All code-level gates green: `npm run build` ✓ · `npm run lint` ✓ (2 pre-existing warnings in an integration test) · `npm run test:unit` ✓ **231 tests**.

- **Three-level drilldown:** dashboard `OverviewTab` category donut slices, merchant lists, and subscriptions link dynamically to in-place subcategory donut, top merchants, and 6-month trends, using search parameters (`/dashboard?category=X&sub=Y`).
- **Interactive charts:** donut slices link to category drills, trend charts preserve drill filters when pivoting months, and diverging columns link back to dashboard views.
- **Advanced ledger filters:** `/transactions` page supports exact parameters (`category`, `sub`, `merchant`, `flow`, `accountType`) with dynamic badge chips for easy removal.
- **Data layer support:** added `buildCategoryDrilldown` and `buildMerchantDrilldown` helpers to fetch and aggregate history cleanly with zero new data, zero Plaid calls, and zero schema migrations.
- **Verification:** 35 new unit tests added covering the drilldown calculations, panel rendering, and parameter wiring.

## Previous session (2026-07-08)

Security review of the branch + three roadmap partials finished. All code-level
gates green: `npm run build` ✓ · `npm run lint` ✓ · `npm run test:unit` ✓.

- **Security fix (HIGH):** `getGoals` was called with the RLS-bypassing service
  client in the notification cron with no `user_id` filter — a cross-user leak
  of goal names/amounts into other users' notifications/digest emails. Now takes
  `userId` and scopes the query (`lib/goals.ts`, `lib/notifications.ts`);
  regression test added.
- **Security fix (MEDIUM):** the offline service worker cached authenticated
  page HTML into Cache Storage (persisted across logout on shared devices).
  `public/sw.js` now serves navigations network-only and caches only static
  assets.
- **Refund netting:** linked refund pairs net out of dashboard spend/income
  aggregation (`getDashboardData` reads `linked_refunds`); cash-flow + ledger
  still show them.
- **Splits/notes UI:** per-row ledger editor (`TransactionEditor` →
  `/api/transactions/annotate`) for note, tags, and category splits.
- **CSV column remap:** import preview offers manual column mapping when
  auto-detection fails (`normalizeColumnMap`/`getCsvColumns`, `parseImportCsv`
  `columns` override).
- **Migration:** `20260708040000_roadmap_completion.sql` (transaction_annotations,
  transaction_splits, linked_refunds, transaction_review_decisions,
  user_session_records, mfa_backup_codes) was **NOT** applied to the live project
  until **2026-07-08** — it was applied via the dashboard SQL editor after the
  refund Link button 500'd in production (the tables didn't exist). Verified all
  six tables now return 200. If you spin up a fresh project, apply it.
- **Deferred (not a merge blocker):** session revocation is API-only — revoke
  sets `revoked_at` but does not `auth.admin.signOut` or gate page renders in
  `proxy.ts`; and a full multi-breakpoint mobile visual QA still needs the
  running app (the shell/pages are already Tailwind-responsive).

## Where we are

A secure personal-finance app (Next.js 16 + Supabase + Plaid) is **built and
verified at the code/DB level**. The only thing left is a **browser end-to-end
run**, which is blocked on adding Plaid Sandbox keys.

**Status: green.**

- `npm run build` ✓ · `npm run lint` ✓ · `npx tsc --noEmit` ✓
- `npm test` ✓ **20 files / 99 tests** (unit + integration against the live FundFlow DB)
- Supabase migrations **applied** to the FundFlow project (`zrxbmmtqqhlwtrinocww`)
- RLS cross-user isolation and sync idempotency are **proven by integration tests**

## Key facts / decisions

- **Stack:** Supabase-native on Vercel. Next.js App Router (TS). No Java. See the
  approved plan: `~/.claude/plans/build-a-secure-ai-powered-parsed-valiant.md`.
- **Supabase project:** FundFlow, ref `zrxbmmtqqhlwtrinocww`. URL + keys are in
  `.env.local` (gitignored). A separate old project (`ofyyjzjjmopwvfqlhnyc`,
  paper-trading) exists — do NOT touch it.
- **MCP gotcha:** the Supabase MCP connector in the last session pointed at the
  OLD project. `.mcp.json` now points at FundFlow but needs a Claude Code
  restart and `/mcp` OAuth to use. We bypassed it by applying migrations via the SQL editor
  and verifying with the integration tests (which hit FundFlow directly).
- **Personal app, 1-2 users.** AI is NOT integrated by design — instead a CSV
  export the user feeds to an external AI.
- **Secrets note:** the Supabase secret key was pasted in chat earlier; consider
  rotating it (dashboard → API Keys) at some point.

## To resume (do this next)

1. **Add Plaid Sandbox keys** to `.env.local`:
   - `PLAID_CLIENT_ID` and `PLAID_SECRET` from
     <https://dashboard.plaid.com/developers/keys> (keep `PLAID_ENV=sandbox`).
2. **Supabase Auth setting:** in the FundFlow dashboard, Auth → Providers → Email,
   either disable "Confirm email" for easy local testing, or use the emailed link
   (handled by `/auth/callback`).
3. `npm run dev`, open <http://localhost:3000>:
   - Sign up, (optionally enroll TOTP in Settings), log in.
   - Click **Connect a bank** → Plaid Sandbox → `user_good` / `pass_good`.
   - Confirm the dashboard fills in (balances, categories, merchants, recurring).
   - Click **Refresh** twice → verify no duplicate transactions.
   - Settings → **Download CSV** → confirm only date/merchant/amount/category.
   - Settings → **Disconnect** a bank and **Delete account** flows.
4. Optional hardening check: `curl -I http://localhost:3000` → verify CSP + security
   headers are present.

## Deploy later (Vercel)

- Import repo, add all `.env.local` vars as Production env vars.
- `vercel.json` already schedules the daily cron (`/api/cron/sync`, guarded by
  `CRON_SECRET`).
- Flip `PLAID_ENV=production` + production Plaid keys to use the 10 real
  connections.

## Where things live

- Plan: `~/.claude/plans/build-a-secure-ai-powered-parsed-valiant.md`
- Future features: `docs/TODO.md` (card designs, mobile, per-card/per-bank spend,
  checking cash-flow insights, monthly history, email report, webhooks, AI).
- Full walkthrough + security checklist: `README.md`
- Migrations: `supabase/migrations/0001_init.sql`, `0002_rate_limit.sql`

## Not yet done

- Browser end-to-end run (needs Plaid keys — step above).
- Cleanup work is on branch `cleanup/docs-and-issues`. Commit when ready.
- Everything in `docs/TODO.md` is deferred by design.
