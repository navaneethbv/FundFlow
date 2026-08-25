# Transactions Register Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the app's statement-register visual language (`font-mono` for dates/labels, `--viz-pos`/`--viz-neg` for inflow/outflow, zebra-striped rows) to the Transactions page — its desktop ledger table and mobile card list — the highest-leverage remaining surface per `docs/superpowers/specs/2026-08-24-app-wide-register-design.md`'s page verdict table.

**Architecture:** Research (2026-08-24) confirmed the desktop ledger (`LedgerTableRow` in `app/transactions/page.tsx`) is a `<table>`/`<tr>`/`<td>` grid with day-group headers and conditional columns — a fundamentally different shape from the `RegisterRow` primitive's `<li>` contract (built in Phase 0), and forcing a migration would mean either breaking the table semantics or bolting a mismatched component in. This plan does not migrate the desktop table to `RegisterRow`; it applies the same visual language directly to the table's own markup (mono dates, zebra `<tr>`s via row index, `--viz-pos`/`--viz-neg` inline styles). The mobile list (`MobileLedgerList`) gets the same direct treatment for the same reason — its `<li>` structure is close to `RegisterRow`'s but carries badges/annotations/an editor slot `RegisterRow` doesn't expose, and extending `RegisterRow` for a single second consumer with a different shape was judged not worth the coupling.

**Tech Stack:** Next.js 16 App Router, TypeScript, Tailwind 4, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-24-app-wide-register-design.md` — read this first, especially the addendum documenting the debit-color decision below.

## Global Constraints

- `font-mono` is reserved for labels/dates/eyebrows, never money. `<Money>`/`.metric-value`/`data-money` are reserved for money, never labels.
- **This page fully adopts `--viz-pos`/`--viz-neg` symmetrically, including coloring debits red.** This is a deliberate, user-confirmed override of the page's prior "don't color debits red" design (see the spec addendum) — do not partially apply this (e.g. inflow-only) without checking with the user first; that was considered and explicitly not chosen.
- Every money figure must already carry (or keep carrying) `.money`, `.metric-value`, or `data-money` — both files already do this correctly today; this plan changes color/font only, never removes an existing privacy-blur hook.
- No new CSS custom properties, no new fonts, no changes to `docs/PALETTE.md` or `scripts/validate_palette.js`. `--viz-pos`/`--viz-neg` already exist and are already used elsewhere (`LedgerStrip`, `RegisterRow`, `BreakdownBars`, `DivergingColumns`).
- `npx vitest run <file>` for one test file; `npm run test:unit` for the suite; `npx tsc --noEmit`; `npm run build`; `npm run lint`.

---

### Task 1: Desktop ledger table styling (`app/transactions/page.tsx`)

**Files:**
- Modify: `app/transactions/page.tsx`

**Interfaces:** None new. `LedgerTableRowProps` gains one field (`index: number`); no other component's props change.

No dedicated new test for this task — see "Why no new desktop test" below. Verification is: the existing suite must stay green, since this task changes only classNames/inline styles, not data, ordering, or query behavior (which is what the existing transactions-page tests actually assert on).

**Why no new desktop test:** `LedgerTableRow` is not exported and is not unit-tested in isolation anywhere in this codebase (confirmed by search). The page-level tests that do exist (`tests/unit/transactions-page-sort.test.ts` and others) assert on query/ordering behavior via a `clientStub` mock, not on rendered markup — and the exact mapping from a raw `transactions` row through `lib/ledger-projection.ts`'s `projectLedgerRows` into the `LedgerProjectedRow` shape `LedgerTableRow` consumes was not verified during this plan's research. Writing a new integration test that seeds a fake row and asserts on its rendered styling risks getting that projection step wrong and shipping a test that's confidently incorrect rather than usefully absent. If dedicated desktop visual coverage is wanted, it should be its own follow-up that starts by reading `lib/ledger-projection.ts` in full — not guessed here.

- [ ] **Step 1: Add `index` to `LedgerTableRowProps` and thread it through**

In `app/transactions/page.tsx`, change:

```tsx
interface LedgerTableRowProps {
  row: LedgerProjectedRow;
  /** Render the day-group header above this row. */
  isNewDay: boolean;
  /** Signed net for the row's date, shown in that header. */
  dayTotal: number;
  visibleColumns: ReadonlySet<string>;
  excludedDuplicate: boolean;
  note: string | null;
  tags: string[];
  splits: Array<{ category: string; amount: number }>;
  categoryOptions: string[];
}
```

to:

```tsx
interface LedgerTableRowProps {
  row: LedgerProjectedRow;
  /** Position in the flat row list; drives the zebra stripe. */
  index: number;
  /** Render the day-group header above this row. */
  isNewDay: boolean;
  /** Signed net for the row's date, shown in that header. */
  dayTotal: number;
  visibleColumns: ReadonlySet<string>;
  excludedDuplicate: boolean;
  note: string | null;
  tags: string[];
  splits: Array<{ category: string; amount: number }>;
  categoryOptions: string[];
}
```

And change the function signature:

```tsx
function LedgerTableRow({
  row,
  isNewDay,
  dayTotal,
  visibleColumns,
  excludedDuplicate,
  note,
  tags,
  splits,
  categoryOptions,
}: Readonly<LedgerTableRowProps>) {
```

to:

```tsx
function LedgerTableRow({
  row,
  index,
  isNewDay,
  dayTotal,
  visibleColumns,
  excludedDuplicate,
  note,
  tags,
  splits,
  categoryOptions,
}: Readonly<LedgerTableRowProps>) {
```

- [ ] **Step 2: Mono the day-group header date and recolor its net total**

Change:

```tsx
      {isNewDay && (
        <tr className="border-b border-panel-border bg-panel/60">
          <td colSpan={columnCount} className="px-4 py-1.5">
            <div className="flex items-center justify-between gap-3 text-xs font-semibold text-muted">
              <span>{formatDate(row.date)}</span>
              <span data-money className="font-normal">
                {dayTotal < 0 ? "+" : "-"}
                {formatCurrency(Math.abs(dayTotal))} net
              </span>
            </div>
          </td>
        </tr>
      )}
```

to:

```tsx
      {isNewDay && (
        <tr className="border-b border-panel-border bg-panel/60">
          <td colSpan={columnCount} className="px-4 py-1.5">
            <div className="flex items-center justify-between gap-3 text-xs font-semibold text-muted">
              <span className="font-mono">{formatDate(row.date)}</span>
              <span
                data-money
                className="font-normal"
                style={{ color: dayTotal < 0 ? "var(--viz-pos)" : "var(--viz-neg)" }}
              >
                {dayTotal < 0 ? "+" : "-"}
                {formatCurrency(Math.abs(dayTotal))} net
              </span>
            </div>
          </td>
        </tr>
      )}
```

- [ ] **Step 3: Zebra-stripe the row, mono the per-row date, recolor the amount**

Change:

```tsx
      <tr className="border-b border-panel-border last:border-0 hover:bg-panel-hover">
        <td className="whitespace-nowrap px-4 py-3 align-top text-muted">
          {formatDate(row.date)}
        </td>
```

to:

```tsx
      <tr
        className={`border-b border-panel-border last:border-0 hover:bg-panel-hover${
          index % 2 === 1 ? " bg-panel-2" : ""
        }`}
      >
        <td className="whitespace-nowrap px-4 py-3 align-top text-muted font-mono">
          {formatDate(row.date)}
        </td>
```

Change:

```tsx
        <td
          data-money
          className={
            isMoneyIn
              ? "whitespace-nowrap px-4 py-3 text-right align-top font-semibold text-success"
              : "whitespace-nowrap px-4 py-3 text-right align-top font-semibold text-foreground"
          }
        >
          {isMoneyIn ? "+" : "-"}
          {formatCurrency(Math.abs(row.amount), currency)}
        </td>
```

to:

```tsx
        <td
          data-money
          className="whitespace-nowrap px-4 py-3 text-right align-top font-semibold"
          style={{ color: isMoneyIn ? "var(--viz-pos)" : "var(--viz-neg)" }}
        >
          {isMoneyIn ? "+" : "-"}
          {formatCurrency(Math.abs(row.amount), currency)}
        </td>
```

- [ ] **Step 4: Mono the column headers, pass `index` from the call site**

Change:

```tsx
                  <tr className="border-b border-panel-border text-left text-xs uppercase tracking-wider text-muted">
```

to:

```tsx
                  <tr className="border-b border-panel-border text-left text-xs uppercase tracking-wider text-muted font-mono">
```

Change:

```tsx
                  {rows.map((t, index) => (
                    <LedgerTableRow
                      key={t.id}
                      row={t}
                      isNewDay={showDayGroups && (index === 0 || rows[index - 1]!.date !== t.date)}
                      dayTotal={dayTotals.get(t.date) ?? 0}
                      visibleColumns={visibleColumns}
                      excludedDuplicate={excludedDuplicateIds.has(t.id)}
                      note={annById.get(t.id)?.note ?? null}
                      tags={annById.get(t.id)?.tags ?? []}
                      splits={splitsById.get(t.id) ?? []}
                      categoryOptions={categoryOptions}
                    />
                  ))}
```

to:

```tsx
                  {rows.map((t, index) => (
                    <LedgerTableRow
                      key={t.id}
                      row={t}
                      index={index}
                      isNewDay={showDayGroups && (index === 0 || rows[index - 1]!.date !== t.date)}
                      dayTotal={dayTotals.get(t.date) ?? 0}
                      visibleColumns={visibleColumns}
                      excludedDuplicate={excludedDuplicateIds.has(t.id)}
                      note={annById.get(t.id)?.note ?? null}
                      tags={annById.get(t.id)?.tags ?? []}
                      splits={splitsById.get(t.id) ?? []}
                      categoryOptions={categoryOptions}
                    />
                  ))}
```

- [ ] **Step 5: Typecheck and run the existing suite**

Run: `npx tsc --noEmit`
Expected: PASS.

Run: `npx vitest run tests/unit/transactions-page-sort.test.ts tests/unit/transactions-ui.test.ts tests/unit/ledger-columns.test.ts tests/unit/report-transactions-responsive.test.ts`
Expected: PASS — these assert query/ordering/data-shape behavior this task does not touch. If any of these four filenames doesn't exist, run `find tests -iname "*transaction*" -o -iname "*ledger*"` and run whatever the search actually turns up instead; don't skip verification just because a filename guess was wrong.

- [ ] **Step 6: Commit**

```bash
git add app/transactions/page.tsx
git commit -m "feat: apply register styling to the desktop transactions ledger"
```

---

### Task 2: Mobile ledger list styling (`components/transactions/MobileLedgerList.tsx`)

**Files:**
- Modify: `components/transactions/MobileLedgerList.tsx`
- Modify: `tests/unit/mobile-ledger-list.test.ts`

**Interfaces:** None new — `MobileLedgerList`'s props and `LedgerCardRow` type are unchanged; only internal markup/classes change.

- [ ] **Step 1: Write the failing tests**

Replace `tests/unit/mobile-ledger-list.test.ts` in full:

```tsx
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { formatDate } from "@/lib/format-date";

vi.mock("@/components/transactions/TransactionEditor", () => ({
  default: () => React.createElement("span", { "data-testid": "editor" }),
}));

import MobileLedgerList from "@/components/transactions/MobileLedgerList";

const baseRow = {
  id: "t1",
  date: "2026-07-15",
  merchant: "Blue Bottle",
  category: "FOOD_AND_DRINK",
  accountLabel: "Checking ••1234",
  amount: 6.5,
  currency: "USD",
  pending: false,
  note: null,
  tags: [] as string[],
  splits: [] as { category: string; amount: number }[],
  categoryOptions: ["FOOD_AND_DRINK"],
};

describe("MobileLedgerList", () => {
  it("renders merchant, formatted amount, category, and account", () => {
    const html = renderToStaticMarkup(
      React.createElement(MobileLedgerList, { rows: [baseRow] }),
    );
    expect(html).toContain("Blue Bottle");
    expect(html).toContain("-$6.50");
    expect(html).toContain("Food And Drink");
    expect(html).toContain("Checking ••1234");
  });

  it("marks inflows with a plus sign", () => {
    const html = renderToStaticMarkup(
      React.createElement(MobileLedgerList, {
        rows: [{ ...baseRow, amount: -100 }],
      }),
    );
    expect(html).toContain("+$100.00");
  });

  it("colors an inflow with the positive diverging token and an outflow with the negative one", () => {
    const credit = renderToStaticMarkup(
      React.createElement(MobileLedgerList, { rows: [{ ...baseRow, amount: -100 }] }),
    );
    expect(credit).toContain("var(--viz-pos)");

    const debit = renderToStaticMarkup(
      React.createElement(MobileLedgerList, { rows: [baseRow] }),
    );
    expect(debit).toContain("var(--viz-neg)");
  });

  it("sets the date in the mono face", () => {
    const html = renderToStaticMarkup(
      React.createElement(MobileLedgerList, { rows: [baseRow] }),
    );
    expect(html).toContain(`<span class="font-mono">${formatDate(baseRow.date)}</span>`);
  });

  it("zebra-stripes odd-indexed rows and not even-indexed rows", () => {
    const html = renderToStaticMarkup(
      React.createElement(MobileLedgerList, {
        rows: [baseRow, { ...baseRow, id: "t2" }],
      }),
    );
    const rows = html.split("<li").slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).not.toContain("bg-panel-2");
    expect(rows[1]).toContain("bg-panel-2");
  });

  it("shows the pending badge only when pending", () => {
    const pendingHtml = renderToStaticMarkup(
      React.createElement(MobileLedgerList, {
        rows: [{ ...baseRow, pending: true }],
      }),
    );
    expect(pendingHtml).toContain("pending");
    const settledHtml = renderToStaticMarkup(
      React.createElement(MobileLedgerList, { rows: [baseRow] }),
    );
    expect(settledHtml).not.toContain("pending");
  });
});
```

(This replaces the old `"colors credits green but leaves debits plain foreground (Monarch does not color debits red)"` test — that behavior is being deliberately reversed, see the spec addendum — with the new symmetric-coloring assertion, and adds new zebra/mono-date coverage. Every other existing test in the file is unchanged.)

- [ ] **Step 2: Run the tests to verify the new/changed ones fail**

Run: `npx vitest run tests/unit/mobile-ledger-list.test.ts`
Expected: FAIL — the color test expects `var(--viz-pos)`/`var(--viz-neg)` (current code emits `text-success`/`text-foreground`); the mono-date test expects a `<span class="font-mono">` wrapper (current code has no such span); the zebra test expects `bg-panel-2` on the second row (current code has no zebra logic at all). The three unchanged tests (merchant/amount, plus-sign, pending badge) should still pass against the old code.

- [ ] **Step 3: Write the implementation**

In `components/transactions/MobileLedgerList.tsx`, change:

```tsx
  return (
    <ul className="divide-y divide-panel-border">
      {rows.map((row) => (
        <li key={row.id} className="flex items-start gap-3 px-4 py-3">
          <MerchantAvatar name={row.merchant} size={32} className="mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2">
              <span className="truncate font-medium">{row.merchant}</span>
              {row.pending && <Badge tone="warning">pending</Badge>}
              {row.excludedDuplicate && <Badge tone="warning">Excluded duplicate</Badge>}
            </p>
            <p className="mt-0.5 text-xs text-muted">
              {formatDate(row.date)} · {titleCase(row.category) || "Uncategorized"} ·{" "}
              {row.accountLabel}
            </p>
```

to:

```tsx
  return (
    <ul className="divide-y divide-panel-border">
      {rows.map((row, index) => (
        <li
          key={row.id}
          className={`flex items-start gap-3 px-4 py-3${index % 2 === 1 ? " bg-panel-2" : ""}`}
        >
          <MerchantAvatar name={row.merchant} size={32} className="mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2">
              <span className="truncate font-medium">{row.merchant}</span>
              {row.pending && <Badge tone="warning">pending</Badge>}
              {row.excludedDuplicate && <Badge tone="warning">Excluded duplicate</Badge>}
            </p>
            <p className="mt-0.5 text-xs text-muted">
              <span className="font-mono">{formatDate(row.date)}</span>{" · "}
              {titleCase(row.category) || "Uncategorized"} · {row.accountLabel}
            </p>
```

And change:

```tsx
            <span
              data-money
              className={
                row.amount < 0
                  ? "whitespace-nowrap font-semibold tabular-nums text-success"
                  : "whitespace-nowrap font-semibold tabular-nums text-foreground"
              }
            >
              {row.amount < 0 ? "+" : "-"}
              {formatCurrency(Math.abs(row.amount), row.currency)}
            </span>
```

to:

```tsx
            <span
              data-money
              className="whitespace-nowrap font-semibold tabular-nums"
              style={{ color: row.amount < 0 ? "var(--viz-pos)" : "var(--viz-neg)" }}
            >
              {row.amount < 0 ? "+" : "-"}
              {formatCurrency(Math.abs(row.amount), row.currency)}
            </span>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/mobile-ledger-list.test.ts`
Expected: PASS, all 6 tests.

- [ ] **Step 5: Commit**

```bash
git add components/transactions/MobileLedgerList.tsx tests/unit/mobile-ledger-list.test.ts
git commit -m "feat: apply register styling to the mobile transactions list"
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

Open `/transactions` signed in as a user with transactions across at least two different dates and at least one inflow (income/refund) and one outflow. Confirm:

- Desktop (viewport ≥ `sm`): rows alternate a subtle background tint; every date (day-group header and per-row) renders in the mono face; inflow amounts are green (`var(--viz-pos)`), outflow amounts are red (`var(--viz-neg)`) — including ordinary debits, which were previously left uncolored.
- Mobile (viewport < `sm`, or resize the browser): same zebra/mono-date/symmetric-color treatment on the card list.
- Toggle privacy blur: every amount on both layouts still blurs (this task didn't touch the `data-money` attributes, only their styling).
- Toggle dark mode: colors and zebra stripes still read correctly.
- Confirm nothing about row order, pagination, filters, sort, or the "positive amounts are money out" caption changed — this task is styling-only.

- [ ] **Step 3: Stop the dev server**

Stop the `npm run dev` process once manual QA is complete.
