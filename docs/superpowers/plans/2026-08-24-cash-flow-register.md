# Cash Flow Register Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply full symmetric `--viz-pos`/`--viz-neg` coloring to `CashFlowSummary`'s four metric tiles (Income, Expenses, Savings, Savings rate) — the one real gap research found on this page.

**Architecture:** This is the narrowest plan in the rollout so far. `BreakdownBars.tsx` was already audited clean in Phase 2 and re-confirmed unchanged here. `PeriodBars.tsx` and `CashFlowControls.tsx` have no text-level money/date/list content at all and need no changes. `app/cash-flow/page.tsx` renders no money/date content directly — it's pure composition. `DivergingColumns.tsx` (rendered by `PeriodBars`) is already correctly on `--viz-pos`/`--viz-neg` and `data-money`; its one arguable gap (period-label text not `font-mono`) is deliberately left alone here because that file is shared with the dashboard's `WealthView.tsx` — touching it is a decision for whichever phase actually covers the dashboard's `WealthView`, not this one, to keep this plan's blast radius to the page it's named for.

**Tech Stack:** Next.js 16 App Router, TypeScript, Tailwind 4, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-24-app-wide-register-design.md` — full symmetric adoption (every direction gets a color, not just gains) applies here: `CashFlowSummary`'s Expenses tile currently renders in plain `text-foreground` with no color at all, the same "gains colored, everything else left plain" pattern already overridden on Transactions/Reports/Investments/Recurring.

## Global Constraints

- `--viz-pos`/`--viz-neg` replace `text-success`/`text-danger`/`text-foreground` across all four metric tiles: Income (always green), Expenses (always red — new, it had no color before), Savings (green/red by sign, as before), Savings rate (green/red by sign when a rate exists, unchanged "No income" null case with no color).
- Every money figure already carries `data-money` here — this task only changes color, not privacy-blur coverage.
- No new CSS custom properties, no new fonts, no changes to `docs/PALETTE.md` or `scripts/validate_palette.js`.
- `npx vitest run <file>` for one test file; `npm run test:unit` for the suite; `npx tsc --noEmit`; `npm run build`; `npm run lint`.

---

### Task 1: `CashFlowSummary.tsx` — full symmetric color

**Files:**
- Modify: `components/cash-flow/CashFlowSummary.tsx`
- Modify: `tests/unit/cash-flow-render.test.ts` (the `describe("CashFlowSummary", ...)` block only)

**Interfaces:** None new — `CashFlowSummary`'s props (`period`, `currency`) are unchanged. The file-local `savingsRateTone` helper is renamed `savingsRateColor` and returns a CSS color string (or `undefined`) instead of a Tailwind class name.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/cash-flow-render.test.ts`, replace the existing `it("uses semantic color tokens, never a raw viz-good/viz-bad inline style", ...)` test (inside `describe("CashFlowSummary", ...)`) with:

```ts
  it("uses the diverging money-direction tokens, never the status-semantic classes", () => {
    const html = renderToStaticMarkup(
      createElement(CashFlowSummary, {
        period: periods[1]!,
        currency: "USD",
      }),
    );
    expect(html).toContain("var(--viz-pos)");
    expect(html).toContain("var(--viz-neg)");
    expect(html).not.toContain("text-success");
    expect(html).not.toContain("text-danger");
  });

  it("leaves the savings-rate figure uncolored when there is no income to compute a rate from", () => {
    const html = renderToStaticMarkup(
      createElement(CashFlowSummary, {
        period: {
          key: "2026-08",
          label: "Aug 2026",
          income: 0,
          expenses: 100,
          savings: -100,
          savingsRate: null,
        },
        currency: "USD",
      }),
    );
    expect(html).toContain("No income");
  });
```

(The other three existing tests in this `describe` block — formatting the selected period, the null-period empty state, and the unknown-currency case — are unchanged.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/cash-flow-render.test.ts -t "CashFlowSummary"`
Expected: FAIL — the new color test fails (current code emits `text-success`/`text-foreground`/`text-danger`, never `var(--viz-pos)`/`var(--viz-neg)`). The "no income" test should already pass against the current code — it's a regression check for behavior this task must not change.

- [ ] **Step 3: Write the implementation**

In `components/cash-flow/CashFlowSummary.tsx`, change:

```tsx
function savingsRateTone(value: number | null): string {
  if (value === null) return "text-foreground";
  return value >= 0 ? "text-success" : "text-danger";
}
```

to:

```tsx
function savingsRateColor(value: number | null): string | undefined {
  if (value === null) return undefined;
  return value >= 0 ? "var(--viz-pos)" : "var(--viz-neg)";
}
```

Change:

```tsx
  const metrics = [
    {
      label: "Income",
      value: formatCurrency(period.income, currency),
      tone: "text-success",
    },
    {
      label: "Expenses",
      value: formatCurrency(period.expenses, currency),
      tone: "text-foreground",
    },
    {
      label: "Savings",
      value: formatCurrency(period.savings, currency),
      tone: period.savings >= 0 ? "text-success" : "text-danger",
    },
    {
      label: "Savings rate",
      value: formatPercent(period.savingsRate),
      tone: savingsRateTone(period.savingsRate),
    },
  ];
```

to:

```tsx
  const metrics = [
    {
      label: "Income",
      value: formatCurrency(period.income, currency),
      color: "var(--viz-pos)",
    },
    {
      label: "Expenses",
      value: formatCurrency(period.expenses, currency),
      color: "var(--viz-neg)",
    },
    {
      label: "Savings",
      value: formatCurrency(period.savings, currency),
      color: period.savings >= 0 ? "var(--viz-pos)" : "var(--viz-neg)",
    },
    {
      label: "Savings rate",
      value: formatPercent(period.savingsRate),
      color: savingsRateColor(period.savingsRate),
    },
  ];
```

Change:

```tsx
        {metrics.map((metric) => (
          <Panel key={metric.label} className="min-w-0">
            <p className="eyebrow">{metric.label}</p>
            <p data-money className={`metric-value mt-3 truncate text-2xl sm:text-3xl ${metric.tone}`}>
              {metric.value}
            </p>
          </Panel>
        ))}
```

to:

```tsx
        {metrics.map((metric) => (
          <Panel key={metric.label} className="min-w-0">
            <p className="eyebrow">{metric.label}</p>
            <p
              data-money
              className="metric-value mt-3 truncate text-2xl sm:text-3xl"
              style={{ color: metric.color }}
            >
              {metric.value}
            </p>
          </Panel>
        ))}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/cash-flow-render.test.ts -t "CashFlowSummary"`
Expected: PASS, all 5 tests in this describe block (3 unchanged + 2 new/replaced).

- [ ] **Step 5: Run the full file to confirm no cross-block regression**

Run: `npx vitest run tests/unit/cash-flow-render.test.ts`
Expected: PASS — all tests across `Cash Flow charts` (`DivergingColumns`/`PeriodBars`), `BreakdownBars`, `CashFlowSummary`, and `CashFlowControls`.

- [ ] **Step 6: Commit**

```bash
git add components/cash-flow/CashFlowSummary.tsx tests/unit/cash-flow-render.test.ts
git commit -m "feat: apply diverging money-direction color to CashFlowSummary's metric tiles"
```

---

### Task 2: Full verification and manual QA

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

Open `/cash-flow` on a period with both income and expenses. Confirm:

- Income tile is green (`var(--viz-pos)`); Expenses tile is now red (`var(--viz-neg)`) where it was previously plain/uncolored; Savings and Savings rate tiles are green when positive, red when negative, matching their prior conditional coloring but via the new tokens.
- Switch to a period/scope with no income (if reachable) and confirm the Savings-rate tile still reads "No income" with no forced color.
- `BreakdownBars` (Income/Expenses breakdown panels below) is visually unchanged — this task didn't touch that file.
- Toggle dark mode: all four tile colors still read correctly.

- [ ] **Step 3: Stop the dev server**

Stop the `npm run dev` process once manual QA is complete.
