# Investments Register Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the app's statement-register visual language to the Investments page. Unlike Transactions/Reports, this page has no per-row dates anywhere (holdings aren't dated transactions), so the "mono dates" rule mostly doesn't apply here — the real, uniform gap on this page is money-direction coloring: every single gain/loss figure on `/investments` (page-level day change, `HoldingsTable`'s per-holding change, `TopMovers`' change%, `PerformanceChart`'s performance figure) currently uses `text-success`/`text-danger` instead of `--viz-pos`/`--viz-neg`. Research also surfaced two real privacy-blur gaps (money figures missing `data-money`) that get fixed alongside, per this rollout's established "fix it when you see it" precedent (the dashboard's `BudgetWidget` fix, Phase 1's raw-date fix).

**Architecture:** `HoldingsTable` is a `<table>`, not a `<ul>` — same as the Transactions/Reports tables, not a `RegisterRow` fit, styled directly. `TopMovers` and `AllocationView` are genuine `<ul>`/`<li>` lists but neither is transaction-shaped (no date, and `AllocationView`'s rows aren't even directional — allocation weight isn't a gain/loss), so neither adopts `RegisterRow` either; both get the color/`data-money` fixes applied directly, and `TopMovers` additionally gets zebra striping (a flat, undifferentiated list, same shape class as the lists earlier phases zebra-striped). `AllocationView` and `HoldingsTable` explicitly do **not** get zebra striping — see the per-task rationale, both already have their own visual row-differentiation (a colored allocation dot per row; asset-class group headers) that zebra would either collide with or duplicate.

**Tech Stack:** Next.js 16 App Router, TypeScript, Tailwind 4, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-24-app-wide-register-design.md` — the full symmetric `--viz-pos`/`--viz-neg` adoption already established for Transactions/Reports applies here the same way; this page had zero prior partial adoption of the tokens to reconcile (confirmed: `var(--viz-pos)`/`var(--viz-neg)` occur nowhere in `components/investments/` or `app/investments/page.tsx` today), so there's no debit-color-style judgment call to make here — every gain/loss figure moves uniformly.

## Global Constraints

- `--viz-pos`/`--viz-neg` replace `text-success`/`text-danger` for every gain/loss figure on this page. `AddManualHoldingForm.tsx`'s `text-danger` on a form-validation error message is unrelated (a status color, not a money-direction one) and must not be touched.
- Every money figure must carry `.money`, `.metric-value`, or `data-money`. This plan adds the attribute to two figures that currently lack it (`HoldingsTable`'s group-subtotal row, `PerformanceChart`'s performance/balance figure) and to `AllocationView`'s class-subtotal figure (also currently missing it) — closing real privacy-blur gaps, not a stylistic choice.
- No `RegisterRow` adoption anywhere on this page — see Architecture above for why, per file.
- No new CSS custom properties, no new fonts, no changes to `docs/PALETTE.md` or `scripts/validate_palette.js`. `--viz-pos`/`--viz-neg` already exist; `--viz-1`..`--viz-6`/`--viz-ink-2` (used by `AllocationView`'s slot colors, unrelated to money direction) are untouched.
- `npx vitest run <file>` for one test file; `npm run test:unit` for the suite; `npx tsc --noEmit`; `npm run build`; `npm run lint`.

---

### Task 1: `HoldingsTable.tsx` — color fix, privacy-blur fix, no zebra

**Files:**
- Modify: `components/investments/HoldingsTable.tsx`
- Modify: `tests/unit/investments-render.test.ts` (the `describe("HoldingsTable", ...)` block only)

**Interfaces:** None new — `HoldingsTable`'s props (`page`, `currency`) are unchanged. The internal `changeClass` helper is replaced by two smaller helpers, `changeClassName` and `changeColor`, both file-local (not exported).

**Why no zebra here:** the asset-class group-header row already uses `bg-panel-2` to set itself apart from its group's holdings (`<tr className="border-b border-panel-border/60 bg-panel-2">`). Reusing `bg-panel-2` for zebra striping on the data rows underneath would collide with that existing meaning — the same shade would mean two different things in the same table. The table is already visually organized by asset-class groups, which serves the same "help the eye track rows" purpose zebra striping serves on an undifferentiated list elsewhere in this rollout. Adding zebra here would be noise, not signal.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/investments-render.test.ts`, replace the existing `it("colors a positive change green and a negative one red, never a raw hex", ...)` test (inside `describe("HoldingsTable", ...)`) with:

```ts
  it("colors a positive change with the positive diverging token, a negative one with the negative token", () => {
    const positive = renderToStaticMarkup(
      createElement(HoldingsTable, {
        page: page({ byClass: [{ label: "Funds", holdings: [holding({ periodChangePct: 2 })], subtotal: 2500 }] }),
        currency: "USD",
      }),
    );
    expect(positive).toContain("var(--viz-pos)");

    const negative = renderToStaticMarkup(
      createElement(HoldingsTable, {
        page: page({ byClass: [{ label: "Funds", holdings: [holding({ periodChangePct: -2 })], subtotal: 2500 }] }),
        currency: "USD",
      }),
    );
    expect(negative).toContain("var(--viz-neg)");
    expect(negative).not.toContain("text-success");
    expect(negative).not.toContain("text-danger");
  });

  it("marks the group subtotal row with the privacy-blur hook, alongside the per-holding value", () => {
    const html = renderToStaticMarkup(
      createElement(HoldingsTable, { page: page(), currency: "USD" }),
    );
    expect(html.match(/data-money/g)?.length).toBeGreaterThanOrEqual(2);
  });
```

(Every other existing test in this `describe` block — the avatar/ticker/Total-row test and the empty-state test — is unchanged.)

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `npx vitest run tests/unit/investments-render.test.ts -t "HoldingsTable"`
Expected: FAIL — the color test fails (current code emits `text-success`/`text-danger`, never `var(--viz-pos)`/`var(--viz-neg)`); the `data-money` count test fails (only 1 match today — the per-holding value cell — not 2, since the group-subtotal row lacks the attribute).

- [ ] **Step 3: Write the implementation**

In `components/investments/HoldingsTable.tsx`, change:

```tsx
function changeClass(periodChangePct: number | null): string {
  if (periodChangePct == null) return "text-muted";
  return periodChangePct >= 0 ? "text-success" : "text-danger";
}
```

to:

```tsx
function changeClassName(periodChangePct: number | null): string {
  return periodChangePct == null ? "text-muted" : "";
}

function changeColor(periodChangePct: number | null): string | undefined {
  if (periodChangePct == null) return undefined;
  return periodChangePct >= 0 ? "var(--viz-pos)" : "var(--viz-neg)";
}
```

Change:

```tsx
                <td colSpan={7} className="py-1.5 pr-3 text-xs font-semibold uppercase tracking-wide text-muted">
                  {group.label} · {formatCurrency(group.subtotal, currency)}
                </td>
```

to:

```tsx
                <td
                  data-money
                  colSpan={7}
                  className="py-1.5 pr-3 text-xs font-semibold uppercase tracking-wide text-muted"
                >
                  {group.label} · {formatCurrency(group.subtotal, currency)}
                </td>
```

Change:

```tsx
                  <td
                    data-money
                    className={cn(
                      "py-2 pr-0 text-right tabular-nums",
                      changeClass(h.periodChangePct),
                    )}
                  >
                    {changeLabel(h.periodChangePct)}
                  </td>
```

to:

```tsx
                  <td
                    data-money
                    className={cn(
                      "py-2 pr-0 text-right tabular-nums",
                      changeClassName(h.periodChangePct),
                    )}
                    style={{ color: changeColor(h.periodChangePct) }}
                  >
                    {changeLabel(h.periodChangePct)}
                  </td>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/investments-render.test.ts -t "HoldingsTable"`
Expected: PASS, all 4 tests in the `describe("HoldingsTable", ...)` block.

- [ ] **Step 5: Commit**

```bash
git add components/investments/HoldingsTable.tsx tests/unit/investments-render.test.ts
git commit -m "feat: apply diverging money-direction color to HoldingsTable and fix a privacy-blur gap"
```

---

### Task 2: `TopMovers.tsx` — color fix and zebra striping

**Files:**
- Modify: `components/investments/TopMovers.tsx`
- Modify: `tests/unit/investments-render.test.ts` (the `describe("TopMovers", ...)` block only)

**Interfaces:** None new — `TopMovers`'s props (`movers`) are unchanged.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/investments-render.test.ts`, replace the existing `describe("TopMovers", ...)` block with:

```ts
describe("TopMovers", () => {
  it("colors gains with the positive diverging token and losses with the negative one", () => {
    const html = renderToStaticMarkup(
      createElement(TopMovers, {
        movers: [
          { id: "up", name: "Up Co", ticker: "UP", changePct: 3.2 },
          { id: "dn", name: "Down Co", ticker: "DN", changePct: -1.1 },
        ],
      }),
    );
    expect(html).toContain("var(--viz-pos)");
    expect(html).toContain("var(--viz-neg)");
    expect(html).not.toContain("text-success");
    expect(html).not.toContain("text-danger");
  });

  it("zebra-stripes odd-indexed rows and not even-indexed ones", () => {
    const html = renderToStaticMarkup(
      createElement(TopMovers, {
        movers: [
          { id: "a", name: "A Co", ticker: "A", changePct: 1 },
          { id: "b", name: "B Co", ticker: "B", changePct: -1 },
        ],
      }),
    );
    const rows = html.split("<li").slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).not.toContain("bg-panel-2");
    expect(rows[1]).toContain("bg-panel-2");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/investments-render.test.ts -t "TopMovers"`
Expected: FAIL — the color test fails (current code emits `text-success`/`text-danger`); the zebra test fails (no zebra logic exists today).

- [ ] **Step 3: Write the implementation**

In `components/investments/TopMovers.tsx`, change:

```tsx
  return (
    <ul className="space-y-2">
      {movers.map((m) => (
        <li key={m.id} className="flex items-center justify-between text-sm">
          <span>
            {m.name}
            {m.ticker && <span className="ml-1 text-xs text-muted">{m.ticker}</span>}
          </span>
          <span
            data-money
            className={m.changePct >= 0 ? "tabular-nums font-medium text-success" : "tabular-nums font-medium text-danger"}
          >
            {m.changePct >= 0 ? "+" : ""}
            {m.changePct.toFixed(1)}%
          </span>
        </li>
      ))}
    </ul>
  );
```

to:

```tsx
  return (
    <ul className="space-y-2">
      {movers.map((m, index) => (
        <li
          key={m.id}
          className={`flex items-center justify-between rounded-field px-2 py-1 text-sm${
            index % 2 === 1 ? " bg-panel-2" : ""
          }`}
        >
          <span>
            {m.name}
            {m.ticker && <span className="ml-1 text-xs text-muted">{m.ticker}</span>}
          </span>
          <span
            data-money
            className="tabular-nums font-medium"
            style={{ color: m.changePct >= 0 ? "var(--viz-pos)" : "var(--viz-neg)" }}
          >
            {m.changePct >= 0 ? "+" : ""}
            {m.changePct.toFixed(1)}%
          </span>
        </li>
      ))}
    </ul>
  );
```

(Added `rounded-field px-2 py-1` to the row so the new zebra background has room to actually show, matching how every other zebra-striped row in this rollout carries its own padding rather than a bare full-bleed tint.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/investments-render.test.ts -t "TopMovers"`
Expected: PASS, both tests.

- [ ] **Step 5: Commit**

```bash
git add components/investments/TopMovers.tsx tests/unit/investments-render.test.ts
git commit -m "feat: apply diverging money-direction color and zebra striping to TopMovers"
```

---

### Task 3: `PerformanceChart.tsx` — color fix, privacy-blur fix, sr-only date formatting

**Files:**
- Modify: `components/investments/PerformanceChart.tsx`
- Modify: `tests/unit/investments-render.test.ts` (the `describe("PerformanceChart", ...)` block only)

**Interfaces:** None new — `PerformanceChart`'s props (`balanceHistory`, `returns`, `currency`) are unchanged.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/investments-render.test.ts`, replace the existing `describe("PerformanceChart", ...)` block with:

```ts
describe("PerformanceChart", () => {
  it("colors a positive time-weighted return with the positive diverging token", () => {
    const html = renderToStaticMarkup(
      createElement(PerformanceChart, {
        balanceHistory: [
          { date: "2026-06-01", value: 1000 },
          { date: "2026-07-01", value: 1100 },
        ],
        returns: [
          { date: "2026-06-01", pct: 0 },
          { date: "2026-07-01", pct: 5 },
        ],
        currency: "USD",
      }),
    );
    expect(html).toContain("var(--viz-pos)");
    expect(html).not.toContain("text-success");
  });

  it("carries the performance figure inside the privacy-blur hook", () => {
    const html = renderToStaticMarkup(
      createElement(PerformanceChart, {
        balanceHistory: [
          { date: "2026-06-01", value: 1000 },
          { date: "2026-07-01", value: 1100 },
        ],
        returns: [
          { date: "2026-06-01", pct: 0 },
          { date: "2026-07-01", pct: 5 },
        ],
        currency: "USD",
      }),
    );
    expect(html).toContain("data-money");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/investments-render.test.ts -t "PerformanceChart"`
Expected: FAIL — the color test fails (current code emits `text-success`); the `data-money` test fails (the performance figure carries no such attribute today at all).

- [ ] **Step 3: Write the implementation**

In `components/investments/PerformanceChart.tsx`, add the import:

```tsx
import { formatDate } from "@/lib/format-date";
```

alongside the existing imports at the top (after `import { formatCurrency } from "@/lib/format";`).

Change:

```tsx
  const latest = values.at(-1)!;
  let performanceClass = "";
  let performanceLabel = formatCurrency(latest, currency);
  if (sufficient) {
    performanceClass = latest >= 0 ? "text-success" : "text-danger";
    performanceLabel = `${latest >= 0 ? "+" : ""}${latest.toFixed(1)}%`;
  }
```

to:

```tsx
  const latest = values.at(-1)!;
  let performanceColor: string | undefined;
  let performanceLabel = formatCurrency(latest, currency);
  if (sufficient) {
    performanceColor = latest >= 0 ? "var(--viz-pos)" : "var(--viz-neg)";
    performanceLabel = `${latest >= 0 ? "+" : ""}${latest.toFixed(1)}%`;
  }
```

Change:

```tsx
        <span
          className={`tabular-nums font-medium ${performanceClass}`}
        >
          {performanceLabel}
        </span>
```

to:

```tsx
        <span data-money className="tabular-nums font-medium" style={{ color: performanceColor }}>
          {performanceLabel}
        </span>
```

Change:

```tsx
        <tbody>
          {sufficient
            ? returns!.map((p) => (
                <tr key={p.date}>
                  <td>{p.date}</td>
                  <td>{p.pct.toFixed(1)}%</td>
                </tr>
              ))
            : balanceHistory.map((p) => (
                <tr key={p.date}>
                  <td>{p.date}</td>
                  <td>{formatCurrency(p.value, currency)}</td>
                </tr>
              ))}
        </tbody>
```

to:

```tsx
        <tbody>
          {sufficient
            ? returns!.map((p) => (
                <tr key={p.date}>
                  <td>{formatDate(p.date)}</td>
                  <td>{p.pct.toFixed(1)}%</td>
                </tr>
              ))
            : balanceHistory.map((p) => (
                <tr key={p.date}>
                  <td>{formatDate(p.date)}</td>
                  <td>{formatCurrency(p.value, currency)}</td>
                </tr>
              ))}
        </tbody>
```

(This last change is a small accessibility polish, not a visual one — the table is `sr-only`, so `font-mono` has no effect there; formatting the date through the app's usual formatter just makes the screen-reader-announced value consistent with every other date in the app, rather than a raw `2026-08-23` string.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/investments-render.test.ts -t "PerformanceChart"`
Expected: PASS, both tests.

- [ ] **Step 5: Run the full file to confirm no cross-block regression**

Run: `npx vitest run tests/unit/investments-render.test.ts`
Expected: PASS — all tests across `HoldingsTable`, `TopMovers`, `PerformanceChart`, and the untouched `AddManualHoldingForm` blocks.

- [ ] **Step 6: Commit**

```bash
git add components/investments/PerformanceChart.tsx tests/unit/investments-render.test.ts
git commit -m "feat: apply diverging money-direction color to PerformanceChart, fix a privacy-blur gap, format sr-only dates"
```

---

### Task 4: `AllocationView.tsx` — privacy-blur fix only

**Files:**
- Modify: `components/investments/AllocationView.tsx`
- Test: `tests/unit/allocation-view-render.test.ts` (new — no existing test covers this component today)

**Interfaces:** None new — `AllocationView`'s props (`page`, `currency`) are unchanged.

**Why no color or zebra change here:** allocation weight is a share of the whole, not a gain or loss — there is nothing to color `--viz-pos`/`--viz-neg` about a category being 35% of a portfolio. And each row already carries its own colored dot (`SLOT_COLORS[i % 7]`, the categorical chart palette) purely to distinguish it from its neighbors — the same job zebra striping would do, already done, via a different (and here, more informative — each dot also matches the stacked-bar segment above it) mechanism. The only real gap is the money figure missing `data-money`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/allocation-view-render.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AllocationView from "@/components/investments/AllocationView";
import type { InvestmentsPage } from "@/lib/investments";

function page(overrides: Partial<InvestmentsPage> = {}): InvestmentsPage {
  return {
    total: 2500,
    dayChange: null,
    byClass: [{ label: "Funds", holdings: [], subtotal: 2500 }],
    topMovers: null,
    balanceHistory: [],
    ...overrides,
  };
}

describe("AllocationView", () => {
  it("shows an empty state when the portfolio total is zero", () => {
    const html = renderToStaticMarkup(
      createElement(AllocationView, { page: page({ total: 0, byClass: [] }), currency: "USD" }),
    );
    expect(html).toContain("Add a holding to see how your portfolio is allocated.");
  });

  it("carries each class's subtotal inside the privacy-blur hook", () => {
    const html = renderToStaticMarkup(
      createElement(AllocationView, { page: page(), currency: "USD" }),
    );
    expect(html).toContain("data-money");
    expect(html).toContain("$2,500.00");
  });

  it("labels each class with its share of the total", () => {
    const html = renderToStaticMarkup(
      createElement(AllocationView, { page: page(), currency: "USD" }),
    );
    expect(html).toContain("Funds");
    expect(html).toContain("100.0%");
  });
});
```

- [ ] **Step 2: Run the tests to verify the privacy-blur one fails**

Run: `npx vitest run tests/unit/allocation-view-render.test.ts`
Expected: 2 PASS (empty state, share label — pre-existing behavior), 1 FAIL (`data-money` is not present in the current markup).

- [ ] **Step 3: Write the implementation**

In `components/investments/AllocationView.tsx`, change:

```tsx
            <span className="tabular-nums text-muted">
              {formatCurrency(group.subtotal, currency)} · {((group.subtotal / page.total) * 100).toFixed(1)}%
            </span>
```

to:

```tsx
            <span data-money className="tabular-nums text-muted">
              {formatCurrency(group.subtotal, currency)} · {((group.subtotal / page.total) * 100).toFixed(1)}%
            </span>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/allocation-view-render.test.ts`
Expected: PASS, all 3 tests.

- [ ] **Step 5: Commit**

```bash
git add components/investments/AllocationView.tsx tests/unit/allocation-view-render.test.ts
git commit -m "fix: cover AllocationView's class subtotal with the privacy-blur hook"
```

---

### Task 5: `app/investments/page.tsx` — page-level day-change color fix

**Files:**
- Modify: `app/investments/page.tsx`

**Interfaces:** None new.

No dedicated test — no test file exists for `app/investments/page.tsx` today (confirmed by search), and it's an async server component with several Supabase queries; building a mock harness for it from scratch, as Phase 1's Task 1 explained for a similar case, risks a confidently-wrong test more than it risks a usefully-absent one. Verification is the full suite (`npm run test:unit`) staying green plus Task 6's manual check.

- [ ] **Step 1: Write the implementation**

In `app/investments/page.tsx`, change:

```tsx
                {page.dayChange && (
                  <span
                    data-money
                    className={page.dayChange.amount >= 0 ? "ml-2 text-success" : "ml-2 text-danger"}
                  >
                    {page.dayChange.amount >= 0 ? "+" : ""}
                    {formatCurrency(page.dayChange.amount, currency)} ({page.dayChange.pct.toFixed(1)}%) today
                  </span>
                )}
```

to:

```tsx
                {page.dayChange && (
                  <span
                    data-money
                    className="ml-2"
                    style={{ color: page.dayChange.amount >= 0 ? "var(--viz-pos)" : "var(--viz-neg)" }}
                  >
                    {page.dayChange.amount >= 0 ? "+" : ""}
                    {formatCurrency(page.dayChange.amount, currency)} ({page.dayChange.pct.toFixed(1)}%) today
                  </span>
                )}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/investments/page.tsx
git commit -m "feat: apply diverging money-direction color to the investments page header"
```

---

### Task 6: Full verification and manual QA

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

Open `/investments` signed in as a user with holdings across at least two asset classes, at least one holding with a positive `periodChangePct` and one with negative, and enough balance history for `PerformanceChart` to show a time-weighted return (not just the pre-sufficient "Balance" fallback). Confirm:

- Page header: the day-change figure next to the portfolio total is green when positive, red when negative — not the old `text-success`/`text-danger` (visually these may look similar or identical since both map to green/red; the meaningful check is that this is now driven by the same token system as the rest of the app, confirmed via computed style / inspector, not just eyeballing).
- `HoldingsTable`: per-holding change column colors correctly; no zebra striping (confirm this is intentional, not a missed step); asset-class group-header rows still visually distinct.
- `TopMovers`: gains/losses colored correctly; rows now alternate a subtle background tint.
- `PerformanceChart`: performance figure colored correctly; confirm (via screen reader or accessibility tree inspection, not just visually — the change is invisible on screen) that the sr-only table's dates are now formatted rather than raw ISO strings.
- `AllocationView`: unchanged visually (no color/zebra change here) — confirm the class subtotal now blurs under the privacy toggle, where it didn't before.
- Toggle privacy blur: confirm all five previously-correct-plus-two-newly-fixed money figures blur — the HoldingsTable group subtotal, the PerformanceChart figure, and the AllocationView class subtotal specifically, since those are the ones this plan added `data-money` to.
- Toggle dark mode: colors, zebra (on `TopMovers`), and everything else still read correctly.
- If the signed-in user has no holdings, confirm the empty state (`"No investment accounts yet"`) still renders exactly as before — this plan's changes are all inside the `holdings.length > 0` branch.

- [ ] **Step 3: Stop the dev server**

Stop the `npm run dev` process once manual QA is complete.
