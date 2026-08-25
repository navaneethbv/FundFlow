# Notifications and Settings Register Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The smallest and last plan in this rollout. Close the two real gaps
deep research found: `app/notifications/page.tsx`'s delivery-history block never
got `font-mono`/zebra, and two of the four money-bearing Settings sections named
in the roadmap (`BudgetsSection`, `SinkingFundsSection`) have bare
`formatCurrency()` calls with no `data-money`/`.metric-value` — a real
privacy-blur gap, not a design decision.

**Architecture:** The delivery-history block is inline JSX in
`app/notifications/page.tsx` (no separate component). Of the four Settings
sections the roadmap named, two need no changes at all: `SettleUpSection.tsx`
already uses `.metric-value` correctly on both its money spans, and
`CardAprSection.tsx` has no currency figures — APR is a rate, not money, so
neither `.metric-value` nor `--viz-pos`/`--viz-neg` apply. This plan touches only
`app/notifications/page.tsx`, `BudgetsSection.tsx`, and `SinkingFundsSection.tsx`.
No `RegisterRow` adoption — the delivery-history list is only 6 rows with no
money content, and the two Settings sections are order-independent config lists,
not chronological transaction lists.

**Tech Stack:** Next.js 16 App Router, TypeScript, Tailwind 4, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-24-app-wide-register-design.md` — the
"Phase 7/8/9 decisions" section covers this phase too (the `data-money` gaps here
are correctness fixes, not a design choice requiring sign-off).

## Global Constraints

- `font-mono` is reserved for labels/dates/eyebrows, never money.
- Every money figure must carry `.money`, `.metric-value`, or `data-money`.
- No color changes in this plan — none of the figures touched here represent an
  inflow/outflow or a budget-vs-limit comparison the way Phase 8's did; a budget
  limit, a sinking-fund target, and a due date are plain reference figures.
- No new CSS custom properties, no new fonts, no changes to `docs/PALETTE.md` or
  `scripts/validate_palette.js`.
- `npx vitest run <file>` for one test file; `npm run test:unit` for the suite;
  `npx tsc --noEmit`; `npm run build`; `npm run lint`.

---

### Task 1: `app/notifications/page.tsx` — `font-mono` dates, zebra rows

**Files:**
- Modify: `app/notifications/page.tsx`
- Modify: `tests/unit/notifications-page.test.ts`

**Interfaces:** None new.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/notifications-page.test.ts`, add a new test alongside the
existing ones (matching the file's existing raw-source-string style — it does
not render the page, since this is an async Server Component with no client
test harness):

```ts
it("zebra-stripes the delivery history and sets its dates in the mono face", () => {
  const source = readFileSync("app/notifications/page.tsx", "utf8");
  expect(source).toContain("deliveries.map((delivery, index)");
  expect(source).toContain('index % 2 === 1 ? " bg-panel-2" : ""');
  expect(source).toContain("font-mono");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/notifications-page.test.ts -t "zebra-stripes"`
Expected: FAIL — current code maps with `(delivery)`, no index, no
conditional zebra class, and no `font-mono` anywhere in the file.

- [ ] **Step 3: Write the implementation**

In `app/notifications/page.tsx`, change:

```tsx
          <Panel title="Weekly delivery history" eyebrow="Last 6 reports">
            <div className="space-y-3 text-sm">
              {(deliveries ?? []).map((delivery) => (
                <div key={`${delivery.period_start}-${delivery.attempted_at}`} className="flex items-center justify-between gap-3 rounded-field bg-panel-2 p-3">
                  <span>
                    <span className="block font-semibold">{formatDate(delivery.period_start)} to {formatDate(delivery.period_end)}</span>
                    <span className="block text-xs text-muted">{delivery.sent_at ? `Sent ${formatDate(delivery.sent_at)}` : "Delivery attempted"}</span>
                  </span>
                  <Badge tone={deliveryStatusTone(delivery.status)}>{delivery.status}</Badge>
                </div>
              ))}
              {(deliveries ?? []).length === 0 && <p className="py-4 text-sm text-muted">Your first weekly delivery will appear here after it is prepared.</p>}
            </div>
          </Panel>
```

to:

```tsx
          <Panel title="Weekly delivery history" eyebrow="Last 6 reports">
            <div className="space-y-3 text-sm">
              {(deliveries ?? []).map((delivery, index) => (
                <div
                  key={`${delivery.period_start}-${delivery.attempted_at}`}
                  className={`flex items-center justify-between gap-3 rounded-field p-3${index % 2 === 1 ? " bg-panel-2" : ""}`}
                >
                  <span>
                    <span className="block font-semibold font-mono">
                      {formatDate(delivery.period_start)} to {formatDate(delivery.period_end)}
                    </span>
                    <span className="block text-xs text-muted font-mono">
                      {delivery.sent_at ? `Sent ${formatDate(delivery.sent_at)}` : "Delivery attempted"}
                    </span>
                  </span>
                  <Badge tone={deliveryStatusTone(delivery.status)}>{delivery.status}</Badge>
                </div>
              ))}
              {(deliveries ?? []).length === 0 && <p className="py-4 text-sm text-muted">Your first weekly delivery will appear here after it is prepared.</p>}
            </div>
          </Panel>
```

The row previously had a flat `bg-panel-2` background on every row; the zebra
treatment now applies it only to odd-indexed rows, matching the convention used
everywhere else in this rollout (`RegisterRow`, `OccurrenceTableRow`, etc.).
`Badge tone={deliveryStatusTone(delivery.status)}` is unchanged — it's a
delivery-status indicator, not a money figure, out of scope.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/notifications-page.test.ts`
Expected: PASS, all tests in the file.

- [ ] **Step 5: Commit**

```bash
git add app/notifications/page.tsx tests/unit/notifications-page.test.ts
git commit -m "fix: zebra-stripe and apply font-mono to the notifications delivery history"
```

---

### Task 2: `components/settings/BudgetsSection.tsx` — close `data-money` gaps

**Files:**
- Modify: `components/settings/BudgetsSection.tsx`
- Create: `tests/unit/budgets-section-render.test.ts`

**Interfaces:** None new. No existing test file covers this component today.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/budgets-section-render.test.ts`. First read
`components/settings/BudgetsSection.tsx` in full to confirm its exact prop
interface (name, budgets array shape, householdId, suggestion props, callback
signatures) — the snippets in Step 3 below show only the two lines that change,
not the complete component, and a real fixture must match the real props
exactly. Build the fixture the same way
`tests/unit/sinking-funds-section.test.ts` does for its sibling component
(`vi.fn()` stand-ins for any handler props):

```ts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import BudgetsSection from "@/components/settings/BudgetsSection";

describe("BudgetsSection", () => {
  it("wraps each budget's monthly limit inside the privacy-blur hook", () => {
    // Render with at least one budget row present (matching the component's
    // real prop shape, confirmed by reading the file first) and assert:
    // expect(html).toContain("data-money");
  });

  it("wraps a suggested budget's median and CTA amount inside the privacy-blur hook", () => {
    // Render with at least one open suggestion present and assert both the
    // existing median span (already has data-money) and the new CTA amount
    // span carry data-money — i.e. at least two occurrences for that one
    // suggestion row.
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/budgets-section-render.test.ts`
Expected: FAIL once the placeholder assertions above are filled in against the
component's real prop shape and the current markup (no `data-money` on the
budget-limit span or the suggestion CTA amount).

- [ ] **Step 3: Write the implementation**

In `components/settings/BudgetsSection.tsx`, change the budget row's limit
figure:

```tsx
                <span className="mb-1 flex justify-between gap-3 font-semibold">
                  <span>{b.category}</span>
                  <span>{formatCurrency(b.monthly_limit)}</span>
                </span>
```

to:

```tsx
                <span className="mb-1 flex justify-between gap-3 font-semibold">
                  <span>{b.category}</span>
                  <span data-money>{formatCurrency(b.monthly_limit)}</span>
                </span>
```

Change the suggestion CTA amount:

```tsx
                <Button
                  onClick={() =>
                    insertBudget(suggestion.category, suggestion.suggestedLimit)
                  }
                  variant="ghost"
                  size="sm"
                >
                  Add {formatCurrency(suggestion.suggestedLimit)}
                </Button>
```

to:

```tsx
                <Button
                  onClick={() =>
                    insertBudget(suggestion.category, suggestion.suggestedLimit)
                  }
                  variant="ghost"
                  size="sm"
                >
                  Add <span data-money>{formatCurrency(suggestion.suggestedLimit)}</span>
                </Button>
```

(The suggestion's median line, `<span data-money className="block text-xs text-muted">median {formatCurrency(suggestion.median)} over...`,
already has `data-money` — unchanged.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/budgets-section-render.test.ts`
Expected: PASS, both tests.

Also run: `npm run test:unit` to confirm no other test that renders
`BudgetsSection` (check `tests/unit/settings-*.test.ts` for indirect coverage)
regresses on the markup change.

- [ ] **Step 5: Commit**

```bash
git add components/settings/BudgetsSection.tsx tests/unit/budgets-section-render.test.ts
git commit -m "fix: close data-money gaps on BudgetsSection's limit and suggestion CTA figures"
```

---

### Task 3: `components/settings/SinkingFundsSection.tsx` — `font-mono` due date, `data-money` gap

**Files:**
- Modify: `components/settings/SinkingFundsSection.tsx`
- Modify: `tests/unit/sinking-funds-section.test.ts`

**Interfaces:** None new.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/sinking-funds-section.test.ts`, add a new test alongside the
existing one, reusing that file's existing fixture-building helpers:

```ts
it("sets the due date in the mono face and wraps the target amount in the privacy-blur hook", () => {
  const html = /* render the same way the existing test does */;
  expect(html).toContain('<span class="font-mono">');
  expect(html).toContain("data-money");
});
```

(Fill in the render call exactly as the existing
`it("...", () => { ... })` block in this file does — same component, same
fixture shape — rather than duplicating fixture-construction logic here.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/sinking-funds-section.test.ts`
Expected: FAIL — the new test's `font-mono`/`data-money` assertions fail
against the current markup (`plan.dueDate` and `fund.target_amount` are both
unwrapped).

- [ ] **Step 3: Write the implementation**

In `components/settings/SinkingFundsSection.tsx`, change:

```tsx
                    <p className="mt-1 text-xs text-muted">
                      Next due {plan.dueDate}, {formatCurrency(plan.monthlySetAside)} monthly
                    </p>
                  </div>
                  <p className="shrink-0 font-semibold">
                    {formatCurrency(Number(fund.target_amount))}
                  </p>
```

to:

```tsx
                    <p className="mt-1 text-xs text-muted">
                      Next due <span className="font-mono">{plan.dueDate}</span>,{" "}
                      <span data-money>{formatCurrency(plan.monthlySetAside)}</span> monthly
                    </p>
                  </div>
                  <p data-money className="shrink-0 font-semibold">
                    {formatCurrency(Number(fund.target_amount))}
                  </p>
```

`plan.dueDate` is `fund.due_date` verbatim (a raw ISO string, e.g.
`"2026-09-01"`, not run through `formatDate`) — this task wraps it in
`font-mono` as-is and does not change the date-formatting function, matching
the precedent set by Recurring's `ManualItemRow` task (kept `formatDay`,
only added `font-mono`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/sinking-funds-section.test.ts`
Expected: PASS, all tests in the file.

- [ ] **Step 5: Commit**

```bash
git add components/settings/SinkingFundsSection.tsx tests/unit/sinking-funds-section.test.ts
git commit -m "fix: apply font-mono to the sinking fund due date and close a data-money gap"
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

Open `/notifications`. Confirm:

- The delivery-history block (if any deliveries exist in the seeded/demo data)
  shows alternating row backgrounds and mono-face dates.
- Every other section (preference toggles, timezone selects, push settings) is
  visually unchanged.

Open `/settings` and navigate to the Budgets and Sinking Funds sections
(likely via `?section=budgets`/similar — confirm the actual query param by
reading `app/settings/page.tsx`'s section-routing logic if unclear). Confirm:

- A budget's monthly limit and a suggested budget's CTA amount both blur under
  the privacy toggle.
- A sinking fund's due date is mono; its target amount and monthly set-aside
  figure both blur under the privacy toggle.
- `SettleUpSection` and `CardAprSection` are visually unchanged (this plan
  doesn't touch them).
- Dark mode: all three sections read correctly.

- [ ] **Step 3: Stop the dev server**

Stop the `npm run dev` process once manual QA is complete.
