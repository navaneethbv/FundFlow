# Register Rollout QA Findings and Remediation Plan

Branch: `feat/register-visual-rollout-v2` (PR #134).
Reviewed: 2026-08-28, against the Vercel **Preview** deployment, signed in as a throwaway Supabase user.
Status of this document: **untracked working note**, deliberately not committed, so it does not re-inflate the PR diff that was trimmed to 70 files / 3.7k lines for review.
The implementation work tracked here is now complete for HIGH-1, HIGH-2, M-1 through M-6, L-2, and L-4.
L-3 was explicitly accepted as a layout tradeoff, while L-1 and L-5 remain retracted.
The remaining merge decision is process scope and remote review policy, not an unplanned code fix.

## How this was tested

1. Created a throwaway auth user via the Supabase admin API, signed in through the real `/login` form.
2. Seeded the deterministic demo dataset with `POST /api/demo` (187 transactions, 2 accounts).
3. Observed the Ledger Strip at its demo density, then seeded 34 additional transactions onto the **depository** account to reach a realistic month (37 entries on the anchor account, 221 total).
4. Walked `/dashboard`, `/transactions`, `/accounts`, `/cash-flow`, `/reports`, `/forecasting`, `/settings` at 1440px and 390px, in light and dark.
5. Cleared demo data, deleted the throwaway user, confirmed zero residual rows.

Screenshots are in `.playwright-mcp/qa-shots/` (gitignored).
The before/after pair that matters is `01-dashboard-overview-light.png` (3 entries, looks correct) versus `04b-ledgerstrip-37.png` (37 entries, unreadable).

---

## HIGH-1 (blocker): the Ledger Strip collapses at realistic transaction volume

### The failure

At 3 entries the strip is the polished hero element the design approved.
At 37 entries on one checking account, which is an ordinary month, the tick labels overlap into an illegible stack of red text and the widget conveys nothing.
At 390px it degrades further and introduces a horizontal scrollbar inside the card.

Evidence: `04b-ledgerstrip-37.png`, `10-ledgerstrip-mobile.png`.

### Root cause, measured

The layout budget is off by roughly a factor of five, and no amount of font or spacing tuning closes that gap.

- The tick rail is `min-w-[44rem]` (704px) with `ml-20` (80px) and `mr-48` (192px) reserved (`components/dashboard/LedgerStrip.tsx:94-104`).
  Measured at a 1440px viewport the panel is 1144px wide, leaving roughly 800px of usable rail.
- Ticks are placed at `index / (ticks.length - 1) * 100%` (`components/dashboard/LedgerStrip.tsx:112`).
  At 37 ticks that is about **22px of pitch per tick**.
- Each label is three lines, `w-max`, centred on its tick, with the merchant line capped at `max-w-[8rem]` (128px) (`components/dashboard/LedgerStrip.tsx:36-47`).
  A typical label needs **80px to 128px**.

So each label needs four to six times the horizontal space it is given.

### Why the existing mitigation does not scale

The design spec anticipated volume and chose a rule it believed would scale (`docs/superpowers/specs/2026-08-24-dashboard-ledger-strip-design.md`, deviation 4).
A tick is permanently labelled when it is an inflow, or when its absolute amount is at least `MAJOR_TICK_THRESHOLD` of $100 (`lib/ledger-strip.ts:107`).

That rule cannot scale, for a structural reason worth stating plainly.
Label collision is a function of **label count inside a fixed pixel width**, and an absolute-dollar threshold has no relationship to available width.
As transaction volume grows, the number of ticks clearing $100 grows with it, so the rule admits more labels into the same rail rather than fewer.
The threshold controls which ticks are interesting; it does not control how many will fit.

Two further contributors:

- **Nothing caps tick count.** `loadLedgerStripTicks` pages through every transaction in the month and `buildLedgerStripTicks` emits one tick per transaction, unbounded (`lib/ledger-strip.ts:186-215`).
- **Hover recovery does not work at density.** Minor labels are `opacity-0` but remain in normal flow, so each column's hover target is as wide as its hidden label, and adjacent columns overlap each other's targets (`components/dashboard/LedgerStrip.tsx:36-40`).
  At 22px pitch the reveal is effectively unusable.

### A second defect the same screenshot exposes: the x-axis is not a time axis

Ticks are spaced **ordinally**, one slot per transaction, not by date.
A day with ten transactions therefore occupies ten thirty-sevenths of the month's width, and two transactions on the same day sit at different horizontal positions, which is meaningless.
In `04b-ledgerstrip-37.png` the Aug 15 cluster visibly consumes about a quarter of the rail.

This matters beyond aesthetics.
The widget presents a horizontal axis that reads as time and is not time, which is the same class of problem as the repository rule against saying "prediction" for something nothing predicts.
Any fix for the density problem should fix the axis at the same time, because both are solved by the same change.

### A third, more fundamental mismatch: it never draws the running balance

The panel is titled "Running balance" and the eyebrow says "Month to date, in order", but the vertical dimension encodes **per-transaction amount magnitude** against a flat baseline, and the running balance appears only as a single number in the right rail.
The balance trajectory, which is the one thing the title promises and the most useful thing a month view can show, is not drawn.

This is relevant to the fix because a balance line scales to any N.
Lines do not collide with each other; only labels do.

---

## Options for HIGH-1

### Option A: cap and thin the labels, keep everything else

Rank ticks and permanently label only the top K, where K is a fixed per-breakpoint constant rather than a dollar threshold.
From the measurements above the honest budget is about **8 labels at desktop and about 4 at mobile**.

Pros: smallest diff, preserves the approved visual exactly.
Cons: leaves the ordinal-axis defect in place, leaves 37 stems at 22px pitch which is still visually noisy, and leaves hover recovery broken.
This treats the symptom.

### Option B: day-bucketed, time-true register (recommended)

Three changes that compose:

1. **Position by date, not index.** `left = (dayOfMonth - 1) / (daysInMonth - 1) * 100`.
   This makes the axis honest and makes same-day transactions share an x position, which is correct.
2. **Aggregate to one column per active day.** Draw two stems per day, gross inflow above the axis and gross outflow below, rather than one net stem.
   Netting a $2,450 payroll against a $2,400 rent into a $50 stem would hide both, so gross-in and gross-out preserves the information that matters.
   This bounds marks at **31 forever**, and in practice around 20.
3. **Budget labels by width, not by dollars.** Rank day columns by `max(grossIn, grossOut)` and label only the top K, always including the largest inflow and the largest outflow so the month's shape stays legible.
   Stagger the labelled few across two alternating bands above and below the axis so even K labels cannot collide.

Pros: fixes density, axis honesty, and mobile in one change; both marks and labels are hard-capped so the widget cannot break at any N; keeps the approved register aesthetic and the inflow-above/outflow-below convention already in the code.
Cons: loses per-transaction granularity inside a day, which is acceptable for a dashboard widget whose drill-down target is `/transactions`.

### Option C: register drawn on a balance line

Option B, plus the dots sit at their date on an actual step line of the running balance instead of on a flat baseline.
The flat axis becomes a real y-scale.

Pros: everything in Option B, and the widget finally delivers what its title promises; the shape of the month, including any dip toward zero, becomes visible; it subsumes the "Running balance" mismatch rather than leaving it open.
Cons: largest change of the three, needs a y-scale and `--viz-*` palette review, and it re-opens a design that was approved from a mockup.

### Recommendation

**Ship Option B now, and treat Option C as the follow-up worth taking.**

Option B is bounded, preserves an approved design, and makes the widget structurally unbreakable rather than merely tuned.
Option C is the better end state and should be a deliberate design decision rather than something smuggled in under a bug fix.

### Implementation constraint to respect

`LedgerStrip`, `OverviewView`, `Panel`, and `Money` are all **server components**; none declares `"use client"`.
Runtime text measurement is therefore unavailable, so label selection must be deterministic and computed server-side, not measured in the browser.

This is workable and does not require a client component.
Compute a `labelTier` per column on the server (rank order), emit it as a data attribute or class, and let CSS reveal tier 1 at mobile, tiers 1 to 2 at `md`, tiers 1 to 3 at `lg`.
That keeps the widget a zero-JS server component while making the label budget responsive.

---

## HIGH-2: "applied app-wide" is not accurate

The PR title claims the register visual language is applied app-wide.
Two significant surfaces are not converted.

- **Mobile transactions list** drops day-group headers and day subtotals entirely and renders as a plain card list (`11-register-mobile.png`).
- **Reports, "Transactions in this report"** is still the pre-existing plain table, with a Direction column, no day grouping, and no subtotals (`08-reports-light.png`).

Either convert them, or narrow the claim in the PR description to the surfaces actually covered.

---

## MEDIUM issues

### M-1: the date is printed twice on every row

The day-group header shows `Aug 26, 2026` and then every row beneath it repeats `Aug 26, 2026` in the DATE column (`02b-transactions-top.png`).
A register prints the date once per group; repeating it is exactly the redundancy grouping was introduced to remove.

### M-2: day subtotals do not share a decimal edge with the amounts they total

The `-$88.24 net` subtotal sits flush to the table's right edge, while row amounts sit roughly 70px to its left because the "Add" action occupies the far-right lane on data rows.
Totals and the line items they summarise therefore do not align on a decimal edge, which is the single thing a statement register must get right.

### M-3: single-transaction days get a redundant subtotal row

Most days have one transaction, so most day groups render a `net` row that restates the amount immediately below it.
Suppress the subtotal when a group holds one entry.

### M-4: zebra striping does not reset per day group

The alternating row background runs continuously through group headers, so the bands do not align with the day groups they are meant to organise.

### M-5: the amount column is a uniform wall of red

Under the "positive equals money out" convention roughly 95 percent of rows are outflows, so nearly every amount renders in `--viz-neg` and colour stops carrying information.
Consider reserving saturated colour for inflows and outliers and letting ordinary outflows use the default text colour, with the sign and alignment doing the work.

### M-6: Reports shows raw category enums

`RENT_AND_UTILITIES`, `FOOD_AND_DRINK`, and `GENERAL_MERCHANDISE` appear unhumanised, while every other surface shows "Rent And Utilities" (`08-reports-light.png`).

---

## LOW issues

### L-1 (retracted): empty "Filters" card on `/accounts`

The screenshot shows the closed `AccountsFilters` disclosure, not an empty card.
`components/accounts/AccountsFilters.tsx` intentionally uses a collapsed `<details>` element, and `tests/e2e/accounts.spec.ts` exercises opening it, filtering, preferences, keyboard reachability, and touch-target sizing.
No remediation is required.

### L-2: Forecasting prints a degenerate range

"In 12 months, base case: $18,334.37 ($18,334.37 to $18,334.37)" (`07-forecasting-light.png`).
All three scenario lines also render exactly overlapped when investments are $0, so the legend advertises three series that are visually one.
Suppress the parenthetical when the bounds are equal, and consider collapsing the legend in the degenerate case.

### L-3: unbalanced dashboard columns

At 1440px the left column (Budget, Net worth, Goals) ends roughly 600px above the right column, leaving a large blank area (`04-dashboard-37entries.png`).
Most visible when the empty states are short, which is exactly a new user's first impression.

### L-4: net-worth empty state reserves a large blank band

"More daily snapshots are needed before a trend can be drawn" sits in a tall empty region on `/accounts` (`03-accounts-light.png`).

### L-5 (retracted as a contrast defect): dark-mode subtotal contrast

The current dark `--viz-neg` value `#f08a87` measures 6.59:1 against the dark panel `#222221`.
The light pair `#b42318` against `#ffffff` measures 6.57:1.
Both clear the WCAG AA 4.5:1 threshold for small text.
`scripts/validate_palette.js` checks the numbered chart palette and does not currently validate `--viz-neg`, so the earlier suggested gate was not applicable.
The broader concern that red is overused remains M-5, but contrast itself is not a defect.

---

## Why this reached a preview deploy, and how to stop the next one

Two independent gaps, both cheap to close, and both more valuable than the individual fixes above.

### Cause 1: the demo fixture cannot produce a dense strip

`buildDemoDataset` puts only the twice-monthly paycheck and the monthly rent on the depository account (`accountIndex: 0`), and routes every other transaction to the credit card (`accountIndex: 1`) (`lib/demo-data.ts:79-114`).
`pickAnchorAccount` anchors the strip to a `type === "depository"` account only (`lib/ledger-strip.ts:47-77`).

The demo dataset therefore yields **exactly three ticks per month, permanently**.
Every screenshot, every visual baseline, and every manual review of this widget has been conducted at N=3.
The widget was never once seen at a density a real user will hit on day one.

Fix: give the demo dataset realistic depository volume, on the order of 30 to 40 checking transactions per month, including at least one day carrying five or more.

### Cause 2: the render tests max out at two ticks

`tests/unit/ledger-strip-render.test.ts` renders one or two ticks in every case.
No test asserts anything about behaviour at volume, so the suite is structurally incapable of catching this class of defect.

Fix: add cases at 40 and 150 ticks asserting the invariants the fix introduces, namely that mark count stays bounded by days in month and permanently-labelled count stays within the per-breakpoint budget.

### Cause 3, process: the mockup was approved at hand-picked density

The design spec records that the mockup hand-picked which ticks were major, and that the implementation replaced this with a rule (`docs/superpowers/specs/2026-08-24-dashboard-ledger-strip-design.md`, deviation 4).
The mockup never displayed real density, so approval carried no information about the case that fails.

Worth adopting as a habit: any approved mockup of a data-driven element should be re-rendered against a realistic-volume fixture before the design is considered settled.

---

## Suggested sequencing

1. Fix the demo fixture density (Cause 1) **first**, so every subsequent change is reviewed against realistic data.
2. Add the failing high-volume render tests (Cause 2), confirm they fail.
3. Implement Option B for the Ledger Strip, confirm the tests pass.
4. Sweep the register table issues M-1 through M-4, which are small and share one component.
5. Decide explicitly on HIGH-2: convert mobile and Reports, or narrow the PR claim.
6. Fix M-6, L-2, and L-4 as focused, testable follow-ups.
7. Make explicit product decisions on M-5 and L-3 rather than treating them as mechanical bugs.
8. Leave retracted L-1 and L-5 unchanged.
9. Take the remaining non-blocking polish as a separate pass.
10. Re-run the responsive matrix and regenerate visual baselines, which will now be meaningful because the fixture has volume.

---

## Feasibility audit against the current PR head

This section was added after checking PR #134 at `10da1563869faab0c856ad5141a38319ed3d4ba4`, the current working tree, the saved QA screenshots, and the existing unit and browser tests.

### Confirmed and directly implementable

- HIGH-1 is confirmed in `LedgerStrip.tsx`, and Option B is feasible after the corrections captured in `2026-08-28-ledgerstrip-day-bucketed-fix.md`.
- HIGH-2 is confirmed because `MobileLedgerList.tsx` has no group model and `ReportTransactions.tsx` is still a plain row table.
- M-1 through M-4 are confirmed in `LedgerTableRow` inside `app/transactions/page.tsx`.
- M-6 is confirmed because `ReportTransactions.tsx` renders `row.categoryKey` directly.
- L-2 is confirmed in `app/forecasting/page.tsx` and `components/forecasting/ForecastChart.tsx` when the starting investment balance is zero.
- L-4 is confirmed in the `HistoryChart` empty branch in `components/accounts/NetWorthHero.tsx`.

### Confirmed observations that require a product choice

- M-5 is visually real, but changing the color hierarchy is a design choice rather than a data or accessibility correction.
- L-3 is visually real, but `DashboardWidgetGrid.tsx` deliberately assigns fixed widget ownership to left and right columns.
  Automatically moving widgets to fill space would change ordering and customization semantics, so this should not be implemented as incidental cleanup.
- HIGH-2 has an explicit scope choice.
  Keeping “applied app-wide” requires converting mobile Transactions and Reports before merge readiness.
  Narrowing the PR title and description makes the missing conversions non-blocking.

### Retracted

- L-1 is the intentional collapsed Accounts filter disclosure.
- L-5 passes small-text contrast in both themes.

## Missing remediation plans

### Plan A: desktop register corrections for M-1 through M-4

Files:

- `app/transactions/page.tsx`
- The focused transaction render tests that cover the page or an extracted row component.
- `tests/e2e/transactions.spec.ts`

Implementation:

1. Compute each visible row's index within its date group and the visible count for that date when `shouldShowLedgerDayGroups(state.sort)` is true.
2. Keep the date available to assistive technology but suppress the repeated visible date text in grouped rows.
3. Continue rendering the normal DATE cell when the active sort disables day grouping.
4. Render group headers with real table cells rather than one full-width `colSpan`.
   The date label should span the descriptive columns, the net should occupy the exact amount column, and the editor lane should receive an empty cell.
5. Suppress the net value when the complete date group contains one transaction.
6. Reset zebra striping from zero within every date group.
7. Preserve continuous zebra striping when day grouping is disabled.
8. Detect a date group split by the 50-row page boundary.
   Fetch one neighboring row on each side in the direct-query path, and inspect the full projected scope in the projected path.
   Keep the date header but suppress the net when the group is incomplete so a partial page sum is never presented as a daily total.

Acceptance:

- Grouped rows show one visible date per day.
- Multi-row day totals share the amount column's decimal edge.
- Single-row days have no redundant net value.
- Zebra striping restarts per day.
- Non-date sorts still show a date on every row and do not show day subtotals.
- A day split across pages never shows a partial value labelled as the daily net.

Add unit coverage for one-row days, multi-row days, optional category and account columns, non-date sorts, excluded duplicates, and page-boundary groups.
Add browser assertions at desktop width before updating the Transactions visual baseline.

### Plan B: HIGH-2 scope gate

Do not start implementation until one of these mutually exclusive outcomes is selected.

#### Outcome 1: retain the app-wide claim

Mobile Transactions:

- Extend `MobileLedgerList.tsx` to accept whether day grouping is active plus the same complete-group count and net metadata used by the desktop table.
- Render a date header before each group, omit the repeated date from each card's metadata, suppress single-row net values, and restart zebra striping per group.
- Preserve the current flat card list for merchant and amount sorts.
- Add focused coverage in `tests/unit/mobile-ledger-list.test.ts` and browser coverage in `tests/e2e/transactions.spec.ts` at 390px.

Reports:

- Convert `ReportTransactions.tsx` to date groups while preserving its server-rendered URL pagination.
- Use the full filtered transaction array to detect groups split by a report page boundary and suppress incomplete-page net values.
- Replace the Direction column with an explicit signed amount and an accessible direction label so sign is not the only cue.
- Humanize `categoryKey` with the existing `titleCase` formatter.
- Align group nets with the report amount column and suppress nets for complete one-row groups.
- Add focused coverage in `tests/unit/report-transactions-render.test.ts`, update the responsive contract test, and add browser acceptance in `tests/e2e/reports.spec.ts`.

Acceptance:

- The 390px Transactions list and the Reports row surface both show the same date-group and subtotal hierarchy as the desktop register.
- Reports no longer exposes raw category enums.
- Pagination does not create false daily totals.
- Light and dark visual baselines pass at desktop and mobile widths.

#### Outcome 2: narrow the claim

- Change the PR title so it names the surfaces actually converted.
- Update the PR summary and test plan to state that mobile Transactions and Reports retain their existing presentation.
- Keep HIGH-2 as a documented follow-up with its own issue or plan.
- Do not call the rollout app-wide anywhere in the PR body or release notes.

### Plan C: M-5 color hierarchy decision

Recommended direction: render ordinary outflows in the default foreground color and reserve `--viz-pos` for inflows.
Do not introduce an arbitrary “outlier” dollar threshold in this pass.
Keep signs, tabular alignment, daily nets, pending state, and duplicate state as the primary cues.

Apply the same decision to desktop Transactions, `MobileLedgerList.tsx`, `ReportTransactions.tsx`, and any shared register row used by the rollout.
Update unit tests that currently require `--viz-neg` on every expense.
Compare light and dark screenshots with a long expense-heavy month before accepting the change.

If the existing red-outflow convention is retained, mark M-5 as an accepted design tradeoff rather than leaving it as an unresolved implementation task.

### Plan D: M-6 report category labels

Use `titleCase(row.categoryKey)` in `ReportTransactions.tsx`, with `Unknown` retained for an empty key.
Add cases for `RENT_AND_UTILITIES`, `GENERAL_MERCHANDISE`, and an empty category in `tests/unit/report-transactions-render.test.ts`.
This can ship independently of the HIGH-2 register conversion.

### Plan E: L-2 degenerate forecasting scenarios

Files:

- `app/forecasting/page.tsx`
- `components/forecasting/ForecastChart.tsx`
- Focused forecasting render tests.

Implementation:

1. Suppress the parenthetical range when the rounded conservative and optimistic ending values are equal.
2. Detect whether all three values are equal at every point in the rendered series.
3. When the full series is degenerate, render one Base line and one legend item instead of three coincident lines.
4. Add a short explanation that scenarios overlap because no investment balance is currently affected by the return-rate spread.
5. Keep the full three-column screen-reader table only when scenarios differ.

Acceptance:

- A zero-investment fixture does not print an equal-to-equal range or advertise three visually identical series.
- A nonzero-investment fixture retains all three series, legend items, range values, and accessible table columns.

### Plan F: L-3 dashboard column balance decision

No automatic balancing implementation is approved by this note.
The current fixed-column ownership is explicit in `DashboardWidgetGrid.tsx` and preserves predictable customization order.

Choose one of these before writing code:

- Accept unequal column endings as the cost of stable widget ownership and retract L-3 as a defect.
- Redesign the overview as one ordered responsive grid and define how saved order maps across desktop and mobile.

Do not move widgets opportunistically based on empty-state height because the layout would jump as data changes and would no longer match the saved order contract.

### Plan G: L-4 compact net-worth empty state

Reduce the vertical padding in the fewer-than-two-points branch of `HistoryChart` and keep the daily balance disclosure directly below the message.
Do not reserve the normal chart height when no chart can be drawn.
Add a render test for zero, one, and two snapshot points, then verify the Accounts page at 1440px and 390px in both themes.

## Final verification gate

After the selected plans are implemented, run `npm run lint`, `npx tsc --noEmit`, `npm test`, and `npm run build`.
Run `graphify update .` after code changes.
Run the existing Dashboard, Transactions, Reports, Accounts, and Forecasting browser suites against a disposable user loaded through `POST /api/demo`.
Repeat the 1440px, 768px, and 390px light and dark matrix with console errors, page errors, failed requests, failed responses, document overflow, card overflow, clipped text, and label intersections treated as failures.
Regenerate visual baselines only after the behavioral and geometry assertions pass.
