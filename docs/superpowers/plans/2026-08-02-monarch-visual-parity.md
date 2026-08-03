# Monarch Visual Parity — Implementation Plan

Date: 2026-08-02
Design: `docs/superpowers/specs/2026-08-02-monarch-visual-parity-design.md`
Reference screenshots: `img/Monarch Design/`

## How to run this plan

- One branch per phase (`feat/visual-parity-v0` … `v11`), stacked or independent as noted; each phase ends with the full gate (`npm run build`, `npm run lint`, `npx tsc --noEmit`, `npm run test:unit`) plus a **side-by-side screenshot check** against the named reference screenshot(s) at 1440×900 in light *and* dark.
- Phases V0–V2 are strictly ordered (everything depends on them). V3–V10 are independent of each other and can ship in any order; each is a page vertical.
- Never regress: privacy-blur selectors (`.metric-value`/`.money`/`[data-money]`), chart table twins, URL-state controls, 44px targets, the 7-slot viz palette, server-rendered charts, RLS/service-client rules. Purely visual phases must not touch `lib/` financial logic.
- Where a component is listed as "restyle," behavior and API calls stay identical — snapshot the DOM contract in existing unit tests before moving markup.

## Phase V0 — Token retheme (the 60% phase)

Everything inherits from this. Reference: any light+dark screenshot pair.

- [ ] **Sample exact Monarch values** from the screenshots with a small script (read PNG pixels at documented coordinates for: page bg, card bg, card border, nav-active pill, orange CTA, green/red amounts, dark equivalents). Record the sampled hex table in the design doc. Do not guess.
- [ ] Rewrite the four token blocks in `app/globals.css`: warm neutrals, orange `--accent`, new `--pill` neutral-selection token, softened shadows, `--radius-pill`. Collapse the light/dark duplication if feasible (CSS `light-dark()` or a single source block) so tokens live in one place per mode.
- [ ] Type roles: add `page-title`/`card-title`; switch `.metric-value` to Geist Sans + `tabular-nums` (class name unchanged — privacy tests key on it); leave `.eyebrow`/`.display` defined but slated for removal as pages migrate.
- [ ] Restyle primitives in place: `Button` (pill radius, orange primary, white-pill secondary), `Badge` (tokens instead of raw Tailwind colors), `Panel` (softer border/shadow), `EmptyState`, `Tabs`, `Input/Select` focus color.
- [ ] Unify the three modal recipes (backdrop `bg-black/50`, `rounded-card`, one shadow) in CommandPalette, TransactionEditor, AddTransactionModal, SeedBudgetButton.
- [ ] Fix internal inconsistencies that are pure CSS: Accounts scope-pill active state, Badge token drift, TransactionEditor `rounded-2xl`, dark Sankey surface `#202120` → align with the new warm dark panel (which lands closer to it than `#111827` did — verify visually).
- [ ] Gate: full test suite + a screenshot sweep of all 15 routes confirming nothing is illegible in either mode.

## Phase V1 — Shell restructure

Reference: left edge + top of every screenshot; dark 9.11.06.

- [ ] Rebuild `AppShell`/`SidebarShell`: full-height sidebar (logo + utility icon strip at top; nav; pinned bottom block), no global TopBar.
- [ ] Sidebar bottom block: gated Ask link, Help & Support, user block (avatar from Settings profile with initials fallback + display name + chevron menu holding Settings / PrivacyToggle / ThemeToggle / Sign out).
- [ ] Nav item restyle: neutral `--pill` active state, orange rounded-square Recurring badge.
- [ ] New `PageHeader` component (title left, actions right; Dashboard greeting variant using display name + time of day).
- [ ] Migrate every page's header to `PageHeader`; delete eyebrow/display/description headers (13 pages incl. the three `text-2xl` outliers). Move each page's action buttons into it.
- [ ] Restyle `MobileNavigation` + command palette with new tokens; keep collapse persistence (`dashboard_prefs.sidebarCollapsed`) and all E2E-covered behaviors (`tests/e2e/planner-ia.spec.ts` will need selector updates — update the spec, not the behavior).
- [ ] Gate + screenshot: sidebar vs reference at both themes, collapsed + expanded.

## Phase V2 — Shared component kit

- [ ] `SegmentedControl` (link-based) and adopt it where segments already exist: Totals/Percent, Month/Year/Decade, Breakdown/Trends, Debit/Credit, Monthly/Quarterly/Yearly. Delete the three divergent chip recipes (MonthChips/account chips/ScopeChips) in favor of it or pill-chips as fits.
- [ ] `DropdownButton` (client popover; Escape/outside-click close; Links inside). Used from V3 on.
- [ ] `ProgressBar` shared component; swap the four ad-hoc bars.
- [ ] `MerchantAvatar`/`InstitutionAvatar` with deterministic initial-disc fallback.
- [ ] `CategoryChip` + `lib/category-emoji.ts` (unit-test the map covers every Plaid PFC primary group + Uncategorized).
- [ ] `lib/format-date.ts` (`Jul 28, 2026`, "9 hours ago", "(22 days ago)"); unit tests; then a sweep replacing user-facing ISO dates (ledger, day headers, RecentActivity, freshness lines).
- [ ] `RightRail` layout helper.
- [ ] **Migration (optional but recommended): institution logos** — `plaid_items.institution_logo` captured at link/reconnect via `institutionsGetById`; service-client write; avatars consume it. Ship the column + capture first (migration-first rule), UI reads later; everything falls back to initials without it.
- [ ] Gate: unit tests for each new component.

## Phases V3–V10 — Page verticals (independent, any order)

### V3 Dashboard — ref 9.00.42 / 9.01.02 / 9.11.06

- [ ] Greeting header + Customize pill; restyle CustomizeDrawer.
- [ ] Two-column asymmetric grid (`lib/dashboard-widgets.ts` column assignment; `normalizeWidgetPrefs` still total).
- [ ] Widget header pattern (bold title + inline value + DropdownButton) in `WidgetShell`.
- [ ] Rework widget bodies per design §5.1 (Budget group bars; orange cumulative spending chart; net-worth chart+delta; transactions rows with avatars/chips; recurring empty+rows; goals; investments).
- [ ] Fold toolbar/PriorityRail/ScopeChips into the new language; restyle Monitor/Plan/Wealth with V0–V2 primitives (no structural work).

### V4 Accounts — ref 9.01.34 / 9.01.48 / 9.02.02

- [ ] Header actions (Filters pill → collapsible panel around existing GET form; Refresh all; orange Add account).
- [ ] Net-worth hero card with big figure + change + Performance/1-month dropdowns + area chart.
- [ ] Collapsible group cards with avatar rows, dual sparklines, humanized freshness.
- [ ] Right-rail Summary (Totals/Percent, stacked asset/liability bars + dotted legends, Download CSV link).
- [ ] Relocate AccountPreferences behind Filters.

### V5 Transactions — ref 9.02.37 (+9.04.32 rows)

- [ ] Full width; header pills (Search/Date/Filters + orange Add).
- [ ] Table toolbar (Edit multiple / Sort ▾ / Columns ▾ wrapping existing mechanisms; ColumnsMenu keeps URL params underneath).
- [ ] Row/day-header anatomy per design §5.3 (avatars, chips, humanized dates, green-credits-only amounts, chevron → TransactionEditor).
- [ ] Restyle Add-transaction modal + MobileLedgerList.

### V6 Budget — ref 9.04.48 → 9.05.42 (largest vertical)

- [ ] Header: month + arrows + Today + Month/Year/Decade + Settings.
- [ ] Planned/Actual/Remaining column layout with sticky section bands, group blocks, quiet inline planned inputs (auto-save on blur, keep optimistic rollback), per-row progress bars, negative-remaining chips.
- [ ] Row `⋯` menu for group/rollover/order controls (same PUT API).
- [ ] Totals rows + Left-to-Budget footer bar; Contributions (Save up / Pay down) section.
- [ ] Right rail: Left-to-budget tinted card + Summary/Income/Expenses tabs + group bars.
- [ ] Restyle seed-proposal modal as "Create a budget" card.
- [ ] Reconciliation tests must stay green (`dashboard-reconciliation.test.ts`).

### V7 Recurring — ref 9.05.57 / 9.06.09

- [ ] Header tabs (Monthly | All recurring) + Filters + orange Manage recurring (houses manual-item CRUD + stream review actions).
- [ ] Orange review banner with functioning "Review now".
- [ ] Month card with List | Calendar control (Calendar grid deferred to V11 if needed — ship List first).
- [ ] 3-column summary strip; Upcoming/Complete tables per design §5.6 with avatars, category chips, relative-date annotations, `⋯` menus, total bands.
- [ ] Fix the loading skeleton to match the real layout.

### V8 Goals — ref 9.06.31 → 9.08.39

- [ ] **Delete legacy `GoalsManager` + flat add form**; migrate its edit/contribute/visibility controls into card menus. (Behavioral consolidation — flag in PR description.)
- [ ] Source CC0/owned photos for the 8 templates (`public/goals/`, slug whitelist unchanged; SVGs stay as fallback).
- [ ] Card restyle (photo, status chip, bar, amounts); Monarch empty state.
- [ ] Wizard → full-screen overlay with stepper pills + orange progress bar + footer Continue/Skip; Contribution step gets the right-rail goal summary with "Est. $/mo."; Congrats screen. Same state machine + APIs.

### V9 Reports — ref 9.03.50 → 9.04.32 + dark attachments

Sankey exact-match (design §5.4.1 — geometry first, then paint; every step keeps
the two invariants: one shared value→pixel scale, ribbons never floored; update
`tests/unit/` sankey tests alongside each change):

- [ ] `lib/sankey.ts`: weighted column x positions (≈ 0 / 34% / 72% / 100% of inner width, sampled from the screenshots) replacing even division.
- [ ] `lib/sankey.ts`: label-slot-driven `sankeyCanvasHeight` (~30px/node minimum in the busiest column) so every node gets a two-line label; pin Net Income to the top of the group column regardless of value; verify leaf ordering is parent-grouped.
- [ ] `SankeyChart.tsx`: two-line labels (name line + semibold ink amount line, emoji prefix from `lib/category-emoji.ts`, no emoji on hub/terminals); percent format `NN.NN%` with trailing zeros trimmed; keep halo + `.money`/`data-money` hooks.
- [ ] `SankeyChart.tsx`: hub label moves to the right of the bar, vertically centered; drop the above-bar exception and shrink `MARGIN_TOP`.
- [ ] `SankeyChart.tsx`: node width 18 → ~10, `rx` 2 → 1; `maxNodesPerColumn` 20 → 60 for the Reports usage (`foldSankeyOverflow` stays as backstop).
- [ ] Semantic hue pinning: known group names → fixed `--sankey-group-*` slots (Shopping magenta, Financial red, Travel blue, Food yellow, Housing orange, …), size-order fallback for unknown groups. Hue values themselves unchanged.
- [ ] Tokens: raise `--sankey-flow-opacity` (light ~0.38, dark ~0.55) and tune both against the reference screenshots side-by-side; confirm the dark sankey surface matches the V0 warm dark panel.
- [ ] Side-by-side screenshot check of the Sankey specifically, light + dark, against 9.03.50/9.04.04/9.04.16 and both dark attachments — this is the "exact match" acceptance gate.

Page chrome:

- [ ] Header: title-adjacent tabs, Date/Filters/Reports ▾/Save pills (SavedReportsSection becomes the Reports ▾ dropdown + save action).
- [ ] Stat tiles value-first with uppercase micro-labels.
- [ ] Breakdown|Trends SegmentedControl + "By category & group ▾" + download icon.
- [ ] Transactions section with §5.3 row anatomy + right-rail Summary card (fields from `summarizeTransactions`).

### V10 Investments + Advice + Settings — ref 9.08.59 / 9.10.46 / 9.11.22

- [ ] Investments: header (Holdings tab, Accounts ▾, orange Add Holding modal), portfolio-only performance tile + chart, Market|Allocation control, grouped holdings table with avatars and Past-3-Months column. No benchmark tiles.
- [ ] Advice: Update-profile action, Categories right rail, icon-disc recommendation rows with task-count micro-meta + Show-completed toggle; inline checklist expansion.
- [ ] Settings: two grouped nav cards (Account / Household), accent-tinted active row, Profile panel layout per screenshot.

## Phase V11 — Sweep, dark QA, stretch

- [ ] Re-skin the four no-reference pages (Cash Flow, Forecasting, Notifications, Review, Wrapped) with V0–V2 primitives; fix `/review` nav highlighting.
- [ ] Full dark-mode screenshot sweep vs dark references; contrast-check the sampled warm dark tokens.
- [ ] Stretch: Recurring calendar month-grid; institution-logo backfill for existing items (one-off script through the service client).
- [ ] Playwright visual snapshots checked in for the 10 primary routes (both themes) as the regression baseline.
- [ ] Update `docs/HANDOFF.md` + `docs/TODO.md`; note any deliberate 1% deviations discovered during build.

## Risk register

| Risk | Mitigation |
|---|---|
| E2E specs assert old markup (planner-ia, budget, recurring, accounts) | Update selectors per phase; behaviors unchanged. Three E2E failures pre-exist (TODO.md) — don't chase them into this program. |
| `.metric-value` font change breaks a visual expectation somewhere | Class name + blur selector unchanged; unit test pins the selector. |
| Widget-order prefs saved under the old flat order | `normalizeWidgetPrefs` is total; column split derives from the same flat order. |
| Dark warm palette reduces contrast below AA | Contrast-check sampled tokens before committing V0; adjust lightness, not hue. |
| Emoji category glyphs render inconsistently across platforms | Acceptable (Monarch itself uses emoji); the label always accompanies the glyph. |
| Institution-logo migration ordering | Migration-first rule: column lands and capture code ships before any reader; UI falls back to initials indefinitely. |
