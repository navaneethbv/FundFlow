# Dashboard drill-down design

Date: 2026-07-11
Status: Approved (in-place drill-down, full 3-level hierarchy, all four companion improvements)

## Problem

The dashboard shows aggregates only. The "Spending by category" donut folds to six
slices and nothing on the page is clickable: you cannot answer "what is inside
Rent And Utilities this month?" or "why did spending spike in March?" without
leaving for the Transactions page and hand-building a fuzzy search. Plaid's
detailed subcategory (`pfc_detailed`) is synced on every transaction but never
used by the dashboard.

## Goals

1. Click any category slice or legend row and drill in place:
   category -> subcategory -> transactions, with merchants visible at each level.
2. Click a month on the trend charts to switch the dashboard to that month.
3. Click a merchant (top merchants, recurring streams) for a merchant deep dive.
4. Expand the folded "Other" slice into the full ranked category list.
5. Cards/banks bars and cash-flow tiles link to filtered views.
6. No client-side JS in charts, no new chart library, no new Plaid calls,
   no regression of the security or Plaid-frugality invariants in CLAUDE.md.

## Non-goals

- Sync changes, new columns, or migrations (all data needed already exists).
- Changes to the CSV/JSON export contract, weekly report, or recurring logic.
- Client-side interactivity (tooltip popovers, animation). Links only.

## Core mechanism: URL-driven, server-rendered drill-down

Drill state lives in `/dashboard` searchParams, composable with the existing
`month`, `accountId`, and `tab` params:

| Param | Example | Meaning |
| --- | --- | --- |
| `category` | `RENT_AND_UTILITIES` | Level-1 drill into a primary category |
| `category=_other` | `_other` | Expanded full category list (no fold) |
| `sub` | `RENT_AND_UTILITIES_RENT` | Level-2 drill into a detailed subcategory (requires `category`) |
| `merchant` | `Netflix` | Merchant drill (mutually exclusive with `category`) |
| `itemId` | uuid | Filter dashboard to one bank (plaid_items id), like `accountId` |

Rules:

- `category` and `merchant` are mutually exclusive; if both appear, `category` wins and `merchant` is ignored.
- `sub` without a matching `category` is ignored.
- Unknown/invalid values render the normal un-drilled dashboard (never an error).
- All drill links preserve `month`, `accountId`, `itemId`, and `tab`.
- Charts stay server-rendered SVG; interactivity is `<a>` elements wrapping
  slices, legend rows, bars, and month hit-targets (SVG anchors are native,
  CSP-safe, zero JS).

## Data layer

### lib/dashboard.ts

- Stage-2 window fetch adds `pfc_detailed` to the select (bounded 6-month
  window unchanged; do not reintroduce a select-all).
- `getDashboardData` gains an optional `drill` argument:
  `{ category?: string; sub?: string; merchant?: string }`.
- `DashboardData` gains `drilldown?: CategoryDrilldown | MerchantDrilldown`
  (discriminated by a `kind` field), plus `itemId` filtering applied the same
  way `selectedAccountId` filtering works today (in-memory over the window,
  accounts matched via `plaid_item_id`).
- Merchant-rule application stays exactly where it is; all drill aggregation
  runs on the rules-applied transactions so a rule that recategorizes a
  merchant drills consistently with the donut it clicked from.

### lib/drilldown.ts (new, pure, unit-tested)

Pure functions over the already-fetched window transactions (shape mirrors
`chart-utils.ts` / `planning.ts`):

- `buildCategoryDrilldown(txns, splits, { category, sub, activeMonth })` returns:
  - `subcategories: { key, label, amount }[]` grouped by `pfc_detailed`
    within the category for the active month (split portions grouped under a
    `Manual split` bucket, see Splits below)
  - `merchants: { merchant, amount }[]` top merchants within the category/sub
  - `trend: { month, amount }[]` 6-month spend for the category/sub
  - `momDelta: number` active month vs previous month for the category/sub
  - `transactions: TxnLite[]` the matching active-month rows, newest first
- `buildMerchantDrilldown(txns, { merchant, activeMonth })` returns trend,
  count, average, dominant category, and the matching transactions.
- Both apply the existing `EXCLUDED_PFC` / `isSpending` semantics and the
  linked-refund exclusion set (refunded pairs stay out of drill totals, same
  as every other spend total).

### Splits

A transaction belongs to a drilled category if its (rules-applied) primary
category matches, or any of its valid splits assigns spend to that category.
The amount attributed is the split amount when splits assign it, otherwise the
full amount (same semantics as `aggregateSpendWithSplits`, so donut total and
drill total always agree). At the subcategory level, split-assigned portions
have no `pfc_detailed`, so they group under a single `Manual split` bucket.
Splits are fetched for the active month's spend ids only (the query already
exists in `getDashboardData`; reuse its result).

### Caching

`getCachedDashboardData` scope key extends from `account:month` to
`account:month:item:drill` (e.g. `all:2026-07:all:cat=RENT_AND_UTILITIES`).
TTL and invalidation are unchanged; the 45s TTL bounds fragmentation.

## UI

### CategoryDrilldown panel (new component)

When `category` is present, the "Spending by category" donut panel is replaced
by a drill panel:

- Breadcrumb: `All categories -> Rent And Utilities -> Rent` (each crumb a link
  that pops drill levels; "All categories" clears `category`/`sub`).
- Subcategory donut + legend (rows link to `sub=`), or when `sub` is active,
  a header stat for the subcategory.
- Top merchants in scope (BarList; rows link to `merchant=` drill).
- Single-series 6-month `TrendChart` for the scoped spend, months clickable.
- "vs last month" delta chip.
- Transaction rows (date, merchant, amount) capped at ~10, with a
  "View all in Ledger" link to `/transactions` carrying exact filters.

`category=_other` renders the full ranked category list (unfolded; data
already exists since folding happens presentationally in `OverviewTab`).

### MerchantDrilldown panel (new component)

Same slot, for `merchant=`: 6-month trend, transaction count, average amount,
dominant category (links back to that category drill), matching recurring
stream if any, transaction rows, "View all in Ledger" link.

### Chart component changes (rendering only, geometry stays in chart-utils)

- `DonutChart`: optional `linkFor?: (item) => string | undefined`; slices and
  legend rows wrap in `<a>` when it returns a URL. The `Other` item links to
  `category=_other`.
- `BarList`: optional per-item `href`.
- `TrendChart` / `DivergingColumns`: optional `linkForLabel?: (index) => string | undefined`;
  the existing invisible hit-target rects wrap in `<a>` linking to
  `?month=YYYY-MM` (raw month keys passed alongside display labels).
- Focus styles on the new anchors so keyboard users can drill; every link has
  an accessible name (aria-label with label + value).

### Other surfaces

- `OverviewTab` top merchants and recurring stream rows link to `merchant=`.
- `BreakdownsTab`: spend-per-card bars link to `?accountId=`; spend-per-bank
  bars link to `?itemId=`.
- `CashflowTab`: deposits/withdrawals tiles link to
  `/transactions?month=X&flow=in|out&accountType=depository`.
- `CardCarousel` and `MonthChips` link builders preserve the new params so
  switching account or month keeps (or sensibly resets) the drill: switching
  month keeps the drill; switching account keeps the drill; switching tab
  drops `category`/`sub`/`merchant`.

## Transactions page

First-class filter params (exact matches, replacing reliance on fuzzy `q`):

- `category` (pfc_primary, rules-applied semantics documented as a known gap:
  SQL-level filter matches stored `pfc_primary`; rows recategorized by
  merchant rules are a small known discrepancy, acceptable for v1 and noted
  in the UI copy only if it proves confusing)
- `sub` (pfc_detailed)
- `merchant` (exact `merchant_name` match, `ilike` fallback to `name`)
- `flow` (`in` = amount < 0, `out` = amount > 0)
- `accountType` (`depository` | `credit`, joins via the accounts list already
  fetched)

Active filters render as removable chips above the table.

## Security and invariants

- All reads stay on the user-scoped (RLS-bound) client; no service client use.
- No new Plaid calls; the 6-month bounded window is unchanged.
- Drill params are validated/normalized before use (category keys matched
  against known values from the data; merchant matched against fetched rows;
  arbitrary strings never interpolated into PostgREST filters beyond the
  existing `sanitizeSearch` pattern, which extends to the new params).
- `EXCLUDED_PFC` applies to every drill spend total.
- No PII in logs; no new audit events (read-only feature).

## Testing

Unit tests (`tests/unit/drilldown.test.ts`):

- Subcategory grouping incl. `Manual split` bucket and null `pfc_detailed`.
- Split membership: split-assigned txn appears in the drilled category with
  the split amount; totals reconcile with `aggregateSpendWithSplits`.
- Linked-refund exclusion inside drills.
- Category/sub trend and MoM delta across the 6-month window.
- Merchant drilldown: count, average, dominant category.
- `_other` expansion equals full breakdown minus top-6.
- Param normalization: invalid `category`/`sub`/`merchant` yields no drilldown.

Existing tests must stay green; `getDashboardData` without `drill` returns
byte-identical results (no `drilldown` key work done).

## Rollout

Single feature branch off `feat/todos-roadmap` or its successor; no migrations;
no env changes; verify in browser with the live Plaid-synced data per the usual
flow, then update `docs/HANDOFF.md` / `docs/TODO.md`.
