# Cash Flow Sankey: Monarch parity

Date: 2026-07-31
Status: approved

## Problem

The Reports Cash Flow Sankey renders correct data as an unreadable picture.
Against Monarch's equivalent view, four things are wrong and one is a data defect.

Visible defects, in order of how much damage they do:

1. Node labels are raw Plaid enums (`RENT_AND_UTILITIES_RE…`, `GENERAL_SERVICES_INSU…`), truncated at 22 characters.
2. Column 2 and column 3 labels collide, because only the last column anchors its text to the left.
3. The canvas is a fixed 420px tall, so a full column is crushed and the bottom labels clip into the legend.
4. The per-column fold limit of 8 collapses the long tail into an `Other` bucket that is the largest node in its column.
5. `LOAN_DISBURSEMENTS` is classified as income, so borrowed money is reported as earnings.

## Decisions

Three questions were resolved before design.

**Color encodes category, not stage.**
This reverses a documented invariant in `CLAUDE.md` and the `SankeyChart` header comment.
The existing rule exists to keep the chart inside a 6-slot palette validated for color-vision deficiency and contrast.
Reversing it requires re-earning that guarantee against a larger palette, and both documents must be rewritten to state the new rule.

**`LOAN_DISBURSEMENTS` is reclassified app-wide, not just in Reports.**
`TRANSFER_GROUPS` is the single canonical definition.
Scoping the fix to Reports alone would make Reports disagree with Dashboard and Cash Flow about total income, which is the exact divergence `financeTotals` exists to prevent.

**Labels carry name, full amount, and percent, without emoji.**
Emoji would require a hand-maintained glyph map that drifts whenever Plaid adds a category, and emoji are inherently colored, so they sit outside the palette system.

## Section 1: loan disbursement classification

Add `LOAN_DISBURSEMENTS` to `TRANSFER_GROUPS` in `lib/finance-domain.ts`.

The set already excludes `LOAN_PAYMENTS`.
Excluding the repayment while counting the draw as income is asymmetric: the borrowed money appears as earnings and its repayment is invisible.

This lands first, in its own commit, so the Sankey work is verified against correct totals rather than a moving number.
It changes income, net, and savings rate on Dashboard, Cash Flow, Budget, and Reports.

## Section 2: readable labels

`lib/reports.ts` `label()` returns the raw key.
Replace it with the prettifiers already in the codebase:

| Node kind | Helper | Example |
| --- | --- | --- |
| Income source | `subcategoryLabel(groupKey, categoryKey)` | `INCOME_SALARY` to `Salary` |
| Expense group | `titleCase(groupKey)` | `RENT_AND_UTILITIES` to `Rent And Utilities` |
| Expense category | `subcategoryLabel(groupKey, categoryKey)` | `RENT_AND_UTILITIES_RENT` to `Rent` |

`titleCase` is in `lib/format.ts`; `subcategoryLabel` is in `lib/drilldown.ts`.

One structural change is required.
The aggregation maps in `buildCashFlowSankeyData` are keyed by the display string.
Once display strings are derived rather than raw, two distinct raw keys that title-case alike would silently merge into one node.
Key the maps by raw key and carry display text in a parallel map.
Node ids stay raw-derived, so `cat:GENERAL_SERVICES::OTHER` and `cat:TRAVEL::OTHER` remain distinct nodes that both read `Other`.

The `Unknown` fallback for blank and `UNCATEGORIZED` keys is preserved.

## Section 3: layout

All four changes are in `components/charts/SankeyChart.tsx`.

**Label side.**
Today `isLast = node.column === lastColumn` is the only condition that anchors a label left, so column 2 labels run right and column 3 labels run left, meeting in the gap between them.
Columns 0 and 1 anchor right; columns 2 and 3 anchor left.
The empty space between the hub and the groups column absorbs the column 2 labels.

**Dynamic height.**
`VIEW_HEIGHT` becomes derived from the tallest column rather than fixed at 420, with 420 as the floor.

**Fold limit.**
`DEFAULT_MAX_NODES_PER_COLUMN` goes from 8 to 20, which is safe only once height scales.

**Hairline label suppression.**
A node shorter than a threshold renders no text, keeping its identity in the SVG `<title>` and the table twin.
Without this, raising the fold limit reintroduces overlap at the tail.

## Section 4: category palette

The largest piece, and the only one that trades away an accessibility guarantee.

- Extend `--viz-1..6` to 12 categorical slots across all three blocks in `app/globals.css`: light `:root`, the light override block, and dark.
- Validate the new palette with the dataviz skill validator: protanopia, deuteranopia, and tritanopia, plus contrast in both themes.
- Replace `slotForColumn` with `slotForNode`, assigning a slot **by rank order rather than by hash**, so the largest category deterministically takes slot 1 and colors do not reshuffle between renders or date ranges.
- Give each ribbon a `<linearGradient>` from its source hue to its target hue.
- Sources and the hub keep fixed structural hues; groups and categories carry category color.
- Drop the stage legend. It documents a rule that will no longer hold, and identity now lives in the labels.
- Rewrite the color paragraph in the `SankeyChart` header comment and the corresponding `chart-utils` bullet in `CLAUDE.md`.

## Section 5: numbers and privacy

Amounts move from `compactCurrency` to full currency, with a percent alongside.

Percent basis is **total money in**, uniformly, for every node in every column.
Monarch is inconsistent here: its group column shows a percent of income while its category column shows a percent of spending.
A single basis means any two ribbons in the diagram are directly comparable.

Every money string rendered in the SVG must keep the `money` class and `data-money` attribute so the privacy blur still covers it.
These labels are money, and without the hooks they become a blur leak.

## Testing

`lib/sankey.ts` and `lib/reports.ts` are pure, so the bulk is unit-testable:

- label prettification for all three node kinds, plus the `Unknown` fallback
- the raw-key collision case: two groups whose categories title-case alike stay distinct
- percent math against the total-money-in basis
- dynamic height derivation, including the 420 floor
- deterministic slot assignment across repeated renders
- `LOAN_DISBURSEMENTS` resolving to `transfer` in `fromTransactionRow`
- palette validation alongside the existing test

## Risks

Section 4 is roughly the effort of the other four combined, and it is the only section that removes a guarantee rather than adding behavior.
Sections 1 through 3 independently fix most of the visible ugliness, since the damage is enum labels and collisions rather than hue count.
If the palette validation cannot produce 12 accessible hues, sections 1 through 3 and 5 still stand on their own.
