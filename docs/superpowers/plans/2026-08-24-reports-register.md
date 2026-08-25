# Reports Register Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the app's statement-register visual language to the Reports page's transaction list (`ReportTransactions`) — mono dates via the app's actual date formatter (it currently renders a raw ISO string), zebra-striped rows, and `--viz-pos`/`--viz-neg` symmetric money-direction coloring, matching the precedent set on the Transactions page (Phase 1).

**Architecture:** `ReportTransactions.tsx` is a `<table>`/`<tr>`/`<td>` grid, the same structural shape as the transactions page's `LedgerTableRow` — not a fit for the `RegisterRow` `<li>` primitive (Phase 0). This plan applies the visual language directly to the table's own markup, exactly as Phase 1 did for the transactions page, rather than forcing a component migration. `BreakdownBars.tsx` (also on this page, shared with `/cash-flow`) was audited during research and needs **no changes** — it already uses `--viz-pos`/`--viz-neg` correctly and already carries `data-money`; see "Audit finding: BreakdownBars" below for why the one initially-flagged gap turned out not to be one. `SankeyChart` is explicitly out of scope (unchanged from the app-wide spec's non-goals).

**Tech Stack:** Next.js 16 App Router, TypeScript, Tailwind 4, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-24-app-wide-register-design.md` — the debit-color decision documented there (full symmetric `--viz-pos`/`--viz-neg` adoption, including red debits) applies here without needing to re-confirm with the user; the spec's addendum explicitly says so for exactly this situation.

## Global Constraints

- `font-mono` is reserved for labels/dates/eyebrows, never money. `<Money>`/`.metric-value`/`data-money` are reserved for money, never labels.
- This page fully adopts `--viz-pos`/`--viz-neg` symmetrically (income green, everything else — expense and transfer alike — red), matching the Transactions page precedent and the spec's forward-looking guidance.
- The amount cell must keep its `data-money` attribute — this task changes its color and the surrounding row's zebra state only, never removes an existing privacy-blur hook.
- No new CSS custom properties, no new fonts, no changes to `docs/PALETTE.md` or `scripts/validate_palette.js`.
- `npx vitest run <file>` for one test file; `npm run test:unit` for the suite; `npx tsc --noEmit`; `npm run build`; `npm run lint`.

## Audit finding: `BreakdownBars.tsx` needs no changes

Research confirmed `components/cash-flow/BreakdownBars.tsx` already: colors its bar via `const color = title === "Income" ? "var(--viz-pos)" : "var(--viz-neg)";` (already the house rule, not `--success`/`--danger`); carries `data-money` on both its list-view and table-view amount cells. The one thing that looked like a gap during the roadmap's original survey — category/merchant label text not being `font-mono` — does not actually match this rollout's own precedent once checked: `RegisterRow` (Phase 0) renders its own `merchant` field in bold proportional sans, not mono; only dates get the mono treatment everywhere this rollout has touched so far. Mono-ing `BreakdownBars`' category/merchant labels would be inventing a new rule contradicting the one already shipped, not applying an existing one. No task below touches this file; Task 2's manual QA just confirms it still renders correctly.

---

### Task 1: `ReportTransactions.tsx` register styling

**Files:**
- Modify: `components/reports/ReportTransactions.tsx`
- Test: `tests/unit/report-transactions-render.test.ts`

**Interfaces:** None new — `ReportTransactions`'s props (`transactions`, `currency`, `page`, `hrefForPage`) and the `CanonicalFinanceTransaction` type it consumes are unchanged; only internal markup/classes change.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/report-transactions-render.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReportTransactions from "@/components/reports/ReportTransactions";
import { formatDate } from "@/lib/format-date";
import type { CanonicalFinanceTransaction } from "@/lib/finance-domain";

function row(partial: Partial<CanonicalFinanceTransaction> = {}): CanonicalFinanceTransaction {
  return {
    id: "1",
    sourceTransactionId: "txn-1",
    date: "2026-08-23",
    signedAmount: 64.18,
    flow: "expense",
    merchant: "Corner Grocer",
    groupKey: "FOOD_AND_DRINK",
    categoryKey: "FOOD_AND_DRINK",
    accountId: "acct-1",
    manualAccountId: null,
    pending: false,
    source: "plaid",
    ...partial,
  } as CanonicalFinanceTransaction;
}

const baseProps = {
  currency: "USD",
  page: 1,
  hrefForPage: (page: number) => `/reports?page=${page}`,
};

describe("ReportTransactions", () => {
  it("formats the date through the app's date formatter, in the mono face", () => {
    const html = renderToStaticMarkup(
      createElement(ReportTransactions, {
        ...baseProps,
        transactions: [row({ date: "2026-08-23" })],
      }),
    );
    expect(html).toContain(
      `<td class="py-2 pr-3 whitespace-nowrap font-mono">${formatDate("2026-08-23")}</td>`,
    );
    expect(html).not.toContain(">2026-08-23<");
  });

  it("zebra-stripes odd-indexed data rows and not even-indexed ones", () => {
    const html = renderToStaticMarkup(
      createElement(ReportTransactions, {
        ...baseProps,
        transactions: [row({ id: "1" }), row({ id: "2" })],
      }),
    );
    // rows[0] is the <thead> row; data rows follow.
    const rows = html.split("<tr").slice(1);
    expect(rows).toHaveLength(3);
    expect(rows[1]).not.toContain("bg-panel-2");
    expect(rows[2]).toContain("bg-panel-2");
  });

  it("colors an income row with the positive diverging token", () => {
    const html = renderToStaticMarkup(
      createElement(ReportTransactions, {
        ...baseProps,
        transactions: [row({ flow: "income", signedAmount: -2450 })],
      }),
    );
    expect(html).toContain("var(--viz-pos)");
  });

  it("colors an expense row with the negative diverging token", () => {
    const html = renderToStaticMarkup(
      createElement(ReportTransactions, {
        ...baseProps,
        transactions: [row({ flow: "expense", signedAmount: 64.18 })],
      }),
    );
    expect(html).toContain("var(--viz-neg)");
  });

  it("colors a transfer row with the negative diverging token, same as before (non-income stayed uncolored, now stays non-positive)", () => {
    const html = renderToStaticMarkup(
      createElement(ReportTransactions, {
        ...baseProps,
        transactions: [row({ flow: "transfer", signedAmount: 100 })],
      }),
    );
    expect(html).toContain("var(--viz-neg)");
    expect(html).toContain(">Transfer<");
  });

  it("still shows the absolute amount with no sign prefix; direction stays conveyed by the Direction column", () => {
    const html = renderToStaticMarkup(
      createElement(ReportTransactions, {
        ...baseProps,
        transactions: [row({ flow: "income", signedAmount: -2450 })],
      }),
    );
    expect(html).toContain("$2,450.00");
    expect(html).toContain(">In<");
  });

  it("keeps the amount inside the privacy-blur hook", () => {
    const html = renderToStaticMarkup(
      createElement(ReportTransactions, { ...baseProps, transactions: [row()] }),
    );
    expect(html).toContain("data-money");
  });

  it("mono-izes the column header row", () => {
    const html = renderToStaticMarkup(
      createElement(ReportTransactions, { ...baseProps, transactions: [row()] }),
    );
    expect(html).toContain('<tr class="text-left opacity-60 font-mono">');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/report-transactions-render.test.ts`
Expected: FAIL — the date test fails (current code renders the raw `row.date` string with no `font-mono`); the zebra test fails (no zebra logic exists); the color tests fail (current code emits `text-success`/`text-foreground`, never `var(--viz-pos)`/`var(--viz-neg)`); the header-mono test fails (no `font-mono` on the header `<tr>` today). The absolute-amount and privacy-blur tests should already pass against the current code — they're regression checks, not new behavior.

- [ ] **Step 3: Write the implementation**

In `components/reports/ReportTransactions.tsx`, add the import:

```tsx
import { formatDate } from "@/lib/format-date";
```

alongside the existing imports at the top (after `import { formatCurrency } from "@/lib/format";`).

Change:

```tsx
        <thead>
          <tr className="text-left opacity-60">
```

to:

```tsx
        <thead>
          <tr className="text-left opacity-60 font-mono">
```

Change:

```tsx
        <tbody className="tabular-nums">
          {rows.map((row) => (
            <tr
              key={row.id}
              className="border-t border-black/5 dark:border-white/10"
            >
              <td className="py-2 pr-3 whitespace-nowrap">{row.date}</td>
```

to:

```tsx
        <tbody className="tabular-nums">
          {rows.map((row, index) => (
            <tr
              key={row.id}
              className={cn(
                "border-t border-black/5 dark:border-white/10",
                index % 2 === 1 && "bg-panel-2",
              )}
            >
              <td className="py-2 pr-3 whitespace-nowrap font-mono">{formatDate(row.date)}</td>
```

Change:

```tsx
              <td
                data-money
                className={cn(
                  "py-2 pr-3 text-right",
                  row.flow === "income" ? "text-success" : "text-foreground",
                )}
              >
                {formatCurrency(Math.abs(row.signedAmount), currency)}
              </td>
```

to:

```tsx
              <td
                data-money
                className="py-2 pr-3 text-right"
                style={{ color: row.flow === "income" ? "var(--viz-pos)" : "var(--viz-neg)" }}
              >
                {formatCurrency(Math.abs(row.signedAmount), currency)}
              </td>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/report-transactions-render.test.ts`
Expected: PASS, all 7 tests.

- [ ] **Step 5: Run the existing responsive test to confirm no regression**

Run: `npx vitest run tests/unit/report-transactions-responsive.test.ts`
Expected: PASS unchanged — that test only asserts the `overflow-x-auto` wrapper and `min-w-[42rem] w-full text-sm` table classes, neither of which this task touches.

- [ ] **Step 6: Commit**

```bash
git add components/reports/ReportTransactions.tsx tests/unit/report-transactions-render.test.ts
git commit -m "feat: apply register styling to the reports transaction table"
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

Open `/reports`, on a tab/filter combination that shows transaction rows (not just the chart). Confirm:

- Dates render in the mono face, correctly formatted (not a raw `2026-08-23`-style ISO string).
- Rows alternate a subtle background tint.
- Income rows are green (`var(--viz-pos)`); expense and transfer rows are red (`var(--viz-neg)`) — including transfers, which previously shared the same uncolored treatment as expenses and now share the red treatment instead.
- The "Direction" column (`In`/`Out`/`Transfer`) still renders — this task didn't remove it, color is now a second cue alongside it, not a replacement.
- Toggle privacy blur: amounts still blur.
- Toggle dark mode: colors and zebra stripes still read correctly; confirm the row border's existing `dark:border-white/10` still looks right against the new zebra background.
- Switch to the Income/Expenses breakdown tab (not the transaction table) and confirm `BreakdownBars` still renders its bars, colors, and "View complete ... table" disclosure correctly — this task didn't touch that file, this is a pure regression check.
- Confirm the Cash Flow tab's Sankey chart is unaffected — out of scope, sanity check only.

- [ ] **Step 3: Stop the dev server**

Stop the `npm run dev` process once manual QA is complete.
