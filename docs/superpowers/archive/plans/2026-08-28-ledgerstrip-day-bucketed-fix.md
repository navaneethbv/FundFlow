# Implementation Plan: LedgerStrip day-bucketed, time-true register

Fixes the density and false-time-axis parts of HIGH-1 from `2026-08-28-register-rollout-qa-remediation.md` on PR #134, `feat/register-visual-rollout-v2`.
Audited against PR head `10da1563869faab0c856ad5141a38319ed3d4ba4` and the current working tree on 2026-08-28.

Chosen option: **Option B, day-bucketed and time-true**.
Option A was rejected because it leaves the ordinal-axis defect and overlapping hover targets in place.
Option C remains the deliberate follow-up because drawing a real balance trajectory requires a separate visual and scale decision.

## Feasibility verdict

Option B is feasible without changing `loadLedgerStripTicks`, `pickAnchorAccount`, the database query path, or the running-balance reconstruction.
It can remain a zero-JavaScript server component.
The original draft was not execution-ready because five details contradicted its acceptance criteria.

1. Routing 40 percent of the current 18 to 30 monthly purchases to checking produces only 7 to 12 checking purchases, or 10 to 15 checking entries after payroll and rent, not the promised 30 to 40.
2. A day can render both an inflow label and an outflow label, so budgeting four labelled columns can render as many as eight visible labels.
3. Alternating two vertical bands does not prevent two labels in the same band from overlapping when their dates are close.
4. Keeping `min-w-[44rem]` preserves the internal horizontal scrollbar shown in the mobile failure screenshot.
5. `largestInLabel`, `largestOutLabel`, and a count cannot support a tooltip that lists every transaction on the day.

The steps below resolve those contradictions.

## Step 1: make the demo fixture hit the stated density

Update `lib/demo-data.ts` and `tests/unit/demo-data.test.ts` first.

- Increase the monthly purchase count to a deterministic range of 68 to 92 purchases.
- Assign exactly `Math.round(purchaseCount * 0.4)` purchases to `accountIndex: 0` and the remainder to `accountIndex: 1`.
- Keep the two checking paychecks and checking rent.
- Force at least five of the checking purchases onto one deterministic date per month so same-day aggregation is exercised by every demo load.
- Keep IDs deterministic and unique.

This produces 30 to 40 checking entries per month, including payroll and rent, while retaining activity on the credit account.
The demo API already inserts in batches of 500, so the larger six-month fixture remains inside the existing write path.

Add unit assertions that every generated month has 30 to 40 checking entries, that at least one checking date contains five or more entries, and that repeated calls with the same user and date remain identical.

Acceptance: `POST /api/demo` gives the LedgerStrip realistic density without any manual follow-up seeding.

## Step 2: add failing volume and calendar-axis render tests

Extend `tests/unit/ledger-strip-render.test.ts` before changing the component.

- Add deterministic 40-transaction and 150-transaction fixtures distributed across one valid month.
- Add ten transactions on the same date and assert that the fixed markup will contain one day column for that date.
- Assert that the total rendered day-column count never exceeds the number of calendar days in the month.
- Assert that visible-label slots are bounded at 4 through tier 1, 8 through tiers 1 and 2, and 12 through tiers 1 through 3.
- Assert that date positioning comes from the day of month rather than transaction index.
- Assert that the mobile markup no longer requires a minimum-width rail or an internal horizontal scroll region.

Use stable hooks such as `data-ledger-day`, `data-label-side`, `data-label-tier`, and `data-label-band` rather than matching incidental Tailwind class ordering.
Confirm that these tests fail against the current per-transaction implementation.

## Step 3: add pure day aggregation and label-slot selection

Add the following exported shape and function to `lib/ledger-strip.ts`, with focused tests in `tests/unit/ledger-strip.test.ts`.

```ts
export type LedgerLabelTier = 1 | 2 | 3;
export type LedgerLabelBand = 0 | 1;

export interface LedgerDayLabel {
  merchant: string;
  amount: number;
  tier: LedgerLabelTier;
  band: LedgerLabelBand;
}

export interface LedgerDayColumn {
  date: string;
  dayOfMonth: number;
  grossIn: number;
  grossOut: number;
  net: number;
  transactionCount: number;
  endOfDayBalance: number;
  inflowLabel: LedgerDayLabel | null;
  outflowLabel: LedgerDayLabel | null;
}

export function buildLedgerStripDays(
  ticks: readonly LedgerTick[],
  month: string,
): LedgerDayColumn[];
```

Aggregation rules:

- Parse `month` and each `YYYY-MM-DD` date with integer string parsing, not `new Date(date)`, so local time zones cannot shift a day.
- Throw `RangeError("ledger_strip_invalid_month")` unless `month` is a calendar-valid `YYYY-MM` value.
- Include only ticks whose date belongs to `month` so direct callers cannot place a mark outside the rail.
- Sort a copy of the ticks by date and ID before grouping so direct callers receive deterministic output and a deterministic end-of-day balance.
- Treat positive `LedgerTick.amount` values as inflows and negative values as outflows.
- Set `grossIn` to the sum of positive deltas.
- Set `grossOut` to the sum of the absolute values of negative deltas.
- Set `net` to `grossIn - grossOut` without netting the two stems visually.
- Set `endOfDayBalance` from the final tick on the date.
- Select the largest inflow merchant and largest outflow merchant independently for their candidate labels.

Label selection rules:

- Budget **label slots**, not day columns, because one day can have labels on both sides of the axis.
- Tier 1 may expose at most 4 label slots in total, tiers 1 and 2 at most 8, and all tiers at most 12.
- Force the month's largest inflow label and largest outflow label into tier 1 when those sides exist.
- Rank remaining candidates by absolute amount, then date, side, and merchant for deterministic ties.
- Assign bands independently for inflows and outflows.
- Admit a candidate only when one of its side's two bands has enough calendar-day separation from every label already visible in that band at the same breakpoint.
- Use one fixed 72px label width in both the CSS and the selection algorithm.
- Derive the minimum day gap as `Math.ceil((72 / minimumAxisWidth) * (daysInMonth - 1))` with conservative minimum axis widths of 208px below `md`, 448px at `md`, and 496px at `lg`.
- Treat 4, 8, and 12 as hard maxima, not guaranteed counts, because a tightly clustered month may safely expose fewer labels.

Export the budgets and separation constants so the pure-function tests and component markup use one source of truth.

## Step 4: rewrite the rail as a responsive day register

Update `components/dashboard/LedgerStrip.tsx`.

- Call `buildLedgerStripDays(ticks, month)` and render one `data-ledger-day` column per active calendar date.
- Compute horizontal position as `(dayOfMonth - 1) / (daysInMonth - 1) * 100`.
- Scale stem heights against the largest `grossIn` or `grossOut` day, using the existing square-root treatment.
- Draw the inflow stem above and the outflow stem below the same date position.
- Use a neutral axis dot when both directions occur on one day so the dot does not falsely choose one direction.
- Render `inflowLabel` and `outflowLabel` independently with their own tier and band hooks.
- Keep tier 1 visible at all widths, reveal tier 2 at `md`, and reveal tier 3 at `lg` with static CSS classes that Tailwind can discover.
- Give labels a fixed maximum width matching the collision-selection constants.
- Use edge-aware alignment for dates near the first and last days so labels stay inside the card.
- Replace the fixed `min-w-[44rem]`, `ml-20`, `mr-48`, and absolute balance rail with a responsive grid that stacks the closing balance below the strip on narrow screens and places it at the right on wider screens.
- Do not put the strip inside an internal horizontal scrolling region.
- Keep the closing figure sourced from the final day column's `endOfDayBalance`.
- Change the misleading eyebrow and title from “Running balance” and “Month to date, in order” to activity-oriented copy such as “Account activity” and “Month to date, by day”.
- Show both the source entry count and active-day count so aggregation is explicit.

Unlabelled days may reveal a summary containing the date, gross inflow, gross outflow, transaction count, and end-of-day balance.
Do not claim to list every transaction unless the day shape is expanded to carry those transactions.
If the summary is focus-revealable, the day column must be keyboard focusable and use both hover and focus-visible reveal classes.
Every column must retain an `aria-label` with the same summary even when its visible label tier is hidden.

## Step 5: complete the pure and render test matrix

In `tests/unit/ledger-strip.test.ts`:

- Verify date grouping and ascending output.
- Verify gross inflow and gross outflow remain separate.
- Verify net equals gross inflow minus gross outflow.
- Verify end-of-day balance uses the last date-then-ID tick.
- Verify the largest inflow and outflow labels receive tier 1.
- Verify 4, 8, and 12 are total label-slot maxima rather than per-column maxima.
- Verify same-side labels in the same band meet the configured day-separation rule at every tier.
- Verify deterministic tier and band assignment under ties.
- Verify an empty month returns an empty array.
- Verify invalid months throw the documented `RangeError` and out-of-month ticks are excluded.

In `tests/unit/ledger-strip-render.test.ts`:

- Verify 40 and 150 input ticks produce at most one column per active day.
- Verify a mixed-flow day renders two stems and one neutral dot.
- Verify tier visibility classes and stable data hooks.
- Verify narrow markup has no minimum-width rail and no internal scrollbar.
- Verify the activity-oriented title no longer promises a balance trajectory.
- Verify the existing closing-balance, account label, current-month, historical-month, currency, and privacy hooks still work.

## Step 6: verify in the browser and re-baseline

Run the focused unit tests first, followed by `npm run lint`, `npx tsc --noEmit`, `npm test`, and `npm run build`.
Run `graphify update .` after the code changes.

Reproduce the original failure through the real demo flow before accepting the fix.
Use `POST /api/demo`, open the dashboard as a signed-in user, and verify the naturally selected depository account without manually adding rows.

Repeat the QA matrix at 1440px, 768px, and 390px in light and dark mode.
At every viewport, assert that the document and LedgerStrip card have no horizontal overflow, no visible label intersections, and no clipped first-day or last-day labels.
Inspect mixed-flow days, the forced five-transaction day, keyboard focus reveal, privacy blur, and the closing balance.
Capture a replacement for `04b-ledgerstrip-37.png` and `10-ledgerstrip-mobile.png` only after those assertions pass.

The visual collision gate must use browser bounding boxes for every visible label at each breakpoint.
Markup counts alone prove the budget, but they do not prove that rendered text does not overlap.

## Explicitly out of scope for this plan

- Option C, which draws the running balance as a line.
- HIGH-2, M-1 through M-6, L-2, and L-4 were tracked in the companion remediation note and are now implemented there.
- L-3 remains an explicit product decision rather than an incidental layout change.
- Changes to `loadLedgerStripTicks`, `pickAnchorAccount`, balance reconstruction, or database reads.
