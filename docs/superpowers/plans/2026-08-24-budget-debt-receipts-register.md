# Budget, Debt, and Receipts Register Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the three "TBD" verdicts the original survey left open. Deep
research read every file in full and found: no chronological list on any of the
three pages (no `RegisterRow` adoption anywhere in this plan), real `data-money`
privacy-blur gaps throughout Budget and Debt and on every visible receipt total,
and — per the user's explicit decision — Budget's "remaining" and Debt's balance/
interest figures move onto `--viz-pos`/`--viz-neg`.

**Architecture:** Three independent pages, three independent task groups, no
shared code between them beyond already-existing primitives (`Badge`, `Panel`,
`formatCurrency`). Budget is grid/envelope-shaped (category rows, not dates);
Debt's payoff-order table is priority-sorted (`payoffMonth` is a month-count, not
a calendar date); Receipts is a status-sorted 2-column card grid, each card too
dense (upload metadata, image link, action buttons) to fit `RegisterRow`'s
`<li>` contract. All three get targeted color/mono/`data-money` fixes instead.

**Tech Stack:** Next.js 16 App Router, TypeScript, Tailwind 4, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-24-app-wide-register-design.md` — read
the "Phase 7/8/9 decisions" section before starting. It documents exactly which
color props are in scope (money figures' text color) and which are explicitly not
(`Panel tone=`, `ProgressBar tone=`, `bg-danger`/`bg-success` container tints,
`Badge`'s pill background/border chrome).

## Global Constraints

- `--viz-pos`/`--viz-neg` are the money-direction colors; `--success`/`--danger`
  classes are status-semantic. Per the user's decision, Budget's `remaining`
  figures get the conditional `remaining >= 0 ? viz-pos : viz-neg` treatment
  (it's genuinely signed — over or under budget); Debt's balance/interest figures
  get **unconditional** `var(--viz-neg)` — a debt balance or its interest is
  always a cost, with no positive case, matching `CashFlowSummary`'s "Expenses
  always red" precedent, not a sign check.
- Out of scope, explicitly: `Panel tone=`, `ProgressBar tone=`, the `bg-danger`/
  `bg-success` background tint on Budget's "Left to Budget" hero bar, and
  `Badge`'s pill background/border. These are container/indicator chrome, not a
  money figure's text color — rule 2 only governs the latter.
- `font-mono` is reserved for labels/dates/eyebrows, never money.
- Every money figure must carry `.money`, `.metric-value`, or `data-money`.
- No new CSS custom properties, no new fonts, no changes to `docs/PALETTE.md` or
  `scripts/validate_palette.js`.
- `npx vitest run <file>` for one test file; `npm run test:unit` for the suite;
  `npx tsc --noEmit`; `npm run build`; `npm run lint`.

---

### Task 1: `components/budget/BudgetTable.tsx` — color tokens, `data-money` gaps

**Files:**
- Modify: `components/budget/BudgetTable.tsx`
- Modify: `tests/unit/budget-planner-render.test.ts` (the `describe("BudgetTable", ...)` block only)

**Interfaces:** None new. `BudgetRow`, `RowMenu` signatures unchanged.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/budget-planner-render.test.ts`, replace the
`it("shows the remaining amount as a danger badge only when over budget", ...)`
test (inside `describe("BudgetTable", ...)`) with:

```ts
  it("colors the remaining amount with the money-direction tokens in both the over- and under-budget cases", () => {
    const over = renderToStaticMarkup(
      createElement(BudgetTable, {
        section: section({
          lines: [line({ actual: 500, remaining: -100 })],
        }),
        currency: "USD",
        disabled: false,
        onUpdate: vi.fn(),
      }),
    );
    expect(over).toContain("-$100.00");
    expect(over).toContain("var(--viz-neg)");

    const under = renderToStaticMarkup(
      createElement(BudgetTable, {
        section: section(),
        currency: "USD",
        disabled: false,
        onUpdate: vi.fn(),
      }),
    );
    expect(under).toContain("$100.00");
    expect(under).toContain("var(--viz-pos)");
  });

  it("carries every remaining/actual/planned figure inside the privacy-blur hook", () => {
    const html = renderToStaticMarkup(
      createElement(BudgetTable, {
        section: section(),
        currency: "USD",
        disabled: false,
        onUpdate: vi.fn(),
      }),
    );
    // Section header: planned, actual, remaining (3). Row: remaining (1). 4 total.
    const occurrences = html.match(/data-money/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(4);
  });

  it("colors the section-header remaining figure symmetrically, not just the over-budget case", () => {
    const surplus = renderToStaticMarkup(
      createElement(BudgetTable, {
        section: section({ remaining: 50 }),
        currency: "USD",
        disabled: false,
        onUpdate: vi.fn(),
      }),
    );
    expect(surplus).toContain("var(--viz-pos)");
    expect(surplus).not.toContain("text-danger");
    expect(surplus).not.toContain("text-foreground\"");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/budget-planner-render.test.ts -t "BudgetTable"`
Expected: FAIL — current code uses `text-danger`/`text-foreground` and no
`data-money` on the row-level remaining figure.

- [ ] **Step 3: Write the implementation**

In `components/budget/BudgetTable.tsx`, remove the now-unused `cn` import:

```tsx
import { cn } from "@/lib/cn";
```

(delete this line entirely — after the edits below, `BudgetTable.tsx` has no
remaining `cn()` call.)

Change the section header's remaining figure:

```tsx
          <span
            data-money
            className={cn("text-sm font-bold", section.remaining < 0 ? "text-danger" : "text-foreground")}
          >
            {formatCurrency(section.remaining, currency)} remaining
          </span>
```

to:

```tsx
          <span
            data-money
            className="text-sm font-bold"
            style={{ color: section.remaining >= 0 ? "var(--viz-pos)" : "var(--viz-neg)" }}
          >
            {formatCurrency(section.remaining, currency)} remaining
          </span>
```

Change the unbudgeted row's remaining badge:

```tsx
        <td className="px-4 py-3 text-right">
          <Badge tone="danger">{formatCurrency(line.remaining, currency)}</Badge>
        </td>
```

to:

```tsx
        <td className="px-4 py-3 text-right">
          <Badge tone="danger" data-money style={{ color: "var(--viz-neg)" }}>
            {formatCurrency(line.remaining, currency)}
          </Badge>
        </td>
```

Change `BudgetRow`'s remaining cell:

```tsx
      <td className="px-4 py-3 text-right align-top">
        {over ? (
          <Badge tone="danger">{formatCurrency(line.remaining, currency)}</Badge>
        ) : (
          <span className="font-semibold">{formatCurrency(line.remaining, currency)}</span>
        )}
      </td>
```

to:

```tsx
      <td className="px-4 py-3 text-right align-top">
        {over ? (
          <Badge tone="danger" data-money style={{ color: "var(--viz-neg)" }}>
            {formatCurrency(line.remaining, currency)}
          </Badge>
        ) : (
          <span data-money className="font-semibold" style={{ color: "var(--viz-pos)" }}>
            {formatCurrency(line.remaining, currency)}
          </span>
        )}
      </td>
```

`Badge` forwards arbitrary props (including `data-money` and `style`) onto its
underlying `<span>` via `{...props}` (confirmed in `components/ui/Badge.tsx`),
so the inline `style` color safely overrides the tone-mapped `text-danger` class
Badge applies internally — CSS specificity favors the inline style, and the
pill's background/border chrome (`bg-danger/10`, `border-danger/25`) is
untouched, per the Global Constraints.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/budget-planner-render.test.ts -t "BudgetTable"`
Expected: PASS, all tests in this describe block.

- [ ] **Step 5: Commit**

```bash
git add components/budget/BudgetTable.tsx tests/unit/budget-planner-render.test.ts
git commit -m "fix: apply money-direction color and close data-money gaps in BudgetTable"
```

---

### Task 2: `components/budget/BudgetPlanner.tsx` — `TotalsRow`, year/decade tables

**Files:**
- Modify: `components/budget/BudgetPlanner.tsx`
- Modify: `tests/unit/budget-planner-render.test.ts` (the `describe("BudgetPlanner", ...)` block — one new assertion)

**Interfaces:** None new. `TotalsRow`, `YearTable`, `DecadeTable` prop shapes
unchanged.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/budget-planner-render.test.ts`, add a new test inside
`describe("BudgetPlanner", ...)`:

```ts
  it("colors the TotalsRow remaining figure with the money-direction tokens", () => {
    const html = renderToStaticMarkup(
      createElement(BudgetPlanner, {
        initialView: { horizon: "monthly" as const, month: pageData({ totalExpenses: { planned: 2400, actual: 2500, remaining: -100 } }) },
        proposals: [],
        month: "2026-07",
        currency: "USD",
        summaryTab: "summary" as const,
        summaryLinks: {
          summary: "/budget",
          income: "/budget?summary=income",
          expenses: "/budget?summary=expenses",
        },
      }),
    );
    expect(html).toContain("var(--viz-neg)");
    expect(html).not.toContain("text-danger");
  });
```

(`bg-danger` from the existing "tints the Left to Budget footer bar for a
deficit" test is unaffected — that background tint is explicitly out of scope
and unchanged by this task.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/budget-planner-render.test.ts -t "BudgetPlanner"`
Expected: FAIL — current `TotalsRow` uses `text-danger`/`text-foreground`.

- [ ] **Step 3: Write the implementation**

In `components/budget/BudgetPlanner.tsx`, change `TotalsRow`'s remaining span:

```tsx
        <span
          data-money
          className={cn("text-right sm:w-24", remaining < 0 ? "text-danger" : "text-foreground")}
        >
          {formatCurrency(remaining, currency)}
        </span>
```

to:

```tsx
        <span
          data-money
          className="text-right sm:w-24"
          style={{ color: remaining >= 0 ? "var(--viz-pos)" : "var(--viz-neg)" }}
        >
          {formatCurrency(remaining, currency)}
        </span>
```

(`cn` stays imported — `BudgetPlanner.tsx`'s Left-to-Budget hero div at the
bottom of the file still uses it for the out-of-scope `bg-danger`/`bg-success`
conditional class.)

In `YearTable`, change the remaining `<td>`:

```tsx
                <td className="py-3 text-right">
                  {formatCurrency(month.totalExpenses.remaining, currency)}
                </td>
```

to:

```tsx
                <td
                  data-money
                  className="py-3 text-right"
                  style={{ color: month.totalExpenses.remaining >= 0 ? "var(--viz-pos)" : "var(--viz-neg)" }}
                >
                  {formatCurrency(month.totalExpenses.remaining, currency)}
                </td>
```

and the header row plus the row header
(`<th scope="row" className="py-3 text-left font-semibold">{formatMonth(month.month)}</th>`)
each gain `font-mono`:

```tsx
            <tr>
              <th scope="col" className="py-3 text-left">Month</th>
```
→
```tsx
            <tr className="font-mono">
              <th scope="col" className="py-3 text-left">Month</th>
```

```tsx
                <th scope="row" className="py-3 text-left font-semibold">
                  {formatMonth(month.month)}
                </th>
```
→
```tsx
                <th scope="row" className="py-3 text-left font-semibold font-mono">
                  {formatMonth(month.month)}
                </th>
```

Apply the identical pair of changes to `DecadeTable` (its remaining `<td>`,
its `<thead><tr>`, and its `<th scope="row">{year.year}</th>` row header) —
same structure, `view.years` instead of `view.months`, `year.remaining`/
`year.year` instead of `month.totalExpenses.remaining`/`month.month`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/budget-planner-render.test.ts`
Expected: PASS, all tests in the file.

- [ ] **Step 5: Commit**

```bash
git add components/budget/BudgetPlanner.tsx tests/unit/budget-planner-render.test.ts
git commit -m "fix: apply money-direction color and font-mono to BudgetPlanner's totals and horizon tables"
```

---

### Task 3: `components/budget/BudgetRightRail.tsx` and `SeedBudgetButton.tsx`

**Files:**
- Modify: `components/budget/BudgetRightRail.tsx`
- Modify: `components/budget/SeedBudgetButton.tsx`
- Modify: `tests/unit/budget-planner-render.test.ts` (the `describe("BudgetRightRail", ...)` block)

**Interfaces:** None new.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/budget-planner-render.test.ts`, replace
`it("tints the hero red for a deficit", ...)` with:

```ts
  it("colors the hero figure with the money-direction tokens for a deficit", () => {
    const html = renderToStaticMarkup(
      createElement(BudgetRightRail, {
        data: pageData({ leftToBudget: -400 }),
        currency: "USD",
        tab: "summary" as const,
        links,
      }),
    );
    expect(html).toContain("var(--viz-neg)");
    expect(html).not.toContain("text-danger");
    expect(html).toContain("-$400.00");
  });

  it("colors the expense-remaining figure symmetrically on the expenses tab", () => {
    const html = renderToStaticMarkup(
      createElement(BudgetRightRail, {
        data: pageData({ totalExpenses: { planned: 2400, actual: 2300, remaining: 100 } }),
        currency: "USD",
        tab: "expenses" as const,
        links,
      }),
    );
    expect(html).toContain("var(--viz-pos)");
    expect(html).not.toContain("text-foreground\"");
  });
```

(The `Panel tone={negative ? "danger" : "success"}` background tint is
out of scope — no test targets it and it stays unchanged.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/budget-planner-render.test.ts -t "BudgetRightRail"`
Expected: FAIL — current code uses `text-danger`/`text-success`/`text-foreground`.

- [ ] **Step 3: Write the implementation**

In `components/budget/BudgetRightRail.tsx`, change the hero figure:

```tsx
        <p
          data-money
          className={cn("metric-value text-3xl", negative ? "text-danger" : "text-success")}
        >
          {formatCurrency(data.leftToBudget, currency)}
        </p>
```

to:

```tsx
        <p
          data-money
          className="metric-value text-3xl"
          style={{ color: negative ? "var(--viz-neg)" : "var(--viz-pos)" }}
        >
          {formatCurrency(data.leftToBudget, currency)}
        </p>
```

(`Panel tone={negative ? "danger" : "success"}` on the wrapping `Panel`, two
lines above, is unchanged — background tint, out of scope.)

Change the expense-remaining row:

```tsx
              <div className="flex justify-between text-sm">
                <span className="text-muted">Expense remaining</span>
                <span
                  data-money
                  className={cn(
                    "font-semibold",
                    data.totalExpenses.remaining < 0 ? "text-danger" : "text-foreground",
                  )}
                >
                  {formatCurrency(data.totalExpenses.remaining, currency)}
                </span>
              </div>
```

to:

```tsx
              <div className="flex justify-between text-sm">
                <span className="text-muted">Expense remaining</span>
                <span
                  data-money
                  className="font-semibold"
                  style={{ color: data.totalExpenses.remaining >= 0 ? "var(--viz-pos)" : "var(--viz-neg)" }}
                >
                  {formatCurrency(data.totalExpenses.remaining, currency)}
                </span>
              </div>
```

Change `GroupMiniSummary`'s remaining span:

```tsx
        <span data-money className={over ? "text-danger" : undefined}>
          {formatCurrency(remaining, currency)} remaining
        </span>
```

to:

```tsx
        <span data-money style={{ color: over ? "var(--viz-neg)" : "var(--viz-pos)" }}>
          {formatCurrency(remaining, currency)} remaining
        </span>
```

After these three edits, check whether `cn` still has any call site in
`BudgetRightRail.tsx` (its only other prior usage was the hero figure's
`className` above); if none remains, remove the `import { cn } from "@/lib/cn";`
line — mirroring Task 1's handling of the same situation in `BudgetTable.tsx`.

In `components/budget/SeedBudgetButton.tsx`, change:

```tsx
              <p className="mt-2 text-xs text-muted">
                {formatCurrency(row.suggested_amount, currency)} per month.{" "}
                {row.reason}
              </p>
```

to:

```tsx
              <p className="mt-2 text-xs text-muted">
                <span data-money>{formatCurrency(row.suggested_amount, currency)}</span> per month.{" "}
                {row.reason}
              </p>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/budget-planner-render.test.ts`
Expected: PASS, all tests in the file.

- [ ] **Step 5: Commit**

```bash
git add components/budget/BudgetRightRail.tsx components/budget/SeedBudgetButton.tsx tests/unit/budget-planner-render.test.ts
git commit -m "fix: apply money-direction color and close a data-money gap in BudgetRightRail and SeedBudgetButton"
```

---

### Task 4: `components/debt/DebtPlannerView.tsx` — cost coloring, `font-mono`, `data-money`

**Files:**
- Modify: `components/debt/DebtPlannerView.tsx`
- Modify: `tests/unit/debt-page-render.test.ts`

**Interfaces:** None new.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/debt-page-render.test.ts`, add two new tests inside
`describe("DebtPlannerView", ...)`:

```ts
  it("colors balance and interest figures with the negative money-direction token and wraps them in the privacy-blur hook", () => {
    const data = buildDebtPlannerData(
      [{ id: "card", name: "Card", balance: 1000, apr: 20 }],
      50,
    );
    const html = renderToStaticMarkup(
      createElement(DebtPlannerView, {
        data,
        strategy: "avalanche",
        extraMonthly: 50,
      }),
    );

    // Stat-grid Total balance and Total projected interest, plus the
    // table's Balance and Projected interest cells: 4 occurrences.
    const occurrences = html.match(/data-money/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(4);
    expect(html).toContain("var(--viz-neg)");
    expect(html).not.toContain("text-danger");
  });

  it("sets the table header and stat-grid labels in the mono face", () => {
    const data = buildDebtPlannerData(
      [{ id: "card", name: "Card", balance: 1000, apr: 20 }],
      50,
    );
    const html = renderToStaticMarkup(
      createElement(DebtPlannerView, {
        data,
        strategy: "avalanche",
        extraMonthly: 50,
      }),
    );
    expect(html).toContain('class="border-b border-panel-border text-xs uppercase tracking-wide text-muted font-mono"');
    expect(html).toContain('class="text-xs font-semibold uppercase tracking-wide text-muted font-mono"');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/debt-page-render.test.ts -t "DebtPlannerView"`
Expected: FAIL — current code has no `data-money`, no `var(--viz-neg)`, no
`font-mono` anywhere in this file.

- [ ] **Step 3: Write the implementation**

In `components/debt/DebtPlannerView.tsx`, change the stat-grid `dt`/`dd` pairs
for the three currency figures (Total balance, Monthly budget, Total projected
interest — **not** Debt-free projection, which is a month count, not money):

```tsx
        <Panel padding="md">
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
            Total balance
          </dt>
          <dd className="metric-value mt-1 text-2xl font-bold">
            {formatCurrency(data.totalBalance)}
          </dd>
        </Panel>
        <Panel padding="md">
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
            Monthly budget
          </dt>
          <dd className="metric-value mt-1 text-2xl font-bold">
            {formatCurrency(data.totalMonthlyBudget)}
          </dd>
        </Panel>
        <Panel padding="md">
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
            Debt-free projection
          </dt>
          <dd className="metric-value mt-1 text-2xl font-bold">
            {selectedPlan ? `${selectedPlan.months} months` : "Not reached"}
          </dd>
        </Panel>
        <Panel padding="md">
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
            Total projected interest
          </dt>
          <dd className="metric-value mt-1 text-2xl font-bold">
            {selectedPlan ? formatCurrency(selectedPlan.totalInterest) : "Not reached"}
          </dd>
        </Panel>
```

to:

```tsx
        <Panel padding="md">
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted font-mono">
            Total balance
          </dt>
          <dd data-money className="metric-value mt-1 text-2xl font-bold" style={{ color: "var(--viz-neg)" }}>
            {formatCurrency(data.totalBalance)}
          </dd>
        </Panel>
        <Panel padding="md">
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted font-mono">
            Monthly budget
          </dt>
          <dd data-money className="metric-value mt-1 text-2xl font-bold" style={{ color: "var(--viz-neg)" }}>
            {formatCurrency(data.totalMonthlyBudget)}
          </dd>
        </Panel>
        <Panel padding="md">
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted font-mono">
            Debt-free projection
          </dt>
          <dd className="metric-value mt-1 text-2xl font-bold">
            {selectedPlan ? `${selectedPlan.months} months` : "Not reached"}
          </dd>
        </Panel>
        <Panel padding="md">
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted font-mono">
            Total projected interest
          </dt>
          <dd data-money className="metric-value mt-1 text-2xl font-bold" style={{ color: "var(--viz-neg)" }}>
            {selectedPlan ? formatCurrency(selectedPlan.totalInterest) : "Not reached"}
          </dd>
        </Panel>
```

("Debt-free projection" keeps `.metric-value` unchanged — it's a month count,
not currency, so it gets no `data-money` and no color; this pre-existing
`.metric-value`-on-non-money usage is not part of this fix.)

Change the payoff-order table header and body:

```tsx
              <thead className="border-b border-panel-border text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-3">Priority</th>
                  <th className="px-3 py-3">Debt</th>
                  <th className="px-3 py-3 text-right">Balance</th>
                  <th className="px-3 py-3 text-right">APR</th>
                  <th className="px-3 py-3 text-right">Payoff projection</th>
                  <th className="px-3 py-3 text-right">Projected interest</th>
                </tr>
              </thead>
```

to:

```tsx
              <thead className="border-b border-panel-border text-xs uppercase tracking-wide text-muted font-mono">
                <tr>
                  <th className="px-3 py-3">Priority</th>
                  <th className="px-3 py-3">Debt</th>
                  <th className="px-3 py-3 text-right">Balance</th>
                  <th className="px-3 py-3 text-right">APR</th>
                  <th className="px-3 py-3 text-right">Payoff projection</th>
                  <th className="px-3 py-3 text-right">Projected interest</th>
                </tr>
              </thead>
```

and:

```tsx
                      <td className="money px-3 py-3 text-right">{formatCurrency(debt.balance)}</td>
                      <td className="money px-3 py-3 text-right">{debt.apr.toFixed(2)}%</td>
                      <td className="px-3 py-3 text-right">Month {result.payoffMonth}</td>
                      <td className="money px-3 py-3 text-right">{formatCurrency(result.interestPaid)}</td>
```

to:

```tsx
                      <td data-money className="px-3 py-3 text-right" style={{ color: "var(--viz-neg)" }}>
                        {formatCurrency(debt.balance)}
                      </td>
                      <td className="money px-3 py-3 text-right">{debt.apr.toFixed(2)}%</td>
                      <td className="px-3 py-3 text-right">Month {result.payoffMonth}</td>
                      <td data-money className="px-3 py-3 text-right" style={{ color: "var(--viz-neg)" }}>
                        {formatCurrency(result.interestPaid)}
                      </td>
```

The APR cell keeps its existing `.money` class and stays uncolored — it's a
rate, not a currency figure, and this plan does not extend the cost-coloring
decision to it (a lower APR is "better" but there is no natural inflow/outflow
or over/under-budget-style pair the way there is for a currency amount).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/debt-page-render.test.ts`
Expected: PASS, all tests in the file.

- [ ] **Step 5: Commit**

```bash
git add components/debt/DebtPlannerView.tsx tests/unit/debt-page-render.test.ts
git commit -m "fix: apply cost coloring, font-mono, and data-money to DebtPlannerView"
```

---

### Task 5: `components/transactions/ReceiptInbox.tsx` — `font-mono` dates, `data-money`

**Files:**
- Modify: `components/transactions/ReceiptInbox.tsx`
- Modify: `tests/unit/receipt-inbox-render.test.ts`

**Interfaces:** None new.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/receipt-inbox-render.test.ts`, add a new test inside
`describe("ReceiptInbox", ...)`:

```ts
  it("sets receipt dates in the mono face and wraps totals in the privacy-blur hook", () => {
    const html = renderToStaticMarkup(createElement(ReceiptInbox, {
      initialReceipts: [
        {
          id: "unmatched-1",
          transaction_id: null,
          merchant: "Cafe",
          purchase_date: "2026-08-09",
          total: 24.5,
          status: "unmatched",
          created_at: "2026-08-09T12:00:00Z",
          imageUrl: "https://signed.example/new",
          candidates: [{
            transactionId: "transaction-1",
            date: "2026-08-09",
            amount: 24.5,
            merchant: "Cafe",
            amountDifferencePercent: 0,
            dateDifferenceDays: 0,
            merchantScore: 1,
          }],
        },
      ],
    }));

    expect(html).toContain('<span class="font-mono">2026-08-09</span>');
    expect(html).toContain('<span data-money>$24.50</span>');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/receipt-inbox-render.test.ts -t "sets receipt dates"`
Expected: FAIL — current markup concatenates date and total into one plain
`text-muted` string, no `font-mono`, no `data-money`.

- [ ] **Step 3: Write the implementation**

In `components/transactions/ReceiptInbox.tsx`, change the card's date/total
line:

```tsx
              <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <p className="text-muted">
                  {receipt.purchase_date ?? "Date unknown"}
                  {receipt.total === null ? "" : ` · ${formatCurrency(receipt.total)}`}
                </p>
```

to:

```tsx
              <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <p className="text-muted">
                  <span className="font-mono">{receipt.purchase_date ?? "Date unknown"}</span>
                  {receipt.total !== null && (
                    <>
                      {" · "}
                      <span data-money>{formatCurrency(receipt.total)}</span>
                    </>
                  )}
                </p>
```

Change the candidate-transaction row:

```tsx
                      <span className="min-w-0 truncate">
                        {candidate.merchant} · {candidate.date} · {formatCurrency(Math.abs(candidate.amount))}
                      </span>
```

to:

```tsx
                      <span className="min-w-0 truncate">
                        {candidate.merchant} · <span className="font-mono">{candidate.date}</span> ·{" "}
                        <span data-money>{formatCurrency(Math.abs(candidate.amount))}</span>
                      </span>
```

No color is applied to either total — a receipt total is what was paid, not a
signed inflow/outflow or a status comparison, matching the precedent set by
Investments' `AllocationView` (money shown, no color, since it isn't gain/loss).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/receipt-inbox-render.test.ts`
Expected: PASS, all tests in the file.

- [ ] **Step 5: Commit**

```bash
git add components/transactions/ReceiptInbox.tsx tests/unit/receipt-inbox-render.test.ts
git commit -m "fix: apply font-mono to receipt dates and close data-money gaps in ReceiptInbox"
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

Open `/budget` for a month with at least one over-budget category. Confirm:

- Section-header and row-level "remaining" figures are green when under budget,
  red when over — including the previously-uncolored under-budget case.
- "Left to budget" hero figure and right-rail figures colored the same way; the
  hero panel's background tint (green/red) is unchanged.
- The Year/Decade horizon views (switch via the page's own controls, if
  reachable in this environment) show mono month/year labels and colored
  remaining figures.
- Toggle privacy blur and confirm every money figure — including the "Create
  from history" proposal amounts — blurs.

Open `/debt`. Confirm:

- Total balance, Monthly budget, and Total projected interest stat tiles are red
  (unconditional — this is new, they were uncolored before). Debt-free
  projection stays plain (not currency).
- The payoff-order table's Balance and Projected interest columns are red; APR
  stays uncolored.
- Table header and stat labels render in the mono face.
- Toggle privacy blur and confirm the new figures blur.

Open `/transactions/receipts`. Confirm:

- Each card's purchase date is mono, separated cleanly from the total.
- Candidate-transaction rows show mono dates and blur-covered totals.
- Card grid layout, sort order (unmatched first), and all actions (Attach,
  Ignore, Restore, Delete) are unchanged.
- Dark mode: all three pages read correctly.

- [ ] **Step 3: Stop the dev server**

Stop the `npm run dev` process once manual QA is complete.
