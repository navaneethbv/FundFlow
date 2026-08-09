# FundFlow — Session Handoff

Last updated: 2026-08-09. Read this first to resume.

## Latest delivery: every approved shipped-defect phase is implemented

Branch `fix/shipped-defects`, PR #99.
The reviewed plan is `~/.claude/plans/create-a-plan-on-toasty-treehouse.md`.

Phase A repairs the PWA identity, restores an environment kill switch for default-on feature flags, removes false security claims, makes the seven-slot dark chart palette pass the repository validator, and restores a clean lint boundary.
Phase B1 repairs the legacy browser baseline and the UI defects it exposed.
Phase C completes persistent private receipts, grouped dashboard budgets, investment day movement and movers, institution branding, bundled goal artwork, and OFX/QFX import preview.
Phase D adds debt payoff planning, recurring sinking funds, persisted cross-source duplicate review, Supabase passkeys, and multiple named TOTP factors as the recovery path.
The unusable custom backup-code table was removed because Supabase Auth does not expose backup-code consumption as an authentication factor.
Passkeys retain the existing server-side AAL2 invariant, so an account with verified TOTP still receives the TOTP step-up after passkey sign-in.

The four new migrations are applied to the linked live Supabase project.
Production Auth has passkeys enabled for `fund-flow-swart.vercel.app` with the canonical HTTPS origin.
The institution backfill updated all six live Plaid items, including four available logos and six brand colours.

Browser coverage now uses disposable live-Supabase users and deterministic finance fixtures.
It covers the completed feature journeys, the primary-route responsive matrix at 375, 430, 768, and 1440 pixels in both themes, collapsed and expanded shell states, the account menu, and 26 reviewed desktop visual baselines.

Two test-harness traps are worth knowing before writing more specs.
Playwright's default `caret: "hide"` on `page.screenshot()` mutates inline styles and races hydration on the next reload, so visual captures use `caret: "initial"`.
`getByLabel` substring-matches, so a bare `"History"` or `"Owner"` collides with sparkline labels and with the signed-in user's own email address.

## Previous delivery: transaction sorting and staged filters

The Transactions page now has explicit Search, Date, Filters, and one shared Sort popover across desktop and mobile.
Date, account, category, subcategory, merchant, money direction, and account type changes are staged locally until Apply, while search applies on Enter or its Search button.
Applied chips, Clear filters, pagination, browser history, column state, and saved views all preserve the normalized ledger URL contract.
Date and displayed signed amount use deterministic database ordering, while merchant, category, and account sort the complete rule-adjusted display projection before selecting each 50-row page.
The previous silent 4,000-row rule-aware cutoff is gone, failed chunks no longer appear as successful empty results, and every financial query remains explicitly owner-scoped.
No migration or exchange-rate handling was added because this ledger is USD-only.

Verification passed with repository-wide lint, TypeScript, unit tests, the production build, and `tests/e2e/transactions.spec.ts` against a disposable Supabase user with 56 seeded transactions.
The browser journey covered all five sort fields in both directions, complete ordering across two pages, merchant-rule display values, staged Apply behavior, saved-view restoration, Back and Forward, client navigation without reload, mobile controls, Escape handling, and focus restoration.

## START HERE: Monarch visual-parity — every phase (V0 through V11) is done

The 14-phase Monarch feature-parity program below is complete and released.
The follow-up visual-parity plan is `docs/superpowers/plans/2026-08-02-monarch-visual-parity.md`.
Its design is `docs/superpowers/specs/2026-08-02-monarch-visual-parity-design.md`.
The latest delivery section records the completed browser, responsive, and visual-baseline verification that closed the historical gap described below.

1. **Sankey exact-match** (`/reports` cash-flow diagram). Nine deltas closed
   the gap with Monarch's own Sankey: two-line labels (name + bold amount/
   percent), emoji prefixes (new `lib/category-emoji.ts`), trimmed two-decimal
   percentages, a weighted hub-to-groups column gap, the hub label moved
   beside its bar instead of floating above it, thinner sharper bars, more
   saturated ribbons, Net Income pinned to the top of the group column
   regardless of value, and group hues pinned by identity (Shopping is always
   magenta) rather than by that month's size ranking. Both existing geometry
   invariants (one shared value→pixel scale, ribbons never floored) hold.
2. **Phase V0 — token retheme.** FundFlow's cool-blue identity became
   Monarch's warm cream + orange one. Colors were **pixel-sampled** from the
   screenshots with a small `sharp` script, not guessed — see the sampling
   method and the important caveat in the visual-parity design
   doc's §2.1: the provided "dark" screenshots are very likely a simulated/
   forced dark-mode filter (the CTA desaturates from vivid `#FF6A2D` in light
   to a muted `#92472A` in "dark" at the *same hue*, which real dark themes
   never do on purpose), so the dark theme keeps the sampled neutrals but a
   **vivid** accent rather than the filtered one. New tokens: `--pill`
   (neutral nav/segmented-control active surface) and `--settings-active`
   (a blue tint reserved for Settings' active row — Monarch's one deliberate
   exception to "accent is never used for selection"). Buttons are now pills,
   the four modal recipes are unified (`bg-black/50`, `rounded-card`,
   `shadow-float`), `.metric-value` switched from Geist Mono to Geist Sans
   (class name unchanged — the privacy-blur selector keys on it), and several
   flagged internal inconsistencies were fixed in passing (Badge's raw
   Tailwind tone colors, the Accounts Mine/Household pill having no visible
   active state, TransactionEditor's off-token 16px radius).
3. **Phase V1 — shell restructure.** The 64px top bar spanning above the
   sidebar is gone; the sidebar (`components/shell/SidebarShell.tsx`) is now
   full height with a three-region layout: a fixed top strip (logo +
   `SidebarUtilityIcons` — search/bell/settings, hidden below `lg` and while
   collapsed + the existing collapse toggle), a scrollable nav list
   (unchanged), and a fixed bottom block (`AskAiLowerRailLink` + the new
   `UserMenu` — avatar/initials + display name + a dropdown holding
   Settings, the privacy-blur toggle, the theme toggle, and sign-out).
   `components/shell/TopBar.tsx` is deleted; every page's header migrated
   from the old eyebrow + `.display` H1 + description pattern to a new slim
   `PageHeader` (title left, actions right) — 16 pages total, including a
   Dashboard-specific "Good {morning|afternoon|evening}, {name}!" greeting
   (`lib/greeting.ts`, name resolved from the profile via the same
   `dashboard_prefs` query AppSidebar already ran, so no extra round trip).
   **Deliberately kept, unlike Monarch:** Settings/Notifications stay in the
   nav list *in addition to* the new icon row, specifically so collapsing
   the sidebar (which hides the icon row for space) never makes either
   unreachable. Also fixed in passing: `/transactions` was the only page
   capped at `max-w-4xl` instead of the shared `max-w-[1320px]`.

4. **Phase V2 — shared component kit, built and wired.** Six new
   `components/ui/` primitives (`SegmentedControl`, `DropdownButton`,
   `ProgressBar`, `Avatar.tsx`'s `MerchantAvatar`/`InstitutionAvatar`,
   `CategoryChip`) plus `lib/format-date.ts`. Not just built — wired
   broadly: `SegmentedControl` replaced toggle controls across ScopeChips,
   Accounts, Cash Flow, Reports, Budget, and Recurring (finding two more
   "no visual active state" bugs along the way, same class as the one V0
   fixed on Accounts' scope pills); `ProgressBar` replaced four ad-hoc bars
   (and moved two of them off raw `--viz-*` chart tokens onto the semantic
   `--success`/`--danger`/`--warning` ones, since they're status indicators,
   not chart series); `MerchantAvatar`/`CategoryChip`/`formatDate` landed in
   the Transactions ledger, Dashboard's RecentActivity, and Recurring's rows.
   Two structural pieces pulled forward from later phases while the
   primitives were already in hand: a new `NetWorthHero.tsx` on Accounts
   (the headline figure + trend chart, previously buried inside a card, now
   its own hero above the fold — V4), and Recurring's `MonthSummary`
   rebuilt from a right-rail column into Monarch's full-width 3-column
   strip above the list (V7). `DropdownButton` is built and tested but not
   wired anywhere real yet — its first candidates (Dashboard widget period
   switches, Transactions' toolbar) need more than a drop-in swap.
   **Also fixed:** `tsconfig.json`/`eslint.config.mjs` didn't exclude
   `new_changes/`, so a stale mirror copy could fail the real typecheck
   once a real file's exported prop types changed — both now exclude it.
5. **Phase V6 — Budget rebuild.** `BudgetTable.tsx` rewritten: a quiet
   borderless Planned input that auto-saves `onBlur` (new pure
   `validatePlannedAmount` helper — rejects unparseable/negative values,
   skips the request when nothing actually changed) replaces the old
   labeled-field-plus-Save-button row; a per-row `ProgressBar` sits under
   the category name; the Group/Rollover/Sort-order controls that used to
   sit inline on every row moved into a per-row `⋯` popover (`RowMenu`, its
   own small backdrop+Escape popover rather than forced onto
   `DropdownButton`, since it needs real form controls, not link/action
   rows). The old `BudgetSummary` stat-card grid is deleted, replaced by
   `BudgetRightRail.tsx` (new) — a tinted "Left to budget" hero plus the
   same Summary/Income/Expenses tab switch, now with a `GroupMiniSummary`
   (progress bar + spent/remaining) per expense group. `BudgetPlanner.tsx`
   groups sections into Income/Expenses/Contributions bands (new
   `SuperBand`/`TotalsRow` helpers) each followed by a totals row, in a
   two-column layout with the sticky right rail. `SuperBand` is
   deliberately **not** scroll-sticky (documented inline) — stacking
   independently-sticky strips without a browser to verify rendered
   heights risks silent overlap. New `tests/unit/budget-planner-render.test.ts`
   (14 tests) covers `validatePlannedAmount`, `BudgetTable`,
   `BudgetRightRail`, and `BudgetPlanner`.
6. **Phase V7 — Recurring rebuild.** `RecurringList.tsx` rewritten: Upcoming/
   Complete render as real tables (`OccurrenceTable`/`OccurrenceTableRow`,
   new) — merchant, date with an orange overdue annotation (finally wiring
   up `formatDueAnnotation`/`daysUntil`, built in V2's `lib/format-date.ts`
   but unused until now), payment account, category, amount (a
   `CheckCircle2` mark when complete), and a `⋯` menu — each ending in a
   grey total-band row. Confirm/Not recurring/Restore/amount-correction
   moved onto that per-row menu (`OccurrenceRowMenu`, new, same bespoke
   popover chrome as Budget's `RowMenu`), which looks up the occurrence's
   underlying stream or manual item and branches: read-only "Shared · view
   only" for a non-owned stream, the full review controls for an owned one,
   Enabled/Delete for a manual item. The full stream list on the Manage tab
   is **kept**, not removed — a stream due outside the viewed month never
   appears in that month's Upcoming/Complete tables, so Manage is still the
   only reliable place to review it. Tab selection moved from client
   `useState` to the URL (`tab`/`links` props, `Tabs` component) — this
   page had been the one holdout against the app's link-driven-controls
   convention — which is also what makes `ReviewBanner`'s new "Review now"
   link (replacing inert warning-toned text) actually work: it's now a real
   `<Link>` to the Manage tab instead of two server/client siblings with no
   way to reach across. The page also gained a visible month title between
   icon Previous/Next buttons plus a conditional "Today" link (previously
   just Previous/Next text links with no month shown at all). New
   `tests/unit/recurring-list-render.test.ts` (11 tests, the
   `renderToStaticMarkup` pattern V6 introduced) covers all of the above;
   the pre-existing `tests/unit/recurring-list.test.ts` needed **zero**
   changes, confirming the rewrite preserved every Phase 5 behavior it
   checks. `tests/e2e/recurring.spec.ts` updated (not executed — no live
   Supabase credentials here) for the Tabs-as-links change, the
   table-not-list occurrence markup, and icon-only Previous/Next.
7. **Phase V3 — Dashboard rebuild.** `lib/dashboard-widgets.ts`'s
   `WidgetDefinition.wide` (one widget spanning both columns) became
   `column: "left" | "right"` — Monarch's fixed asymmetric split (Budget/
   Net worth/Goals left, Spending/Transactions/Recurring/Investments
   right), not a free per-user choice; `DashboardWidgetGrid.tsx` renders
   two stacks instead of one grid with a col-span escape hatch.
   `WidgetShell.tsx` replaced the stacked eyebrow-above-title with
   Monarch's bold-title-plus-inline-value line, and every widget's plain
   "Open" link became a `DropdownButton` — each with exactly **one** honest
   item (a real navigation, never a decorative option), finally wiring in
   the primitive V2 built and deliberately left unused. Caught in the same
   pass: `DropdownButton`'s trigger/menu items were `min-h-9` (below this
   app's 44px floor) since V2 — never actually rendered on a real page
   until now — fixed to `min-h-11`. Per-widget: Net worth's delta is now a
   `Badge` (was raw `--viz-good`/`--viz-bad`, a V2 semantic-token fix that
   had missed this widget) over a blue `AreaSparkline` (gained an optional
   `color` prop + a `useId()` gradient id, fixing a latent duplicate-id bug
   when multiple instances render on one page); Spending's chart flipped to
   accent-orange-this-month/grey-last-month (was blue/dashed-grey);
   RecentActivity (shared by the Transactions widget, Monitor, and
   Overview) gained `CategoryChip` and dropped debit-red coloring (see V5).
   `CustomizeDrawer` became a real modal (matching `SeedBudgetButton`'s
   recipe) specifically so its trigger could move into the page header via
   new `DashboardHeaderActions.tsx` (kept `app/dashboard/page.tsx` under
   its enforced 260-line orchestrator budget). Deferred: Budget widget's
   3-group-row content (needs the Budget page's own group data wired into
   the dashboard loader) and Investments' day-change/top-movers strip
   (needs data the loader doesn't fetch).
8. **Phase V4 — Accounts rebuild.** `lib/accounts-page.ts` gained
   `AccountsPageRow.sparkLong` (the full snapshot history `spark`'s
   last-30-days slice was already computed from — no new query, just no
   longer thrown away) for a second, longer-window sparkline column per
   row; `groups[key].changes` (each group's total pill now shows a
   green/red "+$45.00 this month" summed from its rows' own
   `monthChange`); and `summary.assetsByGroup`/`liabilitiesByGroup`
   (`GroupAmount[]` per currency) for `SummaryPanel.tsx`'s rebuilt right
   rail — an assets bar segmented by group (cash/investment/other, the
   only three it can ever contain, pinned to `--viz-1/2/3` by identity)
   with a legend, and a single-color red liabilities bar per Monarch (not
   segmented). The page moved to a real two-column layout
   (`grid-cols-[minmax(0,1fr)_340px]`, matching V6's Budget rail pattern)
   and the "Export CSV" button relocated from the header into the Summary
   card as "Download CSV." `AccountsFilters.tsx`'s always-open GET form
   became a `<details>` behind a "Filters" trigger (auto-open when a filter
   is already active), with `AccountPreferences` now nested inside it as
   `children` — "relocates behind the Filters panel" per the design doc.
   `tests/e2e/accounts.spec.ts` updated: the filter fields and account
   preferences are no longer immediately interactable without opening
   Filters first, and the CSV link's accessible name changed.
9. **Phase V5 — Transactions rebuild.** The debit/credit color rule
   (Monarch never colors a debit red, only credits get green) landed
   across the desktop ledger table, `MobileLedgerList.tsx`, and — during
   V3 — Dashboard's `RecentActivity`. Day-group headers now put the date
   and net total at opposite ends of a `flex justify-between` band instead
   of one text run. New `TableToolbar.tsx` collapses "Edit multiple"
   (`BulkTagBar`) and "Columns" (`ColumnsMenu`) behind pill triggers,
   replacing two bars that used to render unconditionally above the
   table — both existing components pass through unchanged as
   already-rendered nodes from the server page. Deferred: a real "Sort ▾"
   control (needs new query-level sort logic, not a UI wrapper — a
   decorative dropdown with no effect would be exactly the anti-pattern
   this program has avoided everywhere else) and splitting the single
   inline GET filter form into three separate header popovers.
10. **Phase V8 — Goals rebuild.** New `GoalCardMenu.tsx` (bespoke popover,
    same chrome as Budget's `RowMenu`) gives every v2 `GoalCard` an Edit
    (name/date, plus `target_amount` for save-up or `target_balance` for
    pay-down — never `starting_balance`, a baseline the
    `set_goal_allocation` database function captures once by design),
    Add contribution (save-up only — `computeFundedGoals` never adds
    `eventTotal` for pay-down, so this posts to the audited
    `POST /api/goals/events` route rather than writing `saved_amount`
    directly), household-visibility toggle, and Delete. This makes v2
    cards the single source of truth, so `app/goals/page.tsx` now renders
    the legacy `GoalsManager` panel **only when `goalsV2` is off**
    (defaults to on) instead of always underneath the v2 cards.
    `GoalWizard.tsx`'s shell became a full-screen overlay (back arrow +
    centered stepper pills + progress bar + close × header, centered
    Continue/Skip footer) — internal step logic untouched. On-track
    badge tone fixed `neutral` → `success` (Monarch tints On track and
    Completed both green). Deferred: real photos for the 8 templates (no
    image assets available in this sandbox).
11. **Phase V9 — Reports rebuild.** `ReportSummaryPanel.tsx`'s stat tiles
    flipped to value-first with an uppercase micro-label below (was
    label-above-value), colors fixed to semantic `text-success` (income)
    /`text-danger` (spending) — deliberately the opposite convention from
    the ledger row's never-color-a-debit-red rule, since this is an
    aggregate tile, not a transaction row. New `ReportRightRail.tsx`
    beside the transactions table surfaces the same `summarizeTransactions`
    output as a Total transactions/Largest/Average/Total income/Total
    spending/First/Last-transaction/Download-CSV card — deliberately
    duplicating some top-tile figures, since Monarch shows both a
    quick-glance strip and a detail card, not one replacing the other.
    The Cash Flow/Spending/Income tab `SegmentedControl` moved out of
    `ReportControls`' filter panel into an underline `Tabs` row inline
    next to the page title (removed, not duplicated, from the old
    location).
12. **Phase V10 — Investments/Advice/Settings rebuild.** Investments:
    "+ Add Holding" became the standard modal recipe; `HoldingsTable.tsx`
    gained a security avatar, reordered columns (Price before Quantity),
    and a grand Total row; the `--viz-good`/`--viz-bad` inline-style bug
    (same pattern V3 fixed on Dashboard widgets) was fixed across
    `HoldingsTable`/`TopMovers`/`PerformanceChart`/the page's day-change
    figure. Advice: `AdviceCard.tsx` rewritten as a native `<details>`
    disclosure (category icon, `line-clamp-2` description, Not-started/
    In-progress/Completed meta, per-section "Show N completed" toggle);
    new `?category=` Categories rail. **Flagged finding**: the design
    doc's "Update profile" header pill assumes an "existing advice-profile
    questionnaire" that does not actually exist anywhere in this
    codebase (only `advice_priorities`/`advice_profile` profile columns
    and their API — no UI) — not built, since linking to a nonexistent
    page would be worse than omitting the button. Settings:
    `SettingsLayout.tsx`'s flat 13-item nav split into "Account" (5) and
    "Household" (8) grouped cards, exactly Monarch's split with no
    section added or removed; the active-row tint was already the
    correct "accent at low alpha" style. `ProfileSection.tsx`'s submit
    button became full-width and reads "Update Profile."
13. **Phase V11 — sweep.** Read all five no-reference pages (Cash Flow,
    Forecasting, Notifications, Review, Wrapped) end to end.
    Forecasting/Notifications/Review had already fully inherited V0–V2's
    tokens and primitives with nothing left over. Real fixes:
    `CashFlowSummary.tsx` had the same raw `--viz-good`/`--viz-bad`
    inline-style bug this program kept finding elsewhere (fixed to
    semantic tokens, layout unchanged — this page has no reference
    screenshot, so reordering to Reports' value-first tile anatomy would
    be inventing a redesign); `app/wrapped/page.tsx`'s year chips were
    below the 44px touch-target floor and its largest-purchase date
    rendered as a raw ISO string instead of `formatDate` (both fixed);
    `app/notifications/page.tsx`'s delivery-history dates used
    `toLocaleDateString` instead of the shared helper (fixed for
    consistency). **Grepping the whole repo for that same
    `var(--viz-good)`/`var(--viz-bad)` pattern** — the exact bug being
    fixed on the five target pages — turned up four more real instances
    outside them, fixed in the same pass since a repo-wide sweep is
    exactly when to close out a repo-wide pattern:
    `components/charts/StatTile.tsx` (shared, used by Wrapped and
    Dashboard's Monitor view), `PlanView.tsx` (price-drift figures),
    `WhatIfPanel.tsx` (surplus figure), `GoalsManager.tsx` (legacy
    progress bar, still reachable with `goalsV2` off), and
    `ReportTransactions.tsx` (already had the correct no-red-debits logic,
    just needed the token conversion). **Not done**: dark-mode screenshot
    QA and a Playwright visual-snapshot baseline — both need a real
    browser this sandbox doesn't have.

**Not done, and not started:** nothing — every phase in the design doc
(V0–V11) is now done. Each still has its own small, named,
deliberately-deferred remainder documented in its own numbered entry
above and in the visual-parity design's "What's next" section — none of it is a
silent gap, and none of it blocks anything else.

**Verification gap:** live browser screenshots were attempted
(`npm run dev` + Playwright) but blocked in this sandbox — Turbopack's
Google Fonts loader can't reach `fonts.gstatic.com` from the dev server
process even though plain `curl` from the same shell can. This is a sandbox
network limitation unrelated to the change (`app/layout.tsx`'s font loading
is untouched) and would not reproduce in a normal dev environment. The two
credentialed E2E specs that exercise the shell (`tests/e2e/planner-ia.spec.ts`,
plus dashboard-heading assertions in `tests/e2e/recurring.spec.ts` and
`tests/e2e/golden-path.spec.ts`) were updated to match the new structure but
could not be run here either (no live Supabase credentials — they auto-skip
rather than fail). Whoever picks this up next should do a real browser pass
(light + dark, a few breakpoints, sidebar collapsed + expanded, the account
menu open) and run those E2E specs before trusting the visual and
interactive result on faith — the automated gate proves the code is
correct, not that it looks or behaves right.

## START HERE: every phase flag is now ON by default (2026-07-31)

All eight gating migrations were verified applied to the live project
(tables and the columns — `sync_jobs.job_type`, `transactions.manual_account_id`
/`source`, the new `profiles` columns — were each queried directly), so every
flag in `FEATURE_FLAG_DEFAULTS` now defaults to `true`. Before this,
`/reports`, `/investments`, `/advice`, and `/forecasting` returned 404 and the
Settings Profile/Display/Tags sections were dark, which is why the app felt
half-built. All ten newly-reachable surfaces were loaded and confirmed to
render a real `<h1>` with no error boundary.

Turning `dashboardWidgets` on made the widget grid the default landing view and
immediately exposed a real bug: `DashboardWidgetGrid`'s items had no `min-w-0`,
so a wide widget stretched its grid track and took the whole dashboard into
horizontal overflow on a phone (457px content in a 390px viewport). Fixed.

Other fixes in the same pass, all verified in a browser rather than by reading
code:

- **Privacy blur covered ~21% of amounts.** `[data-privacy="blur"]` keyed on
  `.metric-value` alone (44 usages against 207 currency renders), so
  `/transactions` blurred **nothing** — 132 legible amounts with the toggle
  reporting them hidden. Now three hooks (`.metric-value`, `.money`,
  `[data-money]`) plus a `<Money>` component; 533 money nodes across 17 routes
  verified covered, and `tests/unit/privacy-blur.test.ts` pins the selector.
- **Plaid Link booted on every page view.** `ConnectBankButton` minted a link
  token on mount, so a plain `/dashboard` load spent a Plaid API call plus
  `link/workflow/start` and `link/heartbeat` against `production.plaid.com`
  for users who never clicked Connect. Both it and `ReconnectBankButton` (one
  per broken bank) now mint on click. Page views make zero Plaid calls.
- **`/accounts` mounted two `ConnectBankButton`s** in its empty state (header +
  empty-state action), producing two Plaid Link iframes on one page — the
  configuration Plaid warns is unsupported.
- **Three of five `PriorityRail` chips were inert**, and the dead ones were the
  urgent ones (low balance, stale data). Every signal now carries an `href`.
- Notifications used a `Mail` envelope icon in a component named
  `NotificationsBell`; there was no `Bell` in the icon registry.

## Phases 9A–13 are implemented — the fourteen-phase program is complete

All six remaining phases (9A Investments, 9B Investment performance, 10
Forecasting, 11 Advice, 12 Transactions parity, 13 Settings IA) were
implemented in one continuous session, each on its own branch stacked on the
last, on top of `feat/dashboard-widgets` (Phase 8):
`feat/investments` (914525b) → `feat/investment-performance` (5c4f230) →
`feat/forecasting` (77eb98d) → `feat/advice` (c0ee5f6) →
`feat/transactions-parity` (1c6f469) → `feat/settings-ia` (bdd4380). **No
phases remain** — `docs/superpowers/plans/2026-07-29-monarch-parity.md` has
every checkbox ticked and an implementation-notes subsection per phase.

Gates on the full stack: `npm run build` PASS, `npm run lint` PASS,
`npx tsc --noEmit` PASS, `npm run test:unit` PASS (**175 files / 1669 tests**).

**The six flags — all default ON as of 2026-07-31, all independent.** The
table records which migration each one needed; every one is applied. Re-gate by
changing the default in `lib/feature-flags.ts`, never by editing the page.

| Flag | Migration | What it gated |
| --- | --- | --- |
| `investmentsPage` | `20260730210000_investments.sql` + `20260730220000_investment_transactions.sql` | New page + cron read/write new tables (9A and 9B share one flag — one feature surface, two migrations) |
| `forecastingPage` | none | Review gate only |
| `advicePage` | `20260730230000_advice.sql` | New page reads new tables |
| `transactionsParity` | `20260730240000_manual_transactions_receipts.sql` | Gates an **already-live** page — with it off, `/transactions` runs the exact pre-Phase-12 query |
| `settingsIa` | `20260730250000_profile_and_tags.sql` | Also an already-live page — only Profile/Display/Tags (the sections reading new schema) redirect to Institutions when off |

**Already released** (2026-07-31): the migrations are applied and the defaults
are flipped. `FUNDFLOW_FEATURE_FLAGS` still works as a per-deployment additive
override, but nothing needs it now. The flags don't depend on each other —
`transactionsParity` and `settingsIa` are unrelated schema surfaces despite
shipping in the same session.

**Historical scope cut, closed 2026-08-09:** Phase 12 originally shipped only the `receipts` table and private Storage bucket.
The latest delivery adds the upload, signed-view, matching, ignore, restore, delete, and cross-user isolation flows.
The existing ephemeral AI receipt scan in Settings remains available separately.

**Two real bugs found and fixed before they shipped, not after:**

1. `sync_jobs` had no way to distinguish an investments-only sync from a
   transactions sync. Four surfaces (`lib/dashboard.ts`, `budget-data.ts`,
   `cash-flow-data.ts`, `recurring-data.ts`) read the newest `done` job as
   "the bank connection is healthy" — an investments success would have
   satisfied that check and masked an actually-failed transaction sync.
   Fixed with a `job_type` column in the Phase 9A migration, before
   investment sync could write a single row.
2. The daily cron's integrity check (`lib/integrity.ts`) would have flagged
   every manual transaction (Phase 12) as an `orphan-transaction` — a null
   `account_id` never matches a real account id. Fixed by excluding
   null-`account_id` rows from that check: a manual transaction can never
   actually dangle, since deleting its manual account cascades the
   transaction with it.

**Why the canonical projection absorbed Phase 12 with almost no blast
radius:** `RawFinanceTransaction.accountId`/`manualAccountId` and the
`source`-from-prefix derivation in `lib/finance-domain.ts` were already typed
and built this way back in Phase 0, anticipating manual transactions before
they existed. Widening `transactions.account_id` to nullable and adding
`manual_account_id`/`source` broke nothing in the 1600+ existing tests — the
only real fixes needed were in code that queried `transactions` *outside*
the projection (the integrity check above, and two import routes that needed
to set `source: 'import'` explicitly since the column default is `'plaid'`).

**What a reviewer should do next:**

1. Read the Implementation notes subsection for each phase in the parity
   plan (search for "implementation notes" — one per phase, right after that
   phase's E2E check) for the full deviation list; the summary above only
   hits the highlights.
2. Apply the five migrations in order on a staging project; run the
   verification SQL comments at the bottom of each migration file.
3. Flip one flag at a time in staging, exercise the corresponding page, then
   move to the next.
4. Decide on the receipts-upload follow-up (schema is ready, UI is not) as
   its own piece of work.

Historical note: browser E2E had not run when these six phases first landed.
The latest delivery section records the completed acceptance coverage.

## START HERE: Phase 8 Dashboard widgets is implemented (flag-gated)

Phase 8 is implemented on `feat/dashboard-widgets`, stacked on `feat/goals-v2`
(Phase 7) which stacks on `feat/reports-sankey` (Phase 6). The stack has
`origin/main` merged in at `520bf60`. **Phases 9A-13 remain.**

Gates: `npm run build` PASS, `npm run lint` PASS, `npx tsc --noEmit` PASS,
`npm run test:unit` PASS (**1429 tests**).

**What shipped**

- **`lib/dashboard-widgets.ts`** — the widget registry and a *total*
  `normalizeWidgetPrefs`: `dashboard_prefs` is free-form JSON written by the
  browser, so it takes `unknown` and always returns a usable layout. A widget
  missing from a stored order is appended, so a future widget is not hidden
  from everyone who ever saved a layout.
- **`computeCumulativeSpendByDay`** in `lib/dashboard.ts` — spend this month
  against last, aligned by day. Two nulls are load-bearing: a day after today is
  `null` (a zero would draw the line along the floor and read as "spent nothing
  today"), and a day past a shorter previous month's end is `null` (carrying it
  forward would claim a spending pause that never happened). The chart's table
  twin forward-fills; the plotted line stops.
- **Seven widgets** over data the page already loaded, each with distinct
  empty / stale / error states via `WidgetShell` — collapsing "nothing yet" into
  "failed to load" is how a broken query starts looking like an empty account.
- **`CustomizeDrawer`** — show/hide plus up/down reordering with buttons rather
  than drag-and-drop (unusable by keyboard, awkward on touch), Restore
  defaults, and an optimistic save that rolls back on failure. It read-merge-
  writes `dashboard_prefs` so it cannot clobber `sidebarCollapsed` or the
  hidden-account ids that share the column.
- **Reconciliation tests** (`tests/unit/dashboard-reconciliation.test.ts`) tying
  the dashboard endpoint, Budget actual, Cash Flow expenses, the Reports
  filter, and `financeTotals` to the same monthly figure — including the refund
  pair, card payment, pending, and split cases that usually break it.

**To release:** set `FUNDFLOW_FEATURE_FLAGS=dashboardWidgets`. **No migration**
— unlike Phases 6 and 7 this has no database prerequisite. It gates a behaviour
change: the grid becomes the dashboard's landing view. Monitor, Plan, and
Wealth stay in the toolbar and every `?view=` bookmark resolves as before.

**One judgement call to review:** `tests/unit/dashboard-ui.test.ts` capped
`app/dashboard/page.tsx` at 240 lines to keep it an orchestrator. Phase 8 added
a fourth view and the page is now 256, so the cap moved to 260 — but only after
extracting `OverviewView` (which owns the grid's query) and `DashboardViewTabs`,
so the page delegates strictly more than it did before. The test also now
asserts the page contains no loader. If it ever needs raising again, extract.

Not yet run: the browser half of the E2E check (hide a widget, reorder, reload,
confirm persistence).

## Phase 7 Goals is implemented (flag-gated)

Phase 7 (Goals revamp) is implemented on `feat/goals-v2`, which **stacks on
`feat/reports-sankey`** (Phase 6) rather than branching from `main` — Phase 6 is
not merged yet, and stacking is the precedent this repo already set with
`feat/cash-flow-page` on `feat/accounts-page`. Phase 7 itself depends only on
Phase 4, which is on `main`. **Phases 8–13 remain.**

Gates: `npm run build` PASS, `npm run lint` PASS, `npx tsc --noEmit` PASS,
`npm run test:unit` PASS (**152 files / 1317 tests**; Phase 7 adds 3 files and
104 tests on top of Phase 6's 149/1213).

**What shipped**

- **`lib/goals-v2.ts`** — `computeFundedGoals` merges three progress sources:
  hand-typed `saved_amount`, live account allocations (capped at what the
  account actually holds), and a dated signed event ledger. **Pay-down goals use
  the balance delta alone**, because a payment both moves the balance and may
  have been recorded as an event, so adding the ledger would count it twice.
  Also the badge matrix, `validateAllocation`, and `goalContributionsForMonth`.
- **`supabase/migrations/20260730200000_goals_v2.sql`** — new goal columns,
  `goal_accounts`, `goal_progress_events`, `transaction_annotations.goal_id`, and
  the `set_goal_allocation` function that holds a row lock while it checks the
  cross-row allocation rules.
- **Wizard and cards** — four steps (Select → Targets → Contribution → Review)
  over eight original SVG illustrations in `public/goals/`, image cards with
  progress bars and badges, a standalone "Allocate funds" panel, and a Pay down
  tab listing unlinked liability accounts.
- **Routes** — `/api/goals/accounts` (allocations through the function, plus
  one-time pay-down baseline capture) and `/api/goals/events` (the contribution
  ledger). `/api/transactions/annotate` now takes `goal_id` and, for a
  `spending_reduces` goal, writes a negative transaction event idempotently.
- **Budget feed** — planned contributions from `goals.monthly_contribution`,
  actual from `goal_progress_events` only.

**Two security details worth knowing**

1. The plan's RLS sketch had an ownership hole. `with check (user_id =
   auth.uid())` alone is not enough, because foreign-key checks bypass RLS: a
   user could insert a `goal_accounts` row owned by themselves but pointing at
   another user's `goal_id`, and any read selecting allocations by `goal_id`
   would attribute it to the victim's goal. The migration's write policies also
   assert the goal and account belong to the caller.
2. `image_slug` is a database string that becomes a URL, so `goalImageFor`
   resolves known slugs only rather than interpolating it into a path.

**Before this is user-visible**

1. **Apply `supabase/migrations/20260730200000_goals_v2.sql`.**
2. **Set `FUNDFLOW_FEATURE_FLAGS=goalsV2`** (or flip the default in
   `lib/feature-flags.ts`). Note this flag is *not* gating a new page the way
   `reportsPage` is: `/goals` and `/budget` are already released, and both begin
   reading `goal_accounts` / `goal_progress_events` the moment it turns on.
   Leaving it off keeps a migration-less deployment working exactly as before.

Historical Phase 7 note: browser acceptance was still open when the phase first landed.
Goal linking from the Phase 12 manual-add modal was also absent at that point.

## Phase 6 Reports is implemented (flag-gated)

Phase 6 (Reports page with Sankey) is implemented on `feat/reports-sankey`,
branched from `main` at `b9e2019`. Phases 0–5 were already merged; **Phases 7–13
remain**. Gates: `npm run build` PASS, `npm run lint` PASS, `npx tsc --noEmit`
PASS, `npm run test:unit` PASS (**149 files / 1213 tests**, up from 144/993 —
133 new tests, no new failures).

**What shipped**

- **`lib/sankey.ts`** — pure layout (`layoutSankey`) plus `foldSankeyOverflow`.
  One value→pixel scale is shared across every column, or a ribbon leaving a
  node stops matching the one arriving and the diagram silently stops conserving
  value. Node heights floor to 2px so a tiny real category stays visible; ribbon
  thickness deliberately never floors, or ribbons would sum to more than their
  node.
- **`lib/reports.ts`** — `buildCashFlowSankeyData` (income categories → hub →
  expense groups → categories, with a terminal "Net Income" on a surplus and an
  "Unfunded Spending" source on a deficit, so the graph balances instead of
  drawing a negative ribbon; transfers are excluded by `flow`, so neither half of
  a linked refund nor a credit-card payment can double-count),
  `summarizeTransactions`, and the **versioned saved-report filter schema** —
  a strict `parseReportFilters` for stored payloads and a forgiving
  `reportFiltersFromSearchParams` for hand-edited URLs.
- **`components/charts/SankeyChart.tsx`** — server-rendered SVG, no client JS
  (so the nonce CSP needs no exception), colour by *stage* rather than category
  (one hue per category would blow past the six-slot palette), full-detail table
  twin, and table-first below 768px.
- **`app/reports/page.tsx`** + `components/reports/*` — date range, Cash
  Flow/Spending/Income tabs, Breakdown/Trends, Mine/Household scope, pending
  toggle, removable filter chips, a five-figure summary, paginated rows, and the
  CSV / weekly-PDF / Year-in-Money actions. Every control is a `<Link>` or a
  plain GET form, so all report state is URL state and nothing needs syncing.
- **`app/api/reports/saved/route.ts`** — save / rename / update / delete, with
  the filter payload re-validated server-side, a 50-report cap, `23505` mapped to
  a 409, and audit writes.
- **`app/api/export/report-csv/route.ts`** — the exact filtered row set through
  the privacy-safe contract (date/merchant/amount/category only),
  formula-neutralized via `toCsv`, bounded, recorded in `data_exports`.
- `saved_reports` added to takeout and the monthly encrypted backup; deletion
  cascades through the `auth.users` FK, so `app/api/account/route.ts` needed no
  edit.

**Two things to do before this is user-visible**

1. **Apply `supabase/migrations/20260730190000_saved_reports.sql`** to the live
   project (`zrxbmmtqqhlwtrinocww`). There is no migration runner in CI.
2. **Flip `reportsPage` to `true`** in `lib/feature-flags.ts`, or set
   `FUNDFLOW_FEATURE_FLAGS=reportsPage`. It defaults to **OFF** on purpose: the
   page reads `saved_reports`, and reading a table that does not exist yet is a
   500, not a graceful degrade. In that same change, drop the "Year in Money"
   entry from `NAV_ITEMS` — the Reports page already links to `/wrapped`, and
   removing it earlier would strand that page behind the command palette.
   `tests/e2e/reports.spec.ts` skips itself until the flag is on.

**Also in this branch (pre-existing repairs, unrelated to Phase 6):** two type
errors that were already failing `npx tsc --noEmit` on `main` —
`tests/unit/dashboard-extended.test.ts` passed an invalid `scope: "personal"`,
and `tests/unit/api-plaid-direct-routes.test.ts` passed a delete-chain stub
where `clientStub` expects a per-table seeds map. Both fixed, so the typecheck
gate is honestly green rather than green-except-two.

**Local test note:** 12 test files import route handlers that transitively load
`lib/env.ts` and fail without `.env.local` — environmental, not a code failure.
Supply dummy values inline and all 149 files pass:

```bash
NEXT_PUBLIC_SUPABASE_URL="https://example.supabase.co" \
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="sb_publishable_test" \
SUPABASE_SECRET_KEY="sb_secret_test" \
PLAID_TOKEN_ENC_KEY="$(node -e 'process.stdout.write(Buffer.alloc(32,7).toString("base64"))')" \
CRON_SECRET="test-cron-secret" npm run test:unit
```

## Phase 5 Recurring is implemented

Phase 5 is implemented on `feat/recurring-page` (Tasks 1-15 of its test-first plan).
It delivers the Recurring page: the occurrence review workflow, manual recurring items, a sidebar unreviewed-stream badge, and Mine/Household scope.

The released `/recurring` server page now provides:

- A month-scoped occurrence list built from Plaid's `predicted_next_date` anchor and `transaction_ids` (never a merchant-name heuristic for Plaid-sourced completion; heuristic matching is reserved for manual items only).
- Upcoming, Complete, and All tabs; the All tab is the single place to Confirm, dismiss ("Not recurring"), restore, and correct the expected amount of a stream.
- A review banner and a sidebar nav badge, both counting `MATURE`, active, undismissed, unreviewed streams, and both clearing together once every stream is reviewed.
- Manual recurring items (income and expense): a "Manual items" section in the All tab (add/enable-toggle/delete, backed by `/api/recurring/manual`'s CRUD route), folded into the same monthly occurrence expansion as Plaid streams.
- A "This month" progress panel (income, expenses, and — only when nonzero — credit cards), and Mine/Household scope via the shared `parseFinancialScope`.
- A stale-data banner driven by the newest successful `sync_jobs` row, matching the existing dashboard convention.

The live Supabase project `zrxbmmtqqhlwtrinocww` contains these Phase 5 migrations:

- `20260730020000_recurring_review.sql`, recorded live as version `20260730160407`.
  Adds `reviewed_at`, `dismissed_at`, `account_id`, `first_date`, `last_date`, `predicted_next_date`, and `user_amount` to `recurring_streams`, and creates the `recurring_stream_transactions` join table (RLS: owner-select and shared-stream-select policies, no client insert/update/delete — only the service client's sync writes it).
- `20260730020500_recurring_shared_authorization.sql`, recorded live as version `20260730161711`.
  Task 1b found and fixed a pre-existing household-visibility defect: `recurring_streams_select_household` and `rst_select_shared_stream` both joined `plaid_items` directly inside their own `USING` clause, and household members have no `SELECT` policy on `plaid_items` (it holds encrypted access tokens).
  That silently hid every shared recurring stream from every household member since the July 23 sharing migration, independent of this phase.
  Fixed the same way Phase 2/3 fixed the identical class of bug for accounts and transactions: a `private`-schema `SECURITY DEFINER` helper (`can_read_shared_stream`) plus one consolidated `SELECT` policy per table.

Task 15's E2E acceptance run found and fixed a second, distinct RLS defect, this one in `recurring_streams` itself rather than its sharing policy.
`recurring_streams` has had RLS enabled since `0001_init.sql`, but no migration ever added an `UPDATE` policy — the only policy on the table was the `SELECT` one.
The review workflow's `PATCH /api/recurring` route (Confirm, Dismiss, Restore, correct amount) runs through the RLS-bound cookie client, not the service client; with no `UPDATE` policy, Postgres's implicit `USING` clause for a command with zero defined policies matches no rows, not even the row's true owner, and PostgREST reports no error.
The route's `.select("id").maybeSingle()` then sees `data: null` and returns 404 "Recurring stream not found" for every legitimate request.
This silently broke the entire review workflow — every Confirm, Dismiss, Restore, and amount correction — for every user, not a test-authoring artifact.
Reproduced directly against the live project before any fix: an authenticated owner's own-row update returned `{ data: null, error: null }`, and a service-client re-read confirmed the row was unchanged.

The first attempt at a fix (an owner-scoped `UPDATE` RLS policy) was itself a security regression, caught by review: it made `recurring_streams` — a Plaid-synced table — directly writable from the browser across every column (`average_amount`, `frequency`, `status`, `is_active`, `merchant_name`, `predicted_next_date`, `stream_id`, `account_id`, ...), not just the three the route intends to expose, entirely bypassing `requireUser()`, rate limiting, and `writeAudit()`.
That violated CLAUDE.md's explicit "do not regress" invariant that client writes are allowed only on `budgets` and the `profiles` preference columns.
That policy was dropped again by `supabase/migrations/20260730180000_recurring_streams_revert_client_write.sql`.

The correct fix follows the pattern already used everywhere else in this app for Plaid-synced-table writes (`plaid-service.ts`, `sync.ts`, and explicitly `app/api/plaid/disconnect/route.ts`): `requireUser()` still establishes identity, but `app/api/recurring/route.ts`'s `PATCH` handler now performs the actual write through `createServiceClient()`, keeping the existing `.eq("id", streamId).eq("user_id", user.id)` scope as the sole ownership check, since the service client bypasses RLS entirely.
`recurring_streams` is back to exactly one live policy, `recurring_streams_select_visible` (`SELECT` only) — verified directly against the live project after applying the revert migration.
Repro after this corrected fix: a cookie-client update again returns `{ data: null, error: null }` and leaves the row unchanged (RLS correctly blocks it, as it always should for this table), while a service-client update (the shape the route now uses) returns `{ data: { id: ... }, error: null }` with `reviewed_at` set.
`tests/unit/recurring-route.test.ts` was updated to mock `createServiceClient` instead of asserting against the `requireUser()`-provided cookie client, and gained a regression test that fails loudly (via a cookie-client stub that throws on any query) if the route ever again relies on a cookie-client write succeeding.

Both migrations were applied directly to the live project via `supabase db query --linked -f <file>` (the Supabase MCP tools require an interactive auth flow unavailable in this session, and `supabase db push` refused over a pre-existing local/remote migration-history mismatch that predates this phase).
Their DDL is live and verified; neither is registered in `supabase_migrations.schema_migrations` (`supabase migration repair` was blocked by this session's permission classifier) — a bookkeeping gap for a human to reconcile with `supabase migration repair --status applied 20260730170000` and `... 20260730180000`, not a functional one.

Task 15 also fixed two smaller, pre-existing defects noticed while running the full gate, per this repo's fix-it-when-you-see-it standard:

- `tests/integration/recurring.test.ts`'s mock `transactionsRecurringGet` response was missing `transaction_ids` on both mock streams, a field Task 5's occurrence-persistence code (`lib/recurring.ts`) reads unconditionally and the real Plaid SDK types mark as required (non-optional).
  The test crashed with `Cannot read properties of undefined (reading 'map')`; fixed by adding `transaction_ids: []` to both fixtures.
- `tests/unit/recurring-route.test.ts` and `tests/unit/recurring-manual-route.test.ts` each had an unused `NextResponse` import left over from earlier tasks, flagged by `npm run lint`; both removed.

Live verification after the fixes:

- The live repro script's before/after update results are recorded above.
- `npm run test:e2e -- tests/e2e/recurring.spec.ts` passed 1/1 (a single comprehensive journey, matching `budget.spec.ts`'s shape) on three consecutive runs against the live FundFlow Supabase project: sidebar reachability and badge count, review banner visible for the seeded `MATURE`/`reviewed_at: null` stream, Confirm in the All tab clearing both the banner and the badge (proving the RLS fix works end-to-end, not just in isolation), editing the expected amount in All changing the Upcoming tab's displayed total, month navigation preserving a `scope=<householdId>` query parameter, and no horizontal overflow at 390x844.
- Zero unexpected console errors/warnings, zero page errors, zero failed same-origin requests during that run.

The final local gate, all real command output, all green:

- `npm run lint`: pass, zero warnings (after removing the two unused `NextResponse` imports above).
- `npx tsc --noEmit`: pass.
- `npm test`: pass, 158 files / 1117 tests (includes `tests/integration/*` against the live Supabase project; `npm run test:unit` alone is 142 files / 1026 tests).
- `npm run build`: pass, production route manifest includes `/recurring`, `/api/recurring`, and `/api/recurring/manual`.
- `npm run test:e2e -- tests/e2e/recurring.spec.ts`: pass, 1/1, credentialed against the live FundFlow Supabase project, stable across three consecutive runs.
- `git diff --check`: pass.

Next: Phase 6, 9A, or 11 (independent of each other) per the master plan's dependency graph (`docs/superpowers/plans/2026-07-29-monarch-parity.md`'s Part 1).
Phase 6 (Reports/Sankey) depends on Phase 3 (Cash Flow), already done.
Phase 9A (Investment holdings/allocation) and Phase 11 (Advice) depend only on Phase 1, also done.
All three are unblocked; none has a dependency on Phase 5.

## START HERE: Phase 1 Navigation and Information Architecture is implemented

Phase 1 is implemented on `feat/planner-ia` (Tasks 1-8 of its test-first plan) and delivers a nav-model-driven architecture for the app shell, gating future pages as they ship.

The navigation system now provides:

- A centralized `NAV_ITEMS` definition that drives the sidebar, command palette, and app shell active-view tracking.
- Responsive top-bar utility actions: search, notifications, and settings (hidden below the `sm` breakpoint at 640px per Tailwind, visible at `sm` and above; notifications and settings remain reachable via the mobile pill nav, search is keyboard-only via Cmd+K/Ctrl+K on mobile, known gap not addressed in this phase).
- Sidebar collapse state persisted through `profiles.dashboard_prefs` with a toggle button and aria-pressed state.
- Gated Ask-AI lower-rail link that only renders when `isAskAiAvailable` returns true.
- Feature-flag-driven navigation entries so unreleased pages remain hidden from both sidebar and command palette.
- Dashboard subviews (monitor, plan, wealth) remain internal to the `/dashboard` route and are not exposed as top-level nav entries.

The implementation honors the existing `TRANSFER_GROUPS` exclusion set and the five Phase 0 finance-domain invariants carried forward from prior work.

The "move Year in Money under Reports" step from the master plan is intentionally deferred to Phase 6 because the Reports page does not yet exist. Phase 6's implementation plan must explicitly include a link-and-remove step to move `wrapped` from the `manage` category into the `reports` category once that page ships.

The sm-breakpoint utility icon scope decision (Task 4) is defined in the responsive Tailwind classes and covered by source-level unit tests.

Task 8 added `tests/e2e/planner-ia.spec.ts`, a credentialed live-Supabase Playwright suite (throwaway user created via the admin client, same pattern as `accounts.spec.ts`/`cash-flow.spec.ts`). It actually ran against a real Chromium browser and the local dev server, not just against source: `npm run test:e2e -- tests/e2e/planner-ia.spec.ts` passed 6/6 on two consecutive runs. Coverage: only-implemented-destinations-in-sidebar (no Reports/Recurring links), command palette open via top-bar button and Cmd+K plus Escape-to-close, notifications/settings top-bar links navigate, sidebar collapse persists across reload (writes to `profiles.dashboard_prefs.sidebarCollapsed` and re-seeds server-side), mobile pill nav at 390px with no horizontal overflow in both light and dark themes, and a signed-out request to a private path (`/budget`) redirecting to `/login`.

The final local gate, all real command output, all green:

- `npm run lint`: pass, zero warnings.
- `npx tsc --noEmit`: pass.
- `npm test`: pass, 152 files / 1070 tests (includes `tests/integration/*` against the live Supabase project; `npm run test:unit` alone is 137 files / 983 tests, unchanged from Task 7 since Task 8 added only an E2E spec).
- `npm run build`: pass, production route manifest includes all Phase 1 destinations.
- `npm run test:e2e -- tests/e2e/planner-ia.spec.ts`: pass, 6/6, credentialed against the live FundFlow Supabase project.
- `git diff --check`: pass.

Next: Phase 5, 6, or 9A (independent of each other) per the master plan's dependency graph (`docs/superpowers/plans/2026-07-29-monarch-parity.md`): all three depend only on Phase 1, which is now done, and Phase 6's other prerequisite (Phase 3, Cash Flow) already shipped on `main`.

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
