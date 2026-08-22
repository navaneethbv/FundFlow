# Monarch Visual Parity — Design

Date: 2026-08-02
Status: Draft for review
Reference: 29 screenshots in `img/Monarch Design/` (Dashboard light+dark, Accounts ×3,
Transactions + Add modal, Reports Cash-Flow Sankey light+dark ×6, Budget ×4,
Recurring ×2, Goals + 5-step wizard ×6, Investments, Advice, Settings dark).

## 1. Goal and scope

The 14-phase Monarch **feature**-parity program is complete (`docs/superpowers/archive/plans/2026-07-29-monarch-parity.md`) — every page exists and works. This design covers the remaining gap: **visual parity**. Target: a screenshot of any FundFlow page should read ≥99% like the corresponding Monarch screenshot in layout, spacing, color, typography, and component anatomy — minus the features this repo deliberately excludes (§8).

Out of scope: any data-layer change beyond what a visual needs (only two are proposed: institution logo storage and goal photos), any new financial computation, any change to the security invariants in CLAUDE.md.

## 2. The three root divergences

Everything else is a symptom of these three.

### 2.1 Theme identity: cool blue vs warm cream + orange

| Token role | FundFlow today (light) | Monarch (light, **pixel-sampled** from screenshots) |
|---|---|---|
| Page background | `#f5f7fa` cool blue-grey | `#F6F5F3` warm off-white (sampled at 3 points, 100% patch coverage, exact agreement) |
| Card | white, `rgba(16,24,40,.09)` border | `#FFFFFF` (sampled, 100% patch coverage) |
| Accent / primary CTA | `#175cd3` blue, 10px-radius buttons | `#FF6A2D` orange (sampled off the "Create budget" button fill), **fully-rounded pill** buttons |
| Nav active state | blue tint pill, blue text | neutral pill `#ECE8E6` (sampled, 100% patch coverage), dark text — accent color is NOT used for nav |
| Positive / negative | `#067647` / `#b42318` | not reliably sampleable (thin anti-aliased text); kept as an informed estimate: `#2AA36B`-ish green / `#E14A4A`-ish red |
| Amounts | Geist **Mono** (`.metric-value`) | proportional sans with tabular figures — no monospace anywhere |
| Dark mode | cool `#0b1018` / `#111827` | see caveat below — sampled `#191918` (sidebar/canvas) / `#222221` (card) |

**Sampling method:** a small `sharp`-based Node script (not checked in) extracted a 9×9 pixel patch at chosen coordinates in each PNG and took the modal (most frequent) RGB in the patch — robust against anti-aliasing at flat-fill edges. Coordinates were derived from the on-screen layout and cross-checked against a full-row pixel scan where a single point risked landing on text or an icon (see the sidebar/content boundary and inter-card gutter scans that anchored the dark values below).

**Caveat — the provided "dark" screenshots are very likely a simulated/forced dark mode, not Monarch's native dark theme.** The dark-screenshot "Update Profile" CTA sampled at `#92472A` — a muted, desaturated rust — against the light screenshot's vivid `#FF6A2D` at the *same hue angle*. That is the signature of a hue-preserving lightness-inversion filter (the kind a browser extension or OS-level "force dark" applies to un-styled-for-dark content), not a hand-tuned dark palette: no team ships a primary CTA that loses that much saturation on purpose. Consequence for this design: the sampled dark **neutrals** (`#191918` canvas, `#222221` card — confirmed via a full-width pixel scan of the dashboard screenshot, which also located the sidebar at `#191918` starting at the same tone as the inter-card gutter, with cards one step lighter at `#222221`) are trustworthy as plausible dark-mode neutrals regardless of the filter, but the **accent must stay vivid orange in our dark theme** — reusing the muted, filtered value would read as a bug, not a design choice. One more data point survives the filter theory usefully: the Settings dark screenshot's active-nav-row fill sampled at a **solid `#003849`** (dark navy-teal, ~195° hue) — a lightness-inverting filter preserves hue, so this implies Monarch's real *light* Settings page tints its active row **blue**, not orange, matching the "accent color is not used for nav" pattern already seen in the sidebar. We don't have a light sample for this specific element, so §4.1 estimates the light equivalent as a pale wash of the same hue.

### 2.2 Shell architecture: top bar vs full-height sidebar

- **FundFlow:** 64px full-width TopBar (logo, email, search, bell, gear, privacy, theme, sign-out) *above* a sidebar; page content starts with an eyebrow + 30–36px `display` H1 + description paragraph.
- **Monarch:** the sidebar runs **full height**. Its top strip holds the logo plus small icon buttons (search, bell with dot, gear, collapse). Nav below (icon + label, neutral-pill active state, orange rounded-square count badge on Recurring). Pinned to the bottom: Help & Support and the **user avatar + name + chevron menu**. The content column has its own slim header bar: **page title (~20px bold) left, actions right** (white pill secondary buttons, orange pill primary). No eyebrow, no description paragraph, anywhere.

### 2.3 List/table anatomy: text rows vs identity-rich rows

Monarch rows lead with **identity**: a circular merchant/institution logo, then bold name, then muted secondary line; categories are **emoji + label** chips; dates are humanized ("Jul 28, 2026", "9 hours ago", "(22 days ago)"); every table has real columns. FundFlow rows are text-only (no logos anywhere; the only avatar is a first-letter tile on the dashboard), categories are plain muted text, and ledger dates are raw ISO strings (`2026-07-14`).

## 3. Internal UI inconsistencies (exist regardless of Monarch)

Called out per the request — these are self-inconsistencies to fix in passing:

1. `/transactions` is `max-w-4xl` (896px) while every other page is `max-w-[1320px]`.
2. Three H1 styles: `display text-3xl sm:text-4xl` on most pages vs `text-2xl font-bold` on Advice, Forecasting, Investments.
3. Three chip recipes: MonthChips active is **solid** blue, account-filter chips active is **soft** blue, ScopeChips are borderless — same concept, three looks.
4. Modal inconsistency: backdrops at 40%/50%/60% black across CommandPalette / TransactionEditor / SeedBudgetButton; TransactionEditor uses `rounded-2xl` (16px), breaking the 12px `rounded-card` token; AddTransactionModal uses `bg-background` where others use `bg-panel`.
5. `Badge` success/danger/warning tones use raw Tailwind palette colors, not the design tokens.
6. Accounts Mine/Household pills have `aria-current` but **no visual active state** (both look identical).
7. Recurring's loading skeleton doesn't match its actual two-column layout.
8. Goals renders **two competing goal UIs** (Phase-7 `GoalCard` grid + legacy `GoalsManager` panel) and two creation paths (wizard + flat form) on the same page.
9. Dark Sankey surface `#202120` (warm) sits inside `--panel #111827` (cool) — visibly mismatched card-in-card.
10. Theme tokens are declared in four places in `globals.css` that must be manually kept in sync; `ThemeToggle` initializes state to `"dark"` regardless of the actual theme.
11. Budget's Previous/Next month pills are styled identically to its toggle pills, and there's no "Today" jump anywhere month navigation exists.
12. `/review` highlights the Reports nav item while being its own page.
13. StatTile/metric numbers are monospace while other numerals are sans.

## 4. Target design system (token + primitive spec)

### 4.1 Tokens (`app/globals.css`)

- `--background`: `#F6F5F3` light (sampled) / `#191918` dark (sampled canvas/sidebar tone). `--panel`: `#FFFFFF` (sampled) / `#222221` (sampled card tone — one step lighter than the dark canvas, confirmed by a full-width pixel scan). `--panel-2`: `#F2F0EC` / `#2A2A28` (secondary surface — no direct sample, estimated as one further step of the same light/dark direction each mode already takes between background and panel).
- `--accent`: Monarch orange, sampled at `#FF6A2D` in light (rounds to `#FF6B2E` for a clean value); **kept the same vivid hue in dark** rather than the sampled `#92472A`, which is very likely an artifact of a forced-dark-mode filter over the light screenshots, not a real design choice (see the caveat in §2.1) — no product ships a desaturated primary CTA on purpose. Hover darken ≈ `#F0551A`. `--accent-soft`: `rgba(255,107,46,0.10)`.
- **Nav/selection neutral** (new token `--pill`): `#ECE8E6` (sampled) light / `#2A2A28` dark (estimated, symmetric with the light sample's ~4% darkening off the background) — active nav, segmented-control active, hover fills. Accent is reserved for CTAs, links, and the active underline tab.
- **Settings active-row tint** (new token `--settings-active`): a solid, hue-specific fill, *not* the neutral `--pill` and *not* the orange accent — light `#EAF4F7` (estimated pale wash of the same ~195° hue) / dark `#003849` (sampled, solid, high confidence). This is Monarch's one deliberate exception to "accent is never used for nav/selection," and it uses blue there in both themes, not orange.
- `--success ≈ #2AA36B / #3BC183`, `--danger ≈ #E14A4A / #FF6B6B`, `--warning` amber for "At risk" chips. (Not reliably sampleable — thin anti-aliased text — kept as informed estimates.)
- Radii: keep `--radius-card: 12px`; add `--radius-pill: 9999px`. Buttons, chips, segmented controls, dropdown triggers all go pill. Fields stay ~10px.
- Shadows: reduce to Monarch's near-invisible card shadow (`0 1px 2px rgba(0,0,0,.04)`); reserve the lift shadow for modals/menus.
- Type roles: **retire the `eyebrow` + `display` page-header pattern**. New roles: `page-title` (20px/700), `card-title` (16px/600), `card-value` (inline bold value beside a card title, e.g. "Spending **$13,928.05 this month**"). `.metric-value` switches from Geist Mono to Geist Sans + `tabular-nums` (keep the class name — the privacy-blur selector and tests key on it).
- `--viz-*` slots and `--sankey-*` roles are **unchanged** (measured accessibility ceiling, see §8.2). Re-run `scripts/validate_palette.js` only if any viz value moves.

### 4.2 Primitives

- **Button**: pill radius. `primary` = orange, white text. `secondary` = white pill, hairline border, subtle shadow (Monarch's "Filters", "Refresh all"). `ghost` unchanged. Sizes/44px min-height unchanged.
- **SegmentedControl** (new): pill group in a `--panel-2` track, active segment = white pill with shadow (Monarch's Totals/Percent, Month/Year/Decade, List/Calendar, Breakdown/Trends). Link-based, replaces all three existing chip recipes.
- **DropdownButton** (new, client): white pill trigger with label + chevron opening a floating menu (Monarch's "Expenses ▾", "This month vs. last month ▾", "1 month ▾", "By category & group ▾"). Closes on Escape/outside click; items are Links or buttons. This is the one genuinely new interactive primitive.
- **MerchantAvatar / InstitutionAvatar** (new): 32–36px circle; renders a stored logo when available, else a deterministic brand-colored initial disc. Used in Transactions, Recurring, Accounts, Dashboard, Reports rows.
- **CategoryChip** (new): emoji + Title Case label from a static category→emoji map mirroring Plaid PFC groups (🛍️ Shopping, 🍽️ Restaurants & Bars, 🏛️ Taxes, 🌴 Travel & Vacation, 🅿️ Parking & Tolls, ☂️ Insurance, …). Emoji are glyphs, not series colors — no palette-ceiling interaction; text stays foreground color.
- **ProgressBar** (new shared): thin (6–8px) rounded track `--panel-2`; fill semantic green/amber/red; replaces the four ad-hoc bar recipes (BudgetWidget, GoalCard, GoalsSummary, MonthSummary).
- **Modal**: one recipe — `bg-black/50` backdrop, `rounded-card` panel, single shadow token.
- **Dates**: new `lib/format-date.ts` — `Jul 28, 2026` for dates, "9 hours ago" freshness, "(2 days ago)" relative annotations. No raw ISO strings in the UI (URLs/exports keep ISO).
- **RightRail layout** (new): `lg:grid-cols-[minmax(0,1fr)_340px]` pattern used by Accounts, Budget, Reports, Advice.

### 4.3 Shell

- **Sidebar** (full height, 240px / 64px collapsed): top strip = logo + icon row (search, bell, gear, collapse); nav with neutral-pill active state and the Recurring badge restyled to Monarch's orange rounded square; bottom pinned = "Ask your money" (existing gated link, restyled — replaces Monarch's AI Assistant slot), Help & Support (links to docs), then **user block**: avatar (Settings avatar, initials fallback) + display name + chevron opening a menu (Settings, privacy toggle, theme toggle, Sign out). Email, PrivacyToggle, ThemeToggle, LogoutButton move out of the top bar into this menu.
- **Content header** (new `PageHeader` component): slim bar with `page-title` left (Dashboard shows "Good {morning|afternoon|evening}, {displayName}!"), page actions right. Replaces every eyebrow/display/description header. Descriptions die; anything load-bearing moves to tooltips or section copy.
- Mobile: keep the top-docked quick bar + bottom sheet, restyled with the new tokens.

## 5. Per-page target specs

Each spec = Monarch reference → required changes. Data sources exist for everything listed unless flagged.

### 5.1 Dashboard (ref: 9.00.42, 9.01.02, dark 9.11.06)

- Header: greeting + `Customize` white pill (existing CustomizeDrawer behind it, restyled).
- **Asymmetric two-column grid at `lg` (~55/45)**, Monarch order — left: Budget, Net worth, Goals; right: Spending, Transactions, Recurring, Investments. (Credit score excluded, §8.1.) Widget `wide` flag is replaced by a column assignment in `lib/dashboard-widgets.ts`; `normalizeWidgetPrefs` keeps working (order still a flat list, split odd/even by column weight).
- Widget header anatomy: **bold title + inline muted value** ("Spending  $13,928.05 this month") left, DropdownButton right. WidgetShell's eyebrow/accent-link pattern is replaced.
- Budget widget: three group rows (Fixed / Flexible / Non-Monthly) with right-aligned "$X budget" and a ProgressBar each — not the current top-4 category list. Data: existing budget groups.
- Spending widget: `CumulativeCompareChart` restyled — this-month = orange line over orange gradient area fill; last-month = grey line; day-axis labels; "— Last month — This month" legend. Dropdown: "This month vs. last month".
- Net worth widget: "$56,520 net worth" title + red/green delta chip; blue area line chart (keep `--viz-1` blue — matches Monarch here); "1 month" dropdown.
- Transactions widget: rows = MerchantAvatar + name | CategoryChip | amount + chevron; "All transactions" dropdown.
- Recurring widget: Monarch's empty state (icon disc + "Stay on top of your bills" + orange CTA) and populated rows (greyed logo, name, "$12.00 / in 3 days" right column); "This month" dropdown.
- Goals/Investments widgets: match Monarch empty/populated states ("$43,590 investments $0.00 Today" header, "Top movers today" strip).
- PriorityRail, DashboardToolbar, ScopeChips: fold into the new visual language (toolbar contents move to header actions + a slim sync-status line; rail becomes a compact strip or moves to Monitor). Monitor/Plan/Wealth tabs stay (they hold real features Monarch's dashboard lacks) but restyled; Overview is the landing view and is the surface that must match Monarch.

### 5.2 Accounts (ref: 9.01.34/48, 9.02.02)

- Header bar: "Accounts" + right: `Filters` white pill (collapsible panel wrapping the existing GET form), `Refresh all`, orange `+ Add account`.
- Hero card: "NET WORTH ⓘ" micro-label, **36px bold net worth**, red/green change + "1 month change", right: `Performance ▾` and `1 month ▾` dropdowns; large area chart (blue line, soft gradient) — existing snapshot history, honest about its start date.
- Group cards (Credit Cards / Cash / Investments / …): collapsible header with chevron + name + change annotation + right group total; rows = InstitutionAvatar, bold name "(...0325)", type below, **two mini-sparkline columns**, right balance + "9 hours ago". Existing `AreaSparkline` + freshness data; second sparkline column = the longer-window trend (data exists in snapshots).
- Right rail Summary card: `Totals | Percent` SegmentedControl (exists as URL state), **Assets** total + stacked horizontal bar segmented by group (viz slots) + dotted legend rows, **Liabilities** red bar + rows, `Download CSV` accent link (existing route).
- AccountPreferences details-block relocates behind the Filters panel.

### 5.3 Transactions (ref: 9.02.37, 9.04.32 for row anatomy)

- Full shell width (kill `max-w-4xl`).
- Header bar: "Transactions" left; right: `Search`, `Date`, `Filters` white pills + orange `+ Add`. Search expands inline; Date/Filters open panels wrapping the existing GET forms. (Receipts/Retail Sync tabs excluded, §8.1.)
- Table toolbar right: `Edit multiple` (wraps BulkTagBar), `Sort ▾`, `Columns` (ColumnsMenu becomes a DropdownButton panel).
- Day group headers: "July 28, 2026" left, **plain day total right** (grey band, full width).
- Row: MerchantAvatar + merchant (pending/manual badges keep) | CategoryChip | account ("CREDIT CARD (...9181)") | right amount (+green for credits, plain foreground for debits — Monarch does not color debits red; adopt that) + chevron opening the existing TransactionEditor.
- Add modal: already close (Debit/Credit segmented, same field order incl. "Link to save up goal"); restyle to pill controls + Monarch spacing.

### 5.4 Reports (ref: 9.03.50 → 9.04.32, dark attachments)

#### 5.4.1 Sankey — exact-match spec

The July parity work got the architecture right (4 columns, group-hue inheritance,
label sides, flow conservation, table twin). **Exact match** requires these nine
changes to `components/charts/SankeyChart.tsx` + `lib/sankey.ts` + `--sankey-*`
tokens. Both invariants hold throughout: one shared value→pixel scale across all
columns; ribbon thickness never floored.

1. **Two-line labels.** Monarch labels are two stacked lines, not one:
   line 1 = `{emoji} {Name}` (~13px, regular, ink); line 2 = `$X,XXX.XX (NN.NN%)`
   (~13px, **semibold, ink** — not muted, not smaller). Today's single line with a
   smaller muted inline `tspan` is replaced by two `<tspan>` rows. The white
   halo (`paintOrder: stroke`) stays — invisible on the card, keeps text legible
   over ribbons. The amount tspan keeps `.money`/`data-money` for privacy blur.
2. **Emoji on nodes.** Sources ("💵 Paychecks", "💰 Other Income", "🤝 Interest"),
   groups, and leaf categories all carry their emoji from `lib/category-emoji.ts`
   (§4.2). The hub ("Income") and the Net Income / Unfunded Spending terminals
   carry none — matching Monarch.
3. **Percent format.** Two decimals with trailing zeros trimmed ("92.91%",
   "20.1%", "0.63%") — today's fixed one-decimal `toFixed(1)` changes to match.
   Basis stays share-of-total-income (already correct).
4. **Weighted column positions.** Monarch's columns are not evenly spaced: the
   hub→groups gap is roughly **twice** the other two gaps (measured on the
   screenshots ≈ 0 / 34% / 72% / 100% of inner width), because that middle gap
   carries both the hub's right-side label and the groups' left-side labels.
   `layoutSankey` gains per-column x positions instead of even division.
5. **Hub label placement.** Monarch's "Income / $177,734.60 (100%)" sits to the
   **right of the hub bar, vertically centered** — not above it. With the
   weighted gap from (4) there is room; the above-the-bar exception is removed
   (and `MARGIN_TOP` shrinks accordingly).
6. **Thinner, sharper bars.** Monarch node width ≈ 0.75% of canvas width
   (≈ 10px in our 1280 viewBox vs today's 18) with near-square corners
   (`rx` 2 → 1). Ribbon opacity roughly doubles: light `0.18 → ~0.38`, dark
   `0.30 → ~0.55` — sample against the screenshots and tune by eye at V9.
7. **Net Income pinned to the top of the group column.** Monarch shows Net
   Income first even when a spending group outvalues it (visible in the dark
   screenshots: Shopping $37.8k > Net Income $27.7k, Net Income still on top).
   Today it's only first by value coincidence. Leaf categories order grouped by
   parent, then by value — verify `layoutSankey` already does this.
8. **No folding at realistic sizes; label-slot-driven height.** Monarch renders
   ~34 leaf categories with every one labelled — the canvas just grows tall.
   `sankeyCanvasHeight` changes to reserve a **minimum per-node label slot
   (~30px, two lines)** in the busiest column, so labels occupy padding when
   bars are hairline-thin instead of being suppressed;
   `MIN_LABELLED_NODE_HEIGHT` suppression then becomes a rare last resort.
   `maxNodesPerColumn` rises (20 → 60) for the Reports usage;
   `foldSankeyOverflow` stays as the pathological-data backstop and the table
   twin still carries everything.
9. **Semantic hue pinning.** Monarch's group hues are stable per group identity
   (Shopping magenta, Financial red, Travel & Lifestyle blue, Food & Dining
   yellow, Housing orange, Health & Wellness salmon…), not assigned by size
   rank as today. Pin the known Plaid-PFC-derived group names to the seven
   `--sankey-group-*` slots by identity, falling back to size-order assignment
   for unknown groups. The existing seven hues were already sampled close to
   Monarch's; only the *assignment* changes. This stays inside the 7-hue
   ceiling — Monarch itself visibly reuses near-identical hues past ~7 groups,
   which is exactly what slot-reuse + direct labels gives us.

Residual, documented sub-1%: hover highlight/tooltip interactivity (ours is
native `<title>` — charts are server-SVG by invariant) and the fact that hue
variety beyond seven groups falls to the neutral ink slot (labels + table twin
carry identity, per the palette's CVD floor).

#### 5.4.2 Reports page chrome

Remaining around the chart:
- Header bar: "Reports" + tab links `Cash Flow | Spending | Income` inline next to the title (active = orange text + underline), right: `Date`, `Filters`, `Reports ▾` (saved reports as a dropdown), `Save` pills.
- Stat tiles: value-first (green income / red expenses), **uppercase micro-label below** the value, four across.
- "All time" range label + `Breakdown | Trends` SegmentedControl + right `By category & group ▾` + download icon button.
- Transactions section below the chart: same row anatomy as §5.3, plus right-rail **Summary card** (Total transactions, Largest, Average, Total income, Total spending, First/Last transaction, Download CSV) — all fields already computed in `summarizeTransactions`.

### 5.5 Budget (ref: 9.04.48 → 9.05.42)

The largest rework. Two-region layout: main table + 340px right rail.
- Header bar: month title + `← →` arrows + `Today` + `Month | Year | Decade` SegmentedControl + `Settings` pill.
- Sticky sub-header band per super-section (grey strip): "Income / Expenses / Contributions" with right-aligned column captions **Planned | Actual | Remaining**.
- Group blocks (Income; Fixed; Flexible with an "Unallocated Flexible Budget" row; Non-Monthly): collapsible, group totals in the three columns; category rows = emoji + name left, **Planned as a quiet inline input** (auto-save on blur + the existing optimistic rollback — the explicit per-row Save button goes away), Actual, Remaining (red chip when negative); a thin per-row progress bar spanning under the row (green under, red over).
- "Show N unbudgeted" keeps, restyled as Monarch's eye-icon row.
- Totals rows (Total Income / Total Expenses / Total Contributions) and the full-width **Left to Budget footer bar** (green surplus / red deficit).
- Contributions section: Save up / Pay down sub-blocks fed by existing goals data.
- Right rail: big tinted "Left to budget" card (`$5,020` green / `-$4,360` red), `Summary | Income | Expenses` text-tab row, then per-group blocks: "Fixed — $X planned / bar / $Y spent · $Z remaining".
- The current "Plan controls" columns (group select, rollover checkbox, order input) move into a per-row `⋯` menu (DropdownButton) — same API calls.
- Seed proposal modal restyles to Monarch's "Create a budget" centered card (icon, title, copy, orange CTA).

### 5.6 Recurring (ref: 9.05.57, 9.06.09)

- Header bar: "Recurring" + `Monthly | All recurring` text tabs; right `Filters` + orange `Manage recurring`.
- Review banner → Monarch's **full-width orange banner** with right "Review now" link (links to the All tab; today's banner is inert text).
- Month card: "July 2026" + arrows + `Today` + `List | Calendar` SegmentedControl. Calendar month-grid is **new build** (existing BillCalendar is list-shaped); it's a stretch item — ship List first, Calendar in the polish phase.
- Summary strip (one card, 3 columns): Income ("Add recurring income" accent link when none — manual income items exist), Expenses `$X paid / $Y remaining` + ProgressBar, Credit cards column.
- Upcoming/Complete become **tables**: merchant (avatar + name + "Every month" sub-line) | Date + orange "(22 days ago)" when overdue | Payment Account (avatar + name) | CategoryChip | Amount (green check when complete) | `⋯` menu (Confirm/Not recurring/Restore + amount correction move here from the All tab). Grey total band rows ("Upcoming Total … $411.99").
- Manual-item add form moves behind `Manage recurring`.

### 5.7 Goals (ref: 9.06.31 → 9.08.39)

- Header bar: "Goals" + `Save up | Pay down` text tabs; right: `Manage`, `Allocate funds`, orange `+ Add goal`.
- **Remove the legacy `GoalsManager` panel and its flat add form** (single source of truth = v2 cards; Edit/contribute/household-visibility controls move into a card `⋯` menu / detail).
- Cards: photo header, name + status chip (On track green-tint / At risk amber / Completed green), progress bar, amount rows. Imagery: replace the 8 SVGs with **owned/CC0 photos** in `public/goals/` (same `image_slug` whitelist mechanism; SVGs remain the no-photo fallback). Never copy Monarch's actual images.
- Empty state: Monarch's stacked sample-card illustration + "Plan for your future" + orange `+ Add goals`.
- Wizard → **full-screen overlay** (route or fixed overlay): top bar with back arrow, centered `Select | Targets | Contribution | Budget` stepper pills, thin orange progress bar under the header, close ×; footer bar with centered orange `Continue` (+ `Skip` on Contribution). Step content per screenshots: template photo cards (2-col); Targets = photo + "Customize photo" + Name/Target amount (optional)/Target date + "Spending reduces goal progress" toggle card; Contribution = "Add funds you have already saved" + account allocation rows + right Goals summary rail with "Est. $X / mo."; final "Congrats! You're on your way." screen with the goal card + `View goals`. All four steps map to the existing wizard's state and APIs — this is a re-skin plus a re-house.

### 5.8 Investments (ref: 9.08.59)

- Header bar: "Investments" + `Holdings` tab (no "Advanced" — Plus-gated in Monarch, excluded); right `Accounts ▾` + orange `+ Add Holding` (existing inline form becomes a modal).
- Performance section: comparison tiles + chart, **portfolio only** — "Your Portfolio" tile with 3-month/Today %, chart of TWR when `hasSufficientPerformanceData`, else "Balance". Benchmark tiles (S&P 500 / US Stocks / US Bonds) are **not rendered** (§8.1) — the tile row simply has one tile; leave the layout able to take more when a licensed feed lands.
- Holdings table: Security (avatar + name over ticker) | Price | Quantity | Value | Weight | Past 3 Months, grouped by asset class with grey subheader bands, Total row; `By asset class ▾` + `3 Months ▾` dropdowns.
- Allocation stacked bar moves under a `Market | Allocation` SegmentedControl like Monarch.

### 5.9 Advice (ref: 9.10.46)

- Header bar: "Advice"; right `Update profile` orange pill (links to the existing advice-profile questionnaire).
- Two-region: main list + right **Categories rail** (Recommendations highlighted, then Save up / Spend / Pay down / Protect / Invest / Wellness — filter links over the existing category data).
- "Prioritized by you ⓘ" card: rows with circular tinted icon + tiny uppercase category tag under it, bold title, 2-line clamped description, "NOT STARTED · N TASKS TO COMPLETE" micro-meta; "Show N completed" eye-toggle row. "Essential advice" card below, same rows.
- Row click expands the existing TaskChecklist inline (Monarch navigates to a detail page; inline expansion is the lighter adaptation, same information).

### 5.10 Settings (ref: 9.11.22, dark)

- Left rail becomes **two grouped cards**: "Account" (Profile, Display, Notifications, Security, Integrations) and "Household" (General→Household, Members→Settle up, Institutions, Categories, Merchants, Rules, Tags, Data). Businesses/Billing/Gift/Referrals excluded (§8.1). Active row = accent-tinted row (Monarch uses a blue tint here even in its orange app — mirror that with our accent at low alpha).
- Right panel: section content in a flat panel (Profile: avatar + `Edit ▾`, Full Name, Display Name + helper, Birthday, Timezone if we store it, full-width orange `Update Profile` button).

### 5.11 Pages with no Monarch reference

Cash Flow, Forecasting, Notifications, Review, Wrapped: **token + primitive re-skin only** (new header bar, pills, cards, date formatting). No structural redesign; they must simply stop looking like a different app.

## 6. New shared infrastructure (build once, used everywhere)

1. `PageHeader` (title + actions bar) — every page.
2. `SegmentedControl`, `DropdownButton`, `ProgressBar`, `Modal` wrapper.
3. `MerchantAvatar` / `InstitutionAvatar` + logo pipeline (§7).
4. `CategoryChip` + `lib/category-emoji.ts` static map.
5. `lib/format-date.ts` (humanized/relative dates).
6. `RightRail` layout helper.
7. Greeting util (time-of-day + display name from the Phase-13 profile).

## 7. Data-layer touches (the only two)

1. **Institution logos.** Plaid returns institution logos (base64) via `institutionsGetById`. Add `plaid_items.institution_logo` (or a small `institutions` cache table) captured at link/update time; serve as data-URI. Migration + service-client write at exchange/reconnect; falls back to initial-disc avatars. Merchant logos: **no external favicon service** (CSP + privacy — merchant names would leak to a third party). Merchants get deterministic initial discs; Plaid's `logo_url`/`personal_finance_category_icon_url` fields can be considered later as a stored-at-sync option.
2. **Goal photos.** Static CC0/owned images in `public/goals/`; no schema change (`image_slug` whitelist already exists).

Everything else is presentation-only.

## 8. Deliberate deviations from the screenshots (the 1%)

### 8.1 Excluded features (already decided in `docs/TODO.md`, unchanged)

| Monarch element | Decision |
|---|---|
| Credit score widget | Not rendered (no consented bureau source). Dashboard grid flows without it. |
| Free trial card, "Invite a friend, get $15", Billing/Gift/Referrals settings | Not rendered (not a commercial product). Sidebar bottom = Ask/Help/User. |
| AI Assistant nav + ✨ sparkle buttons on every card | Excluded — **no in-app AI** is a product decision. The gated "Ask your money" link keeps its slot; no sparkle icons. |
| Transactions "Receipts (New) / Retail Sync" tabs | Receipts UI is a deferred security-sensitive follow-up; Retail Sync has no data source. Not rendered. |
| Investments "Advanced" tab + S&P/US Stocks/US Bonds benchmark tiles | Legal exposure until a licensed feed is provisioned (`benchmark-provider.ts` note). Portfolio-only tile. |
| Monarch butterfly logo, "Gift Monarch", brand name | FundFlow logo/brand stays. |

### 8.2 Constraint-driven deviations (documented invariants)

- **Charts stay server-rendered SVG** (CSP nonce, no chart lib, no client JS in charts). Monarch's hover tooltips/animations are approximated with native `<title>` and static rendering. DropdownButton/modals are fine — client JS is allowed outside charts.
- **7-slot `--viz-*` ceiling** is a measured CVD floor, not taste. Where Monarch colors 15+ categories, FundFlow folds to 7 + Other (`foldTail`) and keeps table twins/direct labels. The Sankey's group-hue system already handles this.
- **Dark-mode Sankey all-pairs caveat** stands (dark `--viz-5` vs `--viz-1` ΔE 1.9 under protanopia); fixing dark `--viz-5` is its own validated change, not part of this program.
- Every Monarch control that is a client popover has a URL-state fallback path preserved (the GET-form architecture stays underneath the new skins) — report/ledger state remains shareable URLs.
- Table twins, `aria` labels, 44px touch targets, and the privacy-blur hooks (`.metric-value`/`.money`/`[data-money]`) are non-negotiable and survive every re-skin.

## 9. Verification bar

- Side-by-side screenshot review per page vs the reference (Playwright at 1440×900, light + dark) — the acceptance test for "99%".
- `npm run build`, `lint`, `npx tsc --noEmit`, `npm run test:unit` green per phase.
- `tests/unit/privacy-blur.test.ts` and dashboard-reconciliation tests must never regress.
- Palette validator re-run if any `--viz-*` value changes.
