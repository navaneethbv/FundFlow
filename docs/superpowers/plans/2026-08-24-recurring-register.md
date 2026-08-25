# Recurring Register Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the app's statement-register visual language to the Recurring page — zebra rows and mono dates on the Upcoming/Complete occurrence table, full symmetric `--viz-pos`/`--viz-neg` coloring (currently income-only green, expenses uncolored), and two real privacy-blur gaps closed (a Manage-tab manual item's amount, and `MonthSummary`'s total figure).

**Architecture:** Research corrected an assumption in the original roadmap: `RecurringList`'s Upcoming/Complete tabs are **already a `<table>`** (`OccurrenceTable`/`OccurrenceTableRow`, migrated from a plain `<ul>` in a prior, pre-rollout change — see the comment at `RecurringList.tsx` line ~326), not a `<ul>`/`<li>` list. This is the same shape as the Transactions/Reports tables — not a `RegisterRow` fit, styled directly. The Manage tab's two `<ul>` lists (`ManageRow`, `ManualItemRow`) aren't `RegisterRow` fits either: `ManageRow` has no date and no display amount at all (it's a controls row), and `ManualItemRow` has its date/frequency/amount concatenated into one string, not RegisterRow's separate slots — restructuring it into RegisterRow's contract would be a bigger, riskier change than the fix actually needed (adding `data-money` and color to the existing markup). No file in this plan adopts `RegisterRow`.

**Tech Stack:** Next.js 16 App Router, TypeScript, Tailwind 4, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-24-app-wide-register-design.md` — full symmetric `--viz-pos`/`--viz-neg` adoption (income green, expenses red) applies here the same way it did for Transactions/Reports/Investments.

## Global Constraints

- `--viz-pos`/`--viz-neg` replace the current income-only `text-success` (expenses get no color today). `CheckCircle2`'s `text-success` (the "this occurrence is complete" checkmark icon) is a status marker, not money direction — must not be touched.
- Every money figure must carry `.money`, `.metric-value`, or `data-money`. This plan adds it to `ManualItemRow`'s embedded amount and `MonthSummary`'s total figure, both currently missing it.
- The Upcoming/Complete table's date cells keep their existing `formatDay` output (short, no year — e.g. "Jul 28") rather than switching to `formatDate` (which adds a year). This is a deliberate, narrower choice than Phase 1's transactions-page fix: `formatDay` isn't a bug here (unlike the raw-ISO-string date Phase 1 found), it's a working, intentionally shorter format appropriate for near-term due dates — only its font changes, not its content.
- No `RegisterRow` adoption anywhere on this page — see Architecture above for why.
- No new CSS custom properties, no new fonts, no changes to `docs/PALETTE.md` or `scripts/validate_palette.js`.
- `npx vitest run <file>` for one test file; `npm run test:unit` for the suite; `npx tsc --noEmit`; `npm run build`; `npm run lint`.

---

### Task 1: `OccurrenceTableRow` — zebra, mono date, symmetric color

**Files:**
- Modify: `components/recurring/RecurringList.tsx`
- Modify: `tests/unit/recurring-list-render.test.ts` (the `describe("RecurringList — Upcoming/Complete tables", ...)` block only)

**Interfaces:** `OccurrenceTableRowProps` (file-local, not exported) gains one field, `index: number`. No other component's props change.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/recurring-list-render.test.ts`, add these three tests as the last three `it(...)` blocks inside `describe("RecurringList — Upcoming/Complete tables", ...)` (after the existing `"gives a manual item's row an Enabled toggle..."` test, before the closing `});`):

```ts
  it("zebra-stripes odd-indexed rows and not even-indexed ones", () => {
    const html = renderToStaticMarkup(
      createElement(RecurringList, {
        occurrences: [
          occurrence({ sourceId: "stream-1" }),
          occurrence({ sourceId: "stream-2", merchant: "Spotify" }),
        ],
        streams: [stream(), stream({ id: "stream-2", merchantName: "Spotify" })],
        manualItems: [],
        currency: "USD",
        today: "2026-07-10",
        tab: "upcoming",
        links: LINKS,
      }),
    );
    const rows = html.split("<tr").slice(1); // rows[0] is the <thead> row
    expect(rows[1]).not.toContain("bg-panel-2");
    expect(rows[2]).toContain("bg-panel-2");
  });

  it("colors an expense with the negative diverging token and an income with the positive one", () => {
    const expenseHtml = renderToStaticMarkup(
      createElement(RecurringList, {
        occurrences: [occurrence({ isIncome: false })],
        streams: [stream()],
        manualItems: [],
        currency: "USD",
        today: "2026-07-10",
        tab: "upcoming",
        links: LINKS,
      }),
    );
    expect(expenseHtml).toContain("var(--viz-neg)");

    const incomeHtml = renderToStaticMarkup(
      createElement(RecurringList, {
        occurrences: [occurrence({ isIncome: true })],
        streams: [stream()],
        manualItems: [],
        currency: "USD",
        today: "2026-07-10",
        tab: "upcoming",
        links: LINKS,
      }),
    );
    expect(incomeHtml).toContain("var(--viz-pos)");
    expect(incomeHtml).not.toContain("text-success");
  });

  it("mono-izes the column header row", () => {
    const html = renderToStaticMarkup(
      createElement(RecurringList, {
        occurrences: [occurrence()],
        streams: [stream()],
        manualItems: [],
        currency: "USD",
        today: "2026-07-10",
        tab: "upcoming",
        links: LINKS,
      }),
    );
    expect(html).toContain('class="bg-panel-2 text-xs text-muted font-mono"');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/recurring-list-render.test.ts -t "Upcoming/Complete tables"`
Expected: FAIL — the zebra test fails (no zebra logic exists); the color test fails (expenses currently render no color class at all, so `var(--viz-neg)` is absent; income currently renders `text-success`, not `var(--viz-pos)`); the header-mono test fails (no `font-mono` on the header row today).

- [ ] **Step 3: Write the implementation**

In `components/recurring/RecurringList.tsx`, change the `OccurrenceTableRow` props (function signature and type, currently starting at the line `function OccurrenceTableRow({`):

```tsx
function OccurrenceTableRow({
  occurrence,
  currency,
  today,
  stream,
  manualItem,
  pending,
  onReview,
  onDismiss,
  onRestore,
  onCorrectAmount,
  onToggleManualEnabled,
  onDeleteManualItem,
}: Readonly<{
  occurrence: RecurringOccurrence;
  currency: string;
  today: string;
  stream: RecurringStreamRow | undefined;
  manualItem: ManualRecurringItemRow | undefined;
  pending: boolean;
  onReview: (id: string) => void;
  onDismiss: (id: string) => void;
  onRestore: (id: string) => void;
  onCorrectAmount: (id: string, amount: number) => void;
  onToggleManualEnabled: (id: string, enabled: boolean) => void;
  onDeleteManualItem: (id: string) => void;
}>) {
```

to:

```tsx
function OccurrenceTableRow({
  occurrence,
  index,
  currency,
  today,
  stream,
  manualItem,
  pending,
  onReview,
  onDismiss,
  onRestore,
  onCorrectAmount,
  onToggleManualEnabled,
  onDeleteManualItem,
}: Readonly<{
  occurrence: RecurringOccurrence;
  index: number;
  currency: string;
  today: string;
  stream: RecurringStreamRow | undefined;
  manualItem: ManualRecurringItemRow | undefined;
  pending: boolean;
  onReview: (id: string) => void;
  onDismiss: (id: string) => void;
  onRestore: (id: string) => void;
  onCorrectAmount: (id: string, amount: number) => void;
  onToggleManualEnabled: (id: string, enabled: boolean) => void;
  onDeleteManualItem: (id: string) => void;
}>) {
```

Change:

```tsx
  return (
    <tr className="border-t border-panel-border">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <MerchantAvatar name={occurrence.merchant} size={32} className="shrink-0" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{occurrence.merchant}</span>
            <span className="text-xs text-muted">{occurrence.frequency}</span>
          </span>
        </div>
      </td>
      <td className="px-4 py-3 text-sm whitespace-nowrap">
        {formatDay(occurrence.dueDate)}
        {occurrence.status === "overdue" && (
          <span className="ml-1.5 text-xs font-semibold text-accent">
            ({formatDueAnnotation(daysUntil(occurrence.dueDate, today))})
          </span>
        )}
      </td>
```

to:

```tsx
  return (
    <tr className={`border-t border-panel-border${index % 2 === 1 ? " bg-panel-2" : ""}`}>
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <MerchantAvatar name={occurrence.merchant} size={32} className="shrink-0" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{occurrence.merchant}</span>
            <span className="text-xs text-muted">{occurrence.frequency}</span>
          </span>
        </div>
      </td>
      <td className="px-4 py-3 text-sm whitespace-nowrap font-mono">
        {formatDay(occurrence.dueDate)}
        {occurrence.status === "overdue" && (
          <span className="ml-1.5 text-xs font-semibold text-accent">
            ({formatDueAnnotation(daysUntil(occurrence.dueDate, today))})
          </span>
        )}
      </td>
```

Change:

```tsx
      <td className="px-4 py-3 text-right">
        <span className="inline-flex items-center justify-end gap-1.5">
          {occurrence.status === "complete" && (
            <CheckCircle2 aria-hidden className="h-4 w-4 text-success" />
          )}
          <span data-money className={`metric-value text-sm ${occurrence.isIncome ? "text-success" : ""}`}>
            {occurrence.isIncome ? "+" : ""}
            {formatCurrency(occurrence.amount, currency)}
          </span>
        </span>
      </td>
```

to:

```tsx
      <td className="px-4 py-3 text-right">
        <span className="inline-flex items-center justify-end gap-1.5">
          {occurrence.status === "complete" && (
            <CheckCircle2 aria-hidden className="h-4 w-4 text-success" />
          )}
          <span
            data-money
            className="metric-value text-sm"
            style={{ color: occurrence.isIncome ? "var(--viz-pos)" : "var(--viz-neg)" }}
          >
            {occurrence.isIncome ? "+" : ""}
            {formatCurrency(occurrence.amount, currency)}
          </span>
        </span>
      </td>
```

Change:

```tsx
        <thead className="bg-panel-2 text-xs text-muted">
          <tr>
            <th scope="col" className="px-4 py-3 text-left">Merchant</th>
```

to:

```tsx
        <thead className="bg-panel-2 text-xs text-muted font-mono">
          <tr>
            <th scope="col" className="px-4 py-3 text-left">Merchant</th>
```

Change:

```tsx
          {occurrences.map((occurrence, index) => (
            <OccurrenceTableRow
              key={`${occurrence.sourceId}-${occurrence.dueDate}-${index}`}
              occurrence={occurrence}
              currency={currency}
```

to:

```tsx
          {occurrences.map((occurrence, index) => (
            <OccurrenceTableRow
              key={`${occurrence.sourceId}-${occurrence.dueDate}-${index}`}
              occurrence={occurrence}
              index={index}
              currency={currency}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/recurring-list-render.test.ts -t "Upcoming/Complete tables"`
Expected: PASS, all 10 tests in this describe block (7 existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add components/recurring/RecurringList.tsx tests/unit/recurring-list-render.test.ts
git commit -m "feat: apply register styling to the recurring occurrence table"
```

---

### Task 2: `ManualItemRow` — privacy-blur fix and color

**Files:**
- Modify: `components/recurring/RecurringList.tsx`
- Modify: `tests/unit/recurring-list-render.test.ts` (the `describe("RecurringList — Manage tab", ...)` block only)

**Interfaces:** None new — `ManualItemRow`'s props are unchanged.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/recurring-list-render.test.ts`, add these two tests as the last two `it(...)` blocks inside `describe("RecurringList — Manage tab", ...)`:

```ts
  it("marks a manual expense item's amount with the privacy-blur hook and the negative diverging token", () => {
    const html = renderToStaticMarkup(
      createElement(RecurringList, {
        occurrences: [],
        streams: [],
        manualItems: [manualItem({ itemType: "expense", amount: 80 })],
        currency: "USD",
        today: "2026-07-10",
        tab: "manage",
        links: LINKS,
      }),
    );
    expect(html).toContain("data-money");
    expect(html).toContain("var(--viz-neg)");
  });

  it("colors a manual income item's amount with the positive diverging token", () => {
    const html = renderToStaticMarkup(
      createElement(RecurringList, {
        occurrences: [],
        streams: [],
        manualItems: [manualItem({ itemType: "income", amount: 500, name: "Freelance" })],
        currency: "USD",
        today: "2026-07-10",
        tab: "manage",
        links: LINKS,
      }),
    );
    expect(html).toContain("var(--viz-pos)");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/recurring-list-render.test.ts -t "Manage tab"`
Expected: FAIL — `ManualItemRow`'s amount is currently embedded in a plain `text-xs text-muted` string with no `data-money` attribute and no color, so neither `data-money` nor `var(--viz-pos)`/`var(--viz-neg)` is present.

- [ ] **Step 3: Write the implementation**

In `components/recurring/RecurringList.tsx`, change:

```tsx
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold">{item.name}</span>
        <span className="text-xs text-muted">
          {formatDay(item.nextDate)} · {manualFrequencyLabel(item.frequency)} ·{" "}
          {item.itemType === "income" ? "+" : ""}
          {formatCurrency(item.amount, currency)}
        </span>
      </span>
```

to:

```tsx
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold">{item.name}</span>
        <span className="text-xs text-muted">
          <span className="font-mono">{formatDay(item.nextDate)}</span> ·{" "}
          {manualFrequencyLabel(item.frequency)} ·{" "}
          <span
            data-money
            style={{ color: item.itemType === "income" ? "var(--viz-pos)" : "var(--viz-neg)" }}
          >
            {item.itemType === "income" ? "+" : ""}
            {formatCurrency(item.amount, currency)}
          </span>
        </span>
      </span>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/recurring-list-render.test.ts -t "Manage tab"`
Expected: PASS, all 3 tests (1 existing + 2 new).

- [ ] **Step 5: Run the full file to confirm no cross-block regression**

Run: `npx vitest run tests/unit/recurring-list-render.test.ts`
Expected: PASS — all tests across every describe block in the file, including `ReviewBanner` (untouched).

- [ ] **Step 6: Commit**

```bash
git add components/recurring/RecurringList.tsx tests/unit/recurring-list-render.test.ts
git commit -m "fix: cover manual recurring items with the privacy-blur hook and money-direction color"
```

---

### Task 3: `MonthSummary.tsx` — privacy-blur fix

**Files:**
- Modify: `components/recurring/MonthSummary.tsx`
- Test: `tests/unit/month-summary-render.test.ts` (new — no existing test covers this component today)

**Interfaces:** None new — `MonthSummary`'s and `SummaryColumn`'s props are unchanged.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/month-summary-render.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import MonthSummary from "@/components/recurring/MonthSummary";
import type { RecurringMonth } from "@/lib/recurring-page";

function totals(overrides: Partial<RecurringMonth["totals"]> = {}): RecurringMonth["totals"] {
  return {
    income: { paid: 2000, remaining: 450 },
    expenses: { paid: 1200, remaining: 300 },
    creditCards: { paid: 0, remaining: 0 },
    ...overrides,
  };
}

describe("MonthSummary", () => {
  it("shows each column's total, paid, and remaining figures", () => {
    const html = renderToStaticMarkup(
      createElement(MonthSummary, { totals: totals(), currency: "USD" }),
    );
    expect(html).toContain("$2,450.00 total");
    expect(html).toContain("$2,000.00 paid");
    expect(html).toContain("$450.00 remaining");
  });

  it("carries the total figure inside the privacy-blur hook, alongside paid and remaining", () => {
    const html = renderToStaticMarkup(
      createElement(MonthSummary, { totals: totals(), currency: "USD" }),
    );
    // Income and Expenses columns each render 3 data-money spans (total, paid,
    // remaining); Credit cards is hidden (0/0), so 2 columns x 3 = 6.
    expect(html.match(/data-money/g)?.length).toBe(6);
  });

  it("shows a credit cards column only when there is credit card activity", () => {
    const withCards = renderToStaticMarkup(
      createElement(MonthSummary, {
        totals: totals({ creditCards: { paid: 100, remaining: 50 } }),
        currency: "USD",
      }),
    );
    expect(withCards).toContain("Credit cards");

    const withoutCards = renderToStaticMarkup(
      createElement(MonthSummary, { totals: totals(), currency: "USD" }),
    );
    expect(withoutCards).not.toContain("Credit cards");
  });
});
```

- [ ] **Step 2: Run the tests to verify the privacy-blur one fails**

Run: `npx vitest run tests/unit/month-summary-render.test.ts`
Expected: 2 PASS (figures, credit-cards conditional — pre-existing behavior), 1 FAIL (`data-money` count is 4, not 6 — the total span in each of the 2 visible columns lacks it).

- [ ] **Step 3: Write the implementation**

In `components/recurring/MonthSummary.tsx`, change:

```tsx
        {total > 0 && (
          <span className="text-muted">{formatCurrency(total, currency)} total</span>
        )}
```

to:

```tsx
        {total > 0 && (
          <span data-money className="text-muted">{formatCurrency(total, currency)} total</span>
        )}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/month-summary-render.test.ts`
Expected: PASS, all 3 tests.

- [ ] **Step 5: Commit**

```bash
git add components/recurring/MonthSummary.tsx tests/unit/month-summary-render.test.ts
git commit -m "fix: cover MonthSummary's total figure with the privacy-blur hook"
```

---

### Task 4: Full verification and manual QA

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

Open `/recurring` on a month with at least two upcoming occurrences (one income, one expense) and at least one manual item of each type. Confirm:

- Upcoming/Complete tables: rows alternate a subtle background tint; dates render in the mono face; income occurrences are green (`var(--viz-pos)`), expense occurrences are red (`var(--viz-neg)`) — including ordinary expenses, which previously had no color at all.
- The "complete" checkmark icon (when a Complete-tab row has one) still renders its own green regardless of the row's own money-direction color — this task didn't touch it.
- Manage tab: a manual expense item's amount blurs under the privacy toggle and is red; a manual income item's amount blurs and is green; the date portion of each manual item's meta line is in the mono face.
- Above the table, `MonthSummary`'s "total" figure (next to each of Income/Expenses/Credit cards) now blurs under the privacy toggle, where it didn't before; "paid"/"remaining" still blur as they did before.
- Toggle dark mode: colors and zebra stripes still read correctly.
- Confirm nothing about tab switching, review flow (Confirm/Not recurring/Restore), or the manual-item add form changed — this plan is styling-only.

- [ ] **Step 3: Stop the dev server**

Stop the `npm run dev` process once manual QA is complete.
