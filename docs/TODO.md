# FundFlow — Future Todos

Nice-to-have features and enhancements, deferred out of the initial build.

## Completed 2026-08-09: shipped-defect follow-up

All approved phases from `~/.claude/plans/create-a-plan-on-toasty-treehouse.md` are implemented in PR #99.
This includes persistent receipts, grouped budget and investment dashboard widgets, institution branding, goal artwork, OFX/QFX import, debt payoff planning, recurring sinking funds, duplicate review, passkeys, and multiple named TOTP recovery factors.
The four new migrations are applied to the live Supabase project, institution branding is backfilled, and production passkey configuration targets the canonical FundFlow origin.
The browser gap is closed by deterministic feature journeys, a four-viewport and two-theme interaction matrix, and 26 reviewed desktop visual baselines.

## Completed program: Monarch visual parity (started 2026-08-02)

Plan: `docs/superpowers/plans/2026-08-02-monarch-visual-parity.md`.
Design: `docs/superpowers/specs/2026-08-02-monarch-visual-parity-design.md`.
This is distinct from the feature-parity program below, which is also complete.

- **Sankey exact-match.** Done (2026-08-02). Nine deltas on the `/reports`
  cash-flow diagram: two-line labels, emoji prefixes (`lib/category-emoji.ts`),
  trimmed two-decimal percentages, weighted column spacing, hub label beside
  its bar, thinner bars, more saturated ribbons, Net Income pinned to the top
  of the group column, and group hues pinned by identity instead of size rank.
- **Phase V0 — token retheme.** Done (2026-08-02). `app/globals.css` rewritten
  to Monarch's warm cream + orange identity, colors pixel-sampled from the
  screenshots (see the dark-mode-is-likely-filtered caveat in the design doc
  §2.1). Pill buttons, unified modal recipes,
  `.metric-value` off monospace, new `--pill`/`--settings-active` tokens, a
  handful of flagged internal inconsistencies fixed in passing.
- **Phase V1 — shell restructure.** Done (2026-08-02). `components/shell/TopBar.tsx`
  deleted; the sidebar (`SidebarShell.tsx`) is now full height with a fixed
  top strip (logo + `SidebarUtilityIcons`), scrollable nav, and a fixed
  bottom block (`AskAiLowerRailLink` + the new `UserMenu` — avatar, display
  name, dropdown with Settings/privacy/theme/sign-out). Every page (16 total)
  migrated to a new `PageHeader` (title + actions), including a Dashboard
  greeting variant (`lib/greeting.ts`). Settings/Notifications deliberately
  kept in the nav list *in addition to* the new icon row, so collapsing the
  sidebar never makes either unreachable. Also fixed: `/transactions`'s
  stray `max-w-4xl` (every other page is `max-w-[1320px]`).
- **Phase V2 — shared component kit.** Done (2026-08-02). Six new primitives
  in `components/ui/`: `SegmentedControl` (link-based pill group, replaces
  three divergent chip recipes), `DropdownButton` (client popover),
  `ProgressBar` (replaces four ad-hoc bar recipes), `Avatar.tsx`
  (`MerchantAvatar`/`InstitutionAvatar`, deterministic initial-disc, no logo
  migration yet), `CategoryChip` (emoji + label). Plus `lib/format-date.ts`
  (humanized dates, relative freshness, due-date annotations). **Also wired
  broadly**, not just built: `SegmentedControl` replaced the toggle controls
  in ScopeChips, Accounts SummaryPanel, Cash Flow controls, Report controls,
  Budget (horizon/scope/currency + the summary tabs), and Recurring's scope
  toggle; `ProgressBar` replaced the bars in BudgetWidget, GoalCard,
  GoalsSummary, and Recurring's MonthSummary; `MerchantAvatar`/`CategoryChip`/
  `formatDate` landed in the Transactions ledger (desktop + mobile), Dashboard
  RecentActivity, and Recurring's occurrence rows. Institution-logo migration
  and the Recurring due-date relative annotation (needs a `today` value
  threaded through data it doesn't currently carry) are deferred to their
  page-specific phases.
- **Phase V6 — Budget rebuild.** Done (2026-08-02). `BudgetTable.tsx`
  rewritten: quiet borderless Planned input auto-saving `onBlur` (new pure
  `validatePlannedAmount`) replaces the labeled-field-plus-Save-button row;
  a per-row `ProgressBar` under the category name; Group/Rollover/Sort-order
  controls moved off the row into a per-row `⋯` popover (`RowMenu`). Old
  `BudgetSummary` stat-card grid deleted, replaced by `BudgetRightRail.tsx`
  (new) — tinted "Left to budget" hero + the same Summary/Income/Expenses
  tabs, now with a progress-bar mini-summary per expense group.
  `BudgetPlanner.tsx` groups sections into Income/Expenses/Contributions
  bands with totals rows, in a two-column layout with the sticky right
  rail. `SuperBand` section headers are deliberately not scroll-sticky
  pending a real browser check. New `tests/unit/budget-planner-render.test.ts`
  (14 tests).
- **Phase V7 — Recurring rebuild.** Done (2026-08-02). `RecurringList.tsx`
  rewritten: Upcoming/Complete render as real tables (merchant, date with
  an orange overdue annotation via `formatDueAnnotation`/`daysUntil`,
  payment account, category, amount with a check mark when complete, a
  `⋯` menu) ending in a grey total-band row. Confirm/Not recurring/Restore/
  amount-correction moved onto that per-row menu (`OccurrenceRowMenu`),
  which looks up the occurrence's stream or manual item and branches
  read-only/full-controls/enabled-toggle accordingly; the full stream list
  on the Manage tab is kept (streams due outside the viewed month have no
  other way to be reviewed). Tab selection moved from client state to the
  URL (`tab`/`links` props), which is what makes the restyled
  `ReviewBanner`'s new "Review now" link actually work. Page gained a
  visible month title + icon Previous/Next + conditional Today link. New
  `tests/unit/recurring-list-render.test.ts` (11 tests); the pre-existing
  `recurring-list.test.ts` needed no changes.
- **Phase V3 — Dashboard rebuild.** Done (2026-08-02). Asymmetric two-column
  widget grid (`WidgetDefinition.column`, replacing the old `wide` full-span
  flag); `WidgetShell` header anatomy (bold title + inline value +
  `DropdownButton`, each with one honest item) wired across all seven
  widgets; Net worth `Badge` + blue `AreaSparkline`; Spending chart
  orange-vs-grey; Recurring rich empty state + `Badge` statuses;
  `RecentActivity` `CategoryChip` + no debit-red; `CustomizeDrawer` rebuilt
  as a modal so its trigger moved into the page header. Deferred: Budget
  widget's group rows and Investments' day-change/top-movers (both need new
  data-loader wiring).
- **Phase V4 — Accounts rebuild.** Done (2026-08-02). `sparkLong` (second,
  longer-window sparkline column); per-group month-change annotation;
  `SummaryPanel` rebuilt with an assets bar segmented by group + legend and
  a single-color liabilities bar; real two-column page layout with a sticky
  Summary rail; `AccountsFilters` collapsible behind a "Filters" trigger
  with `AccountPreferences` nested inside it.
- **Phase V5 — Transactions rebuild.** Done (2026-08-02). Debit/credit color
  rule (no red debits) across the ledger, mobile cards, and dashboard
  RecentActivity; day-group header date/total split to opposite ends of the
  band; new `TableToolbar` collapses Edit multiple/Columns behind pill
  triggers. Deferred: a real Sort control and splitting the filter form into
  separate header popovers.
- **Phase V8 — Goals rebuild.** Done (2026-08-02). New `GoalCardMenu`
  (Edit/Add contribution/household toggle/Delete) makes v2 `GoalCard`s the
  single source of truth; `GoalsManager` now only renders when `goalsV2`
  is off. `GoalWizard` rewritten as a full-screen overlay (stepper pills +
  progress bar + centered footer), step logic unchanged. On-track badge
  tone fixed to green. Deferred: real photos for the 8 templates.
- **Phase V9 — Reports rebuild.** Done (2026-08-02). Stat tiles flipped to
  value-first with semantic income-green/spending-red colors; new
  `ReportRightRail` Summary card beside the transactions table; Cash
  Flow/Spending/Income tabs moved from a pill control inside the filter
  panel to underline `Tabs` next to the page title.
- **Phase V10 — Investments/Advice/Settings rebuild.** Done (2026-08-02).
  Investments: Add Holding is now a modal; holdings table gained an
  avatar, reordered columns, and a grand Total row; semantic-color fixes.
  Advice: `AdviceCard` rewritten as a `<details>` disclosure with a
  category icon and status meta; new Categories filter rail. Flagged: the
  design doc's "Update profile" pill would link to a questionnaire page
  that doesn't exist in this codebase — not built. Settings: nav split
  into Account/Household grouped cards; Profile's submit button is now
  full-width "Update Profile."
- **Phase V11 — sweep.** Done (2026-08-02). Read all five no-reference
  pages (Cash Flow, Forecasting, Notifications, Review, Wrapped);
  Forecasting/Notifications/Review were already clean. Fixed:
  `CashFlowSummary`'s raw `--viz-good`/`--viz-bad` colors (semantic tokens,
  layout unchanged — no reference screenshot to justify a redesign);
  Wrapped's year-chip touch targets and raw ISO date; Notifications'
  `toLocaleDateString` → shared `formatDate`. Grepping for that same color
  bug repo-wide found four more real instances (`StatTile`, `PlanView`,
  `WhatIfPanel`, `GoalsManager`, `ReportTransactions`), fixed in the same
  pass. Not done: dark-mode screenshot QA and a Playwright visual-snapshot
  baseline — both need a real browser this sandbox doesn't have.

**Every phase in the Monarch visual-parity program (V0–V11) is now done.**
The one thing every phase still needs: a real browser visual pass. This
sandbox's `npm run dev` can't reach Google Fonts (Turbopack-specific; `curl` from the
same shell works fine), so verification so far is the automated gate
(build/lint/typecheck/unit tests) plus manual review, not an actual screenshot
comparison against the references.

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

## ~~Added 2026-07-31 (UI review) — three pre-existing E2E failures~~

**Fixed 2026-08-09.**
The whole `tests/e2e` suite now passes on two consecutive full runs: 19 specs, with the 16 golden-path and reports specs still skipping without `E2E_EMAIL`/`E2E_PASSWORD`.

Every one of the three original diagnoses was wrong, so they are recorded rather than deleted.

1. **`POST /api/demo` does not 500.**
   The route is fine for a household owner.
   The accounts spec died later, at `getByLabel("History")`, which matched four elements: the filter field plus every row's `"<name> full-history trend"` sparkline.
   Underneath sat a real defect.
   Those sparkline labels were `aria-label` on a bare `<div>`, which is `role="generic"` and cannot carry an accessible name, so both charts shipped with **no** text alternative at all.
   Fixed with `role="img"`, matching `SummaryPanel` and `NetWorthHero`.
2. **Nothing mounts Plaid Link twice.**
   The warning is React Strict Mode, which means `next dev` only.
   `react-plaid-link`'s `useScript` cleanup removes the `<script>` and deletes its cache entry while it is still loading, so the Strict-Mode remount appends a second one and the first still executes.
   Verified absent from a production build.
   `budget`, `recurring` and `transactions` had each already filtered this warning with their own undocumented copy; that is now one explained helper, `tests/e2e/console-noise.ts`.
3. **`budget.spec.ts:467` was a data regression.**
   The Expenses tab of `BudgetRightRail` lost its Planned and Actual totals when the four-card stat grid became tabs, while Income kept both.
   The component's own doc comment still claimed both were there.
   "Actual expenses" is the figure that reconciles Budget against Cash Flow, so it had nowhere left to appear.
   Restored.

Real defects the repair surfaced, all fixed:

- `SegmentedControl` segments were 36px and `Tabs` 42px, against the app's own 44px bar that every other `components/ui` primitive meets.
- `TotalsRow` in `BudgetPlanner` overflowed a 390px phone: three fixed-width columns plus `gap-6` need about 344px before the label even starts.
  `SuperBand` solves the same problem by hiding its captions, but figures cannot be hidden, so these wrap instead.
- `/recurring` gave a 390px phone **623px of horizontal page scroll**.
  The occurrence table is correctly wrapped in `overflow-x-auto`, but its `sr-only` Actions header is `position: absolute`, and a `position: static` scroll container is not a containing block.
  That span was therefore positioned against the viewport and escaped the clip entirely.
  One `relative` class fixes it.
- The row menu's Group select and Rollover checkbox had no per-row accessible name, unlike the Sort order input beside them.

**Still open (follow-ups, not blockers):**

- Five specs still assert `documentElement.scrollWidth <= clientWidth`.
  That agrees with reality but names nothing, so a failure says the page is broken without saying where.
  `tests/e2e/layout-checks.ts` is the replacement, and it explains why its offender sweep alone is insufficient: the sweep cannot see an absolutely-positioned escapee, which is exactly the `/recurring` bug above.
- `recurring.spec.ts` was recorded as the passing reference spec.
  It was not.
  It failed on `main` for the `/recurring` overflow above, confirmed independently by stashing every UI change.

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

## ~~Dark-mode categorical palette fails all-pairs CVD (found 2026-07-31)~~ Fixed 2026-08-09

Both modes now pass the pairwise gates **and** the 3:1 surface-contrast gate.
The dark set was re-stepped wholesale in `app/globals.css` (both the
`[data-theme=dark]` block and the `prefers-color-scheme` block):

```css
--viz-1: #77a9ea; /* was #3987e5 */
--viz-2: #55c795; /* was #199e70 */
--viz-3: #f1a824; /* was #c98500 */
--viz-4: #299525; /* was #008300 */
--viz-5: #755efd; /* was #9085e9 */
--viz-6: #d57c75; /* was #e66767 */
--viz-7: #d33ea7; /* was #c2379a */
```

Four things this turned up, worth keeping:

1. **The palette was failing three pairs, not one.** Besides the reported
   `--viz-5` violet ↔ `--viz-1` blue (ΔE 1.9 protan), `--viz-2` aqua ↔
   `--viz-4` green (11.9) and `--viz-3` yellow ↔ `--viz-6` red (13.0) were
   both under the **normal-vision** floor of 15 — confusable for
   full-colour-vision users, not only for a protanope. The original entry
   framed this as CVD-only.
2. **Re-stepping one slot alone cannot work.** Holding the other six fixed and
   sweeping 14,077 in-gamut candidates for slot 5 across the whole hue circle
   yields zero passes. Slot 5 was the worst pair, never the binding one.
3. **Pairwise ΔE and surface contrast are independent, and the validator was
   only measuring the first.** An intermediate re-step
   (`#9f12a0`, `#a457ef`, `#2c94b0`, `#8e5223`, `#449546`, `#544ec5`,
   `#cb5790`) passed every pairwise gate and put `--viz-1`, `--viz-4`, and
   `--viz-6` at 2.33:1, 2.56:1, and 2.48:1 against the dark panel, below WCAG
   1.4.11's 3:1 minimum — a regression from the previous set, whose worst slot
   was 3.22:1. `scripts/validate_palette.js` now gates both, so this class of
   change cannot pass silently again.
4. **An earlier note here claimed no variant clears both gates. That was
   wrong.** Constraining the search to per-slot candidates that already clear
   3:1 and anchoring each slot to the light palette's OKLCH hue finds passing
   sets readily; the shipped one clears every pairwise gate with a worst-case
   surface contrast of 3.62:1 and **zero** hue drift from light mode, so the
   two themes keep one identity. The earlier search had been sweeping the full
   lightness band and only re-stepping 3–4 slots.

Light `--viz-2` (2.82:1) and `--viz-3` (2.17:1) remain below the contrast floor
on white and are carried as two named exceptions in the validator: a saturated
aqua and a yellow cannot reach 3:1 on `#ffffff` without abandoning the V0
identity. They rely on the same direct-label / table-twin relief the 6–8 CVD
band already requires. That exception list is a ratchet — never extend it to
make a re-step pass.

`--viz-pos`/`--viz-neg` are the diverging pair and keep the old blue/red — a
different job on their own charts (`DivergingColumns`, `BreakdownBars`), never
mixed with the categorical slots.

**Closed 2026-08-09:** the palette is validated numerically and included in the authenticated dark-mode route matrix and reviewed visual baselines.

A related finding worth keeping: **the palette cannot be grown past seven.**
`--viz-7` was added on 2026-07-31 and clears every check in both
modes. An eighth hue drops CVD separation to ΔE 2.4, and an evenly spaced
12-hue set (identical L and C, maximal angular separation, the most favourable
construction available) to 0.4 deuteranopia and 6.7 normal vision. Any future
"colour every category" request runs into this ceiling, not into effort.
