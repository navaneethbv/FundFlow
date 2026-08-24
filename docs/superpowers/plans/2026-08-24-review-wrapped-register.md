# Review and Wrapped Register Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the real gaps deep research found on `app/review/page.tsx` and
`app/wrapped/page.tsx`: money figures missing `data-money`/color-token compliance,
and date/period labels never getting `font-mono`. Both pages are entirely inline
JSX in their `page.tsx` file — no `components/review/` or `components/wrapped/`
directory exists.

**Architecture:** Both files are async Server Components (no client-side test
harness exists for either — `tests/unit/monthly-review-ui.test.ts` already tests
`app/review/page.tsx` via raw source-string assertions rather than rendering it,
and no test file exists for `app/wrapped/page.tsx` at all). This plan follows the
same pattern for its own assertions: extend `monthly-review-ui.test.ts` with new
source-string checks, and create a new `tests/unit/wrapped-page-ui.test.ts` using
the identical technique. `RegisterRow` is not used anywhere in this plan — deep
research confirmed neither page has a genuinely flat, chronologically-ordered list
(Review's three blocks are status/priority-sorted; Wrapped has no row list at all,
only `StatTile`s, a shared `BarList`, and a highlight-card grid).

**Tech Stack:** Next.js 16 App Router, TypeScript, Tailwind 4, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-24-app-wide-register-design.md` — read
the "Phase 7/8/9 decisions" section before starting: it documents why Review's top
tiles are in scope (user decision, folded in) and why Wrapped's `StatTile` delta
color is explicitly *not* touched (a trend indicator, not a money direction).

## Global Constraints

- `--viz-pos`/`--viz-neg` are the money-direction colors; `--success`/`--danger`
  (and their Tailwind classes `text-success`/`text-danger`) are status-semantic and
  not to be used for inflow/outflow.
- `font-mono` is reserved for labels/dates/eyebrows, never money.
- Every money figure must carry `.money`, `.metric-value`, or `data-money`, or it
  silently escapes the privacy-blur toggle.
- No new CSS custom properties, no new fonts, no changes to `docs/PALETTE.md` or
  `scripts/validate_palette.js`.
- Neither page has a client-side test harness — new assertions are raw
  `readFileSync` + string-`toContain` checks against the page source, matching
  `monthly-review-ui.test.ts`'s existing style, not `renderToStaticMarkup`.
- `npx vitest run <file>` for one test file; `npm run test:unit` for the suite;
  `npx tsc --noEmit`; `npm run build`; `npm run lint`.

---

### Task 1: `app/review/page.tsx` — money-direction color, `data-money` gaps

**Files:**
- Modify: `app/review/page.tsx`
- Modify: `tests/unit/monthly-review-ui.test.ts`

**Interfaces:** None new. `net`, `budgetIssues`, `goalsSummary` are unchanged
local variables computed the same way.

- [ ] **Step 1: Write the failing tests**

Replace `tests/unit/monthly-review-ui.test.ts` in full:

```ts
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("monthly review UI", () => {
  it("adds a review page and dashboard entry point", () => {
    expect(existsSync("app/review/page.tsx")).toBe(true);

    const review = readFileSync("app/review/page.tsx", "utf8");
    const dashboard = readFileSync("app/dashboard/page.tsx", "utf8");
    const toolbar = readFileSync("components/dashboard/DashboardToolbar.tsx", "utf8");

    // The page's own header title carries the period (V1 shell restructure
    // dropped the separate "Monthly Review" eyebrow label in favor of a
    // single PageHeader title, matching every other page).
    expect(review).toContain("PageHeader");
    expect(review).toContain("formatMonth(data.selectedMonth)} review");
    expect(review).toContain("getDashboardData");
    expect(review).toContain("getGoals");
    expect(dashboard).toContain("DashboardToolbar");
    expect(toolbar).toContain("/review?");
  });

  it("colors the top Income/Spending/Net tiles with the money-direction tokens, not status-semantic classes", () => {
    const review = readFileSync("app/review/page.tsx", "utf8");
    expect(review).toContain('style={{ color: "var(--viz-pos)" }}');
    expect(review).toContain('style={{ color: "var(--viz-neg)" }}');
    expect(review).toContain('net >= 0 ? "var(--viz-pos)" : "var(--viz-neg)"');
    expect(review).not.toContain("text-success");
    expect(review).not.toContain("text-danger");
  });

  it("wraps every money figure in the budget review and goals review blocks with data-money", () => {
    const review = readFileSync("app/review/page.tsx", "utf8");
    // Budget review: projectedSpend, monthlyLimit, remaining. Goals review:
    // remainingAmount. Plus the three top tiles and the pre-existing net
    // figure: 8 data-money occurrences total.
    const occurrences = review.match(/data-money/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(8);
  });

  it("colors budget projectedSpend and remaining with the money-direction tokens", () => {
    const review = readFileSync("app/review/page.tsx", "utf8");
    expect(review).toContain('budget.remaining >= 0 ? "var(--viz-pos)" : "var(--viz-neg)"');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/monthly-review-ui.test.ts`
Expected: FAIL — the three new tests fail (current code has `text-success`,
no `var(--viz-pos)`/`var(--viz-neg)`, and only 1 `data-money` occurrence).

- [ ] **Step 3: Write the implementation**

In `app/review/page.tsx`, change the top summary tiles:

```tsx
      <div className="grid gap-4 md:grid-cols-3">
        <Panel title="Income">
          <p className="money display text-3xl text-success">{formatCurrency(data.currentMonthIncome)}</p>
        </Panel>
        <Panel title="Spending">
          <p className="money display text-3xl">{formatCurrency(data.currentMonthExpenses)}</p>
        </Panel>
        <Panel title="Net">
          <p data-money className={net >= 0 ? "display text-3xl text-success" : "display text-3xl text-danger"}>
            {net >= 0 ? "+" : ""}
            {formatCurrency(net)}
          </p>
        </Panel>
      </div>
```

to:

```tsx
      <div className="grid gap-4 md:grid-cols-3">
        <Panel title="Income">
          <p className="money display text-3xl" style={{ color: "var(--viz-pos)" }}>
            {formatCurrency(data.currentMonthIncome)}
          </p>
        </Panel>
        <Panel title="Spending">
          <p className="money display text-3xl" style={{ color: "var(--viz-neg)" }}>
            {formatCurrency(data.currentMonthExpenses)}
          </p>
        </Panel>
        <Panel title="Net">
          <p
            data-money
            className="display text-3xl"
            style={{ color: net >= 0 ? "var(--viz-pos)" : "var(--viz-neg)" }}
          >
            {net >= 0 ? "+" : ""}
            {formatCurrency(net)}
          </p>
        </Panel>
      </div>
```

Change the Budget review block:

```tsx
        <Panel title="Budget review" eyebrow="Envelope status">
          <div className="space-y-3 text-sm">
            {budgetIssues.map((budget) => (
              <div key={budget.category} className="rounded-field bg-panel-2 p-3">
                <div className="flex justify-between gap-3 font-semibold">
                  <span>{titleCase(budget.category)}</span>
                  <span>{formatCurrency(budget.projectedSpend)} projected</span>
                </div>
                <p className="mt-1 text-xs text-muted">
                  Limit {formatCurrency(budget.monthlyLimit)}, remaining {formatCurrency(budget.remaining)}
                </p>
              </div>
            ))}
            {budgetIssues.length === 0 && (
              <p className="py-4 text-sm text-muted">No budget categories are projected over limit.</p>
            )}
          </div>
        </Panel>
```

to:

```tsx
        <Panel title="Budget review" eyebrow="Envelope status">
          <div className="space-y-3 text-sm">
            {budgetIssues.map((budget) => (
              <div key={budget.category} className="rounded-field bg-panel-2 p-3">
                <div className="flex justify-between gap-3 font-semibold">
                  <span>{titleCase(budget.category)}</span>
                  <span data-money style={{ color: "var(--viz-neg)" }}>
                    {formatCurrency(budget.projectedSpend)} projected
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted">
                  Limit <span data-money>{formatCurrency(budget.monthlyLimit)}</span>, remaining{" "}
                  <span
                    data-money
                    style={{ color: budget.remaining >= 0 ? "var(--viz-pos)" : "var(--viz-neg)" }}
                  >
                    {formatCurrency(budget.remaining)}
                  </span>
                </p>
              </div>
            ))}
            {budgetIssues.length === 0 && (
              <p className="py-4 text-sm text-muted">No budget categories are projected over limit.</p>
            )}
          </div>
        </Panel>
```

Change the Goals review block:

```tsx
        <Panel title="Goals review" eyebrow="Pace">
          <div className="space-y-3 text-sm">
            {goalsSummary.map((goal) => (
              <div key={goal.goal.id} className="flex justify-between gap-4 rounded-field bg-panel-2 p-3">
                <span>
                  <span className="block font-semibold">{goal.goal.name}</span>
                  <span className="block text-xs text-muted">{goal.status}</span>
                </span>
                <span className="font-bold">{formatCurrency(goal.remainingAmount)} left</span>
              </div>
            ))}
            {goalsSummary.length === 0 && <p className="py-4 text-sm text-muted">No active goals yet.</p>}
          </div>
        </Panel>
```

to:

```tsx
        <Panel title="Goals review" eyebrow="Pace">
          <div className="space-y-3 text-sm">
            {goalsSummary.map((goal) => (
              <div key={goal.goal.id} className="flex justify-between gap-4 rounded-field bg-panel-2 p-3">
                <span>
                  <span className="block font-semibold">{goal.goal.name}</span>
                  <span className="block text-xs text-muted">{goal.status}</span>
                </span>
                <span data-money className="font-bold">
                  {formatCurrency(goal.remainingAmount)} left
                </span>
              </div>
            ))}
            {goalsSummary.length === 0 && <p className="py-4 text-sm text-muted">No active goals yet.</p>}
          </div>
        </Panel>
```

The "Notable changes" block (anomalies) is unchanged — it renders only
`anomaly.message`, a free-text sentence with no money or date figure of its own to
wrap.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/monthly-review-ui.test.ts`
Expected: PASS, all 4 tests.

- [ ] **Step 5: Commit**

```bash
git add app/review/page.tsx tests/unit/monthly-review-ui.test.ts
git commit -m "fix: apply money-direction color and close data-money gaps on the Review page"
```

---

### Task 2: `app/wrapped/page.tsx` — `font-mono` labels, `data-money` gap

**Files:**
- Modify: `app/wrapped/page.tsx`
- Create: `tests/unit/wrapped-page-ui.test.ts`

**Interfaces:** None new.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/wrapped-page-ui.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("wrapped page UI", () => {
  const wrapped = readFileSync("app/wrapped/page.tsx", "utf8");

  it("sets the year chips in the mono face", () => {
    expect(wrapped).toMatch(/inline-flex min-h-11 items-center rounded-field bg-accent-soft px-2\.5 text-accent font-mono/);
    expect(wrapped).toMatch(/inline-flex min-h-11 items-center rounded-field px-2\.5 text-muted transition-colors hover:bg-panel-hover hover:text-foreground font-mono/);
  });

  it("sets the highlight-card month and date labels in the mono face", () => {
    const monoMonthSpans = wrapped.match(/className="mt-1 block font-semibold font-mono"/g) ?? [];
    expect(monoMonthSpans.length).toBe(2); // biggestMonth, quietestMonth
    expect(wrapped).toContain('className="mt-1 block truncate font-semibold"');
    expect(wrapped).toContain('className="block text-xs text-muted font-mono"');
  });

  it("carries the highlight-card money figures inside the privacy-blur hook", () => {
    const dataMoneyMetricValue = wrapped.match(/data-money className="metric-value text-sm"/g) ?? [];
    expect(dataMoneyMetricValue.length).toBe(3); // biggestMonth, quietestMonth, largestPurchase
  });

  it("leaves StatTile's period-over-period delta untouched, since it is a trend indicator, not a money direction", () => {
    // StatTile.tsx itself is out of scope for this plan — this just documents
    // intent by confirming the page doesn't attempt to override it inline.
    expect(wrapped).not.toContain("viz-pos");
    expect(wrapped).not.toContain("viz-neg");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/wrapped-page-ui.test.ts`
Expected: FAIL — the mono/data-money assertions fail against the current
unmodified markup.

- [ ] **Step 3: Write the implementation**

In `app/wrapped/page.tsx`, change the year chips:

```tsx
            {yearChips.map((chip) => (
              <Link
                key={chip}
                href={`/wrapped?year=${chip}`}
                aria-current={chip === year ? "true" : undefined}
                className={
                  chip === year
                    ? "inline-flex min-h-11 items-center rounded-field bg-accent-soft px-2.5 text-accent"
                    : "inline-flex min-h-11 items-center rounded-field px-2.5 text-muted transition-colors hover:bg-panel-hover hover:text-foreground"
                }
              >
                {chip}
              </Link>
            ))}
```

to:

```tsx
            {yearChips.map((chip) => (
              <Link
                key={chip}
                href={`/wrapped?year=${chip}`}
                aria-current={chip === year ? "true" : undefined}
                className={
                  chip === year
                    ? "inline-flex min-h-11 items-center rounded-field bg-accent-soft px-2.5 text-accent font-mono"
                    : "inline-flex min-h-11 items-center rounded-field px-2.5 text-muted transition-colors hover:bg-panel-hover hover:text-foreground font-mono"
                }
              >
                {chip}
              </Link>
            ))}
```

Change the highlight-card grid:

```tsx
          <Panel title="The shape of your year" eyebrow="Highlights">
            <div className="grid gap-3 text-sm sm:grid-cols-3">
              {recap.biggestMonth && (
                <div className="rounded-field bg-panel-2 p-3">
                  <span className="block text-xs text-muted">Your biggest month</span>
                  <span className="mt-1 block font-semibold">
                    {formatMonth(recap.biggestMonth.month)}
                  </span>
                  <span className="metric-value text-sm">
                    {formatCurrency(recap.biggestMonth.spend)}
                  </span>
                </div>
              )}
              {recap.quietestMonth && (
                <div className="rounded-field bg-panel-2 p-3">
                  <span className="block text-xs text-muted">Your quietest month</span>
                  <span className="mt-1 block font-semibold">
                    {formatMonth(recap.quietestMonth.month)}
                  </span>
                  <span className="metric-value text-sm">
                    {formatCurrency(recap.quietestMonth.spend)}
                  </span>
                </div>
              )}
              {recap.largestPurchase && (
                <div className="rounded-field bg-panel-2 p-3">
                  <span className="block text-xs text-muted">Largest purchase</span>
                  <span className="mt-1 block truncate font-semibold">
                    {recap.largestPurchase.merchant}
                  </span>
                  <span className="metric-value text-sm">
                    {formatCurrency(recap.largestPurchase.amount)}
                  </span>
                  <span className="block text-xs text-muted">
                    {formatDate(recap.largestPurchase.date)}
                  </span>
                </div>
              )}
            </div>
          </Panel>
```

to:

```tsx
          <Panel title="The shape of your year" eyebrow="Highlights">
            <div className="grid gap-3 text-sm sm:grid-cols-3">
              {recap.biggestMonth && (
                <div className="rounded-field bg-panel-2 p-3">
                  <span className="block text-xs text-muted">Your biggest month</span>
                  <span className="mt-1 block font-semibold font-mono">
                    {formatMonth(recap.biggestMonth.month)}
                  </span>
                  <span data-money className="metric-value text-sm">
                    {formatCurrency(recap.biggestMonth.spend)}
                  </span>
                </div>
              )}
              {recap.quietestMonth && (
                <div className="rounded-field bg-panel-2 p-3">
                  <span className="block text-xs text-muted">Your quietest month</span>
                  <span className="mt-1 block font-semibold font-mono">
                    {formatMonth(recap.quietestMonth.month)}
                  </span>
                  <span data-money className="metric-value text-sm">
                    {formatCurrency(recap.quietestMonth.spend)}
                  </span>
                </div>
              )}
              {recap.largestPurchase && (
                <div className="rounded-field bg-panel-2 p-3">
                  <span className="block text-xs text-muted">Largest purchase</span>
                  <span className="mt-1 block truncate font-semibold">
                    {recap.largestPurchase.merchant}
                  </span>
                  <span data-money className="metric-value text-sm">
                    {formatCurrency(recap.largestPurchase.amount)}
                  </span>
                  <span className="block text-xs text-muted font-mono">
                    {formatDate(recap.largestPurchase.date)}
                  </span>
                </div>
              )}
            </div>
          </Panel>
```

Note the merchant name (`recap.largestPurchase.merchant`) does **not** get
`font-mono` — it's a label naming a place, not a date, and rule 1 only reserves
mono for labels/dates/eyebrows in the sense of the register motif's own
vocabulary (category and merchant names elsewhere in the app are never mono
either — see `RegisterRow`, `RecentActivity`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/wrapped-page-ui.test.ts`
Expected: PASS, all 4 tests.

- [ ] **Step 5: Commit**

```bash
git add app/wrapped/page.tsx tests/unit/wrapped-page-ui.test.ts
git commit -m "fix: apply font-mono to Wrapped's date/period labels and close a data-money gap"
```

---

### Task 3: Full verification and manual QA

**Files:** None (verification only).

- [ ] **Step 1: Full automated verification**

Run in order:

```bash
npm run lint
npx tsc --noEmit
npm run test:unit
npm run build
```

All four must pass clean.

- [ ] **Step 2: Manual browser check**

```bash
npm run dev
```

Open `/review` for a month with at least one over-budget category and one active
goal. Confirm:

- Income tile green, Spending tile red (new — it was uncolored before), Net tile
  green/red by sign.
- Budget review: "projected" figure red, "remaining" green when under budget / red
  when over.
- Goals review: "left" figure uncolored (no direction implied), still legible.
- Notable changes block unchanged.
- Toggle the privacy-blur setting and confirm every money figure on the page
  (including the newly-wrapped ones) blurs.

Open `/wrapped` for a year with real transaction history. Confirm:

- Year chips render in the mono face.
- Highlight cards: month labels and the largest-purchase date are mono; money
  figures unchanged in appearance but now blur under the privacy toggle.
- `StatTile`'s Total spent/Total income figures and their delta arrows are
  visually unchanged.
- Dark mode: both pages read correctly.

- [ ] **Step 3: Stop the dev server**

Stop the `npm run dev` process once manual QA is complete.
