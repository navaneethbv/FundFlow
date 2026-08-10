# FundFlow completed work archive

Finished todos and completed programs, moved out of `docs/TODO.md` on 2026-08-10 so that file lists only outstanding work.
Nothing here is pending.

## Completed 2026-08-09 and 2026-08-10

## Completed 2026-08-10: manifest redirect and service-worker cache policy

`/manifest.webmanifest` returned a 307 to `/login` for signed-out visitors, because the proxy matcher excluded `sw.js` but not the manifest; the browser then reported that the manifest was not valid JSON data.
`public/sw.js` precached HTML into a cache whose constant name meant the activate-time cleanup never fired, so those documents outlived every deploy and referenced `/_next` chunks that later deploys delete.
Both are fixed, with unit coverage in `tests/unit/csp.test.ts` and `tests/unit/service-worker.test.ts`.

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
