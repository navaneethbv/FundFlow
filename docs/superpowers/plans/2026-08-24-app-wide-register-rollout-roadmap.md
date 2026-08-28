# App-Wide Register Rollout Roadmap

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement Phase 0 below task-by-task. Phases 1+ are scope descriptions, not yet executable plans — see "How to use the later phases" before starting one.

**Goal:** Extend the dashboard's statement-register visual language (mono labels/dates, `--viz-pos`/`--viz-neg` for money direction, zebra-striped chronological lists) across the rest of the app, page by page, without forcing it onto pages that have no financial content.

**Architecture:** Phase 0 extracts the one piece of real, already-present duplication the survey found — five separate bespoke implementations of "zebra-striped, mono-dated, direction-colored list row" (`RecentActivity`, the transactions page's `LedgerTableRow`, `ReportTransactions`, `RecurringList`, `HoldingsTable`) — into a single shared `components/ui/RegisterRow.tsx`, and migrates the one of those five already fully understood (`RecentActivity`) to use it. Every phase after that is a separate, page-scoped plan, written just-in-time with the same research-then-plan process used for the dashboard, because a single plan spanning 20 routes would not produce independently shippable, testable software (see the Scope Check in this codebase's planning process).

**Tech Stack:** Next.js 16 App Router, TypeScript, Tailwind 4, Supabase, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-24-app-wide-register-design.md` — read this first for the house rules, the two convention-fix decisions (Accounts' inverted mono usage, RecentActivity's `text-success` coloring), and the full page-by-page verdict table this roadmap's phases are drawn from.

## Global Constraints

(These match the constraints the dashboard phase was built under; restated here since this roadmap is a separate entry point.)

- Amount sign follows Plaid: positive = money out, negative = money in. Any conversion to a display/ledger sign uses `delta = -transaction.amount`.
- Every money figure must carry `.money` (via `<Money>`), `.metric-value`, or sit inside a `data-money` container, or it silently escapes the privacy-blur toggle.
- `font-mono` is reserved for labels/dates/eyebrows, never money (rule 1 of the spec above) — this is the one rule Phase 6 (Accounts) exists specifically to correct where it's currently violated.
- `--viz-pos`/`--viz-neg` are the money-direction colors; `--success`/`--danger` are status-semantic and not to be used for a plain inflow/outflow.
- No new CSS custom properties, no new fonts, no changes to `docs/PALETTE.md` or `scripts/validate_palette.js`.
- Reads use the RLS-bound `createClient()`, never `createServiceClient()`.
- `npx vitest run <file>` for one test file; `npm run test:unit` for the suite; `npx tsc --noEmit`; `npm run build`; `npm run lint`.

---

## Phase 0: Shared `RegisterRow` primitive (executable now)

### Task A: `components/ui/RegisterRow.tsx`

**Files:**
- Create: `components/ui/RegisterRow.tsx`
- Test: `tests/unit/register-row-render.test.ts`

**Interfaces:**
- Consumes: `MerchantAvatar` (`components/ui/Avatar.tsx`), `formatCurrency` (`lib/format.ts`), `formatDate` (`lib/format-date.ts`) — all existing, all already used by `RecentActivity.tsx`.
- Produces: `RegisterRow({ index, merchant, meta?, date, amount, currency?, trailing? }): JSX.Element`, an `<li>` meant to live inside a `<ul>`. `amount` is **already in display sign convention**: positive is an inflow (`+`, `var(--viz-pos)`), negative is an outflow (`-`, `var(--viz-neg)`) — the caller converts from whatever raw sign convention its data source uses (e.g. Plaid: `delta = -transaction.amount`) before passing it in. Task B and every later phase's list migration consumes this component and this contract.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/register-row-render.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import RegisterRow from "@/components/ui/RegisterRow";

const baseProps = {
  index: 0,
  merchant: "Corner Grocer",
  date: "2026-08-23",
  amount: -64.18,
  currency: "USD",
};

function renderRow(props: Partial<typeof baseProps> & Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    createElement("ul", null, createElement(RegisterRow, { ...baseProps, ...props })),
  );
}

describe("RegisterRow", () => {
  it("shows the merchant and formatted amount", () => {
    const html = renderRow();
    expect(html).toContain("Corner Grocer");
    expect(html).toContain("$64.18");
  });

  it("renders an outflow with a minus sign and the negative diverging token", () => {
    const html = renderRow();
    expect(html).toContain("-$64.18");
    expect(html).toContain("var(--viz-neg)");
  });

  it("renders an inflow with a plus sign and the positive diverging token", () => {
    const html = renderRow({ amount: 2450 });
    expect(html).toContain("+$2,450.00");
    expect(html).toContain("var(--viz-pos)");
  });

  it("zebra-stripes odd-indexed rows and not even-indexed rows", () => {
    expect(renderRow({ index: 1 })).toContain("bg-panel-2");
    expect(renderRow({ index: 0 })).not.toContain("bg-panel-2");
  });

  it("sets the date in the mono face", () => {
    const html = renderRow();
    expect(html).toContain('class="block text-xs text-muted font-mono"');
  });

  it("carries the amount inside the privacy-blur hook", () => {
    const html = renderRow();
    expect(html).toContain("data-money");
  });

  it("renders optional meta and trailing content", () => {
    const html = renderRow({
      meta: createElement("span", null, "Food & Drink"),
      trailing: createElement("span", null, "chevron"),
    });
    expect(html).toContain("Food &amp; Drink");
    expect(html).toContain("chevron");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/register-row-render.test.ts`
Expected: FAIL — `Cannot find module '@/components/ui/RegisterRow'`.

- [ ] **Step 3: Write the implementation**

Create `components/ui/RegisterRow.tsx`:

```tsx
import { MerchantAvatar } from "@/components/ui/Avatar";
import { formatCurrency } from "@/lib/format";
import { formatDate } from "@/lib/format-date";
import type { ReactNode } from "react";

/**
 * One row in a chronological money list — the shared shape behind Recent
 * Transactions and (as later phases adopt it) the transactions page's
 * ledger, report transactions, recurring items, and holdings.
 *
 * `amount` is already in display sign convention: positive is an inflow
 * (rendered with a leading "+", var(--viz-pos)); negative is an outflow
 * (var(--viz-neg)). Callers own converting from whatever raw sign
 * convention their data source uses (Plaid: positive = out) before
 * passing it in.
 */
export default function RegisterRow({
  index,
  merchant,
  meta,
  date,
  amount,
  currency = "USD",
  trailing,
}: Readonly<{
  index: number;
  merchant: string;
  meta?: ReactNode;
  date: string;
  amount: number;
  currency?: string;
  trailing?: ReactNode;
}>) {
  const inflow = amount > 0;
  return (
    <li
      className={`flex items-center gap-3 rounded-field p-2 hover:bg-panel-hover${
        index % 2 === 1 ? " bg-panel-2" : ""
      }`}
    >
      <MerchantAvatar name={merchant} size={36} className="shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{merchant}</span>
        {meta && (
          <span className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted">{meta}</span>
        )}
      </span>
      <span className="text-right">
        <span
          data-money
          className="block text-sm font-bold"
          style={{ color: inflow ? "var(--viz-pos)" : "var(--viz-neg)" }}
        >
          {inflow ? "+" : "-"}
          {formatCurrency(Math.abs(amount), currency)}
        </span>
        <span className="block text-xs text-muted font-mono">{formatDate(date)}</span>
      </span>
      {trailing}
    </li>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/register-row-render.test.ts`
Expected: PASS, all 7 tests.

- [ ] **Step 5: Commit**

```bash
git add components/ui/RegisterRow.tsx tests/unit/register-row-render.test.ts
git commit -m "feat: add shared RegisterRow list-row primitive"
```

---

### Task B: Migrate `RecentActivity` to `RegisterRow`

**Files:**
- Modify: `components/dashboard/RecentActivity.tsx`
- Modify (or create): `tests/unit/recent-activity-render.test.ts`

**Interfaces:**
- Consumes: `RegisterRow` from Task A.
- Note: this task **supersedes** the dashboard phase's own "restyle `RecentActivity` as a register" step. If `RecentActivity.tsx` already carries inline zebra/mono-date logic, redo it per this task's Step 3 instead of layering on top — that inline logic gets replaced by composing `RegisterRow`, and the inflow color changes from `text-success` to `var(--viz-pos)` per the spec's color-system decision.

- [ ] **Step 1: Write the failing tests**

Create (or replace) `tests/unit/recent-activity-render.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import RecentActivity, {
  type RecentTransaction,
} from "@/components/dashboard/RecentActivity";

function transaction(partial: Partial<RecentTransaction> = {}): RecentTransaction {
  return {
    id: "1",
    date: "2026-08-23",
    amount: 64.18,
    iso_currency_code: "USD",
    merchant_name: "Corner Grocer",
    name: null,
    pfc_primary: "FOOD_AND_DRINK",
    account_id: "acct-1",
    ...partial,
  };
}

describe("RecentActivity", () => {
  it("renders a message when there are no transactions", () => {
    const html = renderToStaticMarkup(
      createElement(RecentActivity, { transactions: [], accountNames: new Map() }),
    );
    expect(html).toContain("No recent activity yet.");
  });

  it("zebra-stripes every other row via RegisterRow", () => {
    const html = renderToStaticMarkup(
      createElement(RecentActivity, {
        transactions: [
          transaction({ id: "1" }),
          transaction({ id: "2" }),
          transaction({ id: "3" }),
        ],
        accountNames: new Map(),
      }),
    );
    const rows = html.split("<li").slice(1);
    expect(rows).toHaveLength(3);
    expect(rows[0]).not.toContain("bg-panel-2");
    expect(rows[1]).toContain("bg-panel-2");
    expect(rows[2]).not.toContain("bg-panel-2");
  });

  it("converts the Plaid-signed amount to RegisterRow's display sign convention", () => {
    // amount: 64.18 (Plaid: money out) must render as an outflow, "-$64.18".
    const html = renderToStaticMarkup(
      createElement(RecentActivity, {
        transactions: [transaction({ amount: 64.18 })],
        accountNames: new Map(),
      }),
    );
    expect(html).toContain("-$64.18");
    expect(html).toContain("var(--viz-neg)");
  });

  it("renders a Plaid negative amount (money in) as an inflow", () => {
    const html = renderToStaticMarkup(
      createElement(RecentActivity, {
        transactions: [transaction({ amount: -2450, merchant_name: "Acme Payroll" })],
        accountNames: new Map(),
      }),
    );
    expect(html).toContain("+$2,450.00");
    expect(html).toContain("var(--viz-pos)");
  });

  it("includes the category and account name in the meta line", () => {
    const html = renderToStaticMarkup(
      createElement(RecentActivity, {
        transactions: [transaction({ account_id: "acct-1" })],
        accountNames: new Map([["acct-1", "Demo Checking **0001"]]),
      }),
    );
    expect(html).toContain("Food And Drink");
    expect(html).toContain("Demo Checking");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/recent-activity-render.test.ts`
Expected: FAIL — current `RecentActivity` still renders its own inline row markup (`text-success`, no `var(--viz-pos)`/`var(--viz-neg)`), not `RegisterRow`'s.

- [ ] **Step 3: Write the implementation**

Replace `components/dashboard/RecentActivity.tsx` in full:

```tsx
import CategoryChip from "@/components/ui/CategoryChip";
import RegisterRow from "@/components/ui/RegisterRow";
import { ChevronRight } from "@/components/ui/icons";
import { titleCase } from "@/lib/format";

export type RecentTransaction = {
  id: string;
  date: string;
  amount: number;
  iso_currency_code: string | null;
  merchant_name: string | null;
  name: string | null;
  pfc_primary: string | null;
  account_id: string;
};

export default function RecentActivity({
  transactions,
  accountNames,
}: Readonly<{
  transactions: RecentTransaction[];
  accountNames: Map<string, string>;
}>) {
  if (transactions.length === 0) {
    return <p className="py-4 text-sm text-muted">No recent activity yet.</p>;
  }

  return (
    <ul className="space-y-3">
      {transactions.map((transaction, index) => (
        <RegisterRow
          key={transaction.id}
          index={index}
          merchant={transaction.merchant_name ?? transaction.name ?? "Unknown"}
          date={transaction.date}
          amount={-transaction.amount}
          currency={transaction.iso_currency_code ?? "USD"}
          meta={
            <>
              {transaction.pfc_primary ? (
                <CategoryChip label={titleCase(transaction.pfc_primary)} />
              ) : (
                <span>Uncategorized</span>
              )}
              <span className="truncate">
                · {accountNames.get(transaction.account_id) ?? "Account"}
              </span>
            </>
          }
          trailing={<ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-muted" />}
        />
      ))}
    </ul>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/recent-activity-render.test.ts`
Expected: PASS, all 5 tests.

Also run: `npm run test:unit` — confirm no other test (e.g. anything in `tests/unit/dashboard-widgets-render.test.ts` that renders `TransactionsWidget`/`RecentActivity` indirectly) broke on the color/markup change.

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/RecentActivity.tsx tests/unit/recent-activity-render.test.ts
git commit -m "refactor: migrate RecentActivity onto the shared RegisterRow primitive"
```

---

## How to use the later phases

Everything below is a **scope description**, not an executable plan. Each phase needs its own research pass (like the two Explore agent rounds behind the dashboard plan) before it can be written in the same task-by-task, exact-code, no-placeholder detail — the survey behind this roadmap deliberately stopped at "what does this page show and does it fit the motif," not "here is the exact diff." Writing fabricated code for pages that haven't been read in full would violate the same "No Placeholders" rule the dashboard plan follows.

**Before starting a phase:** dispatch the same research process used for the dashboard (Explore agent(s) reading the page's actual current components in full), then write a dated plan file (`docs/superpowers/plans/YYYY-MM-DD-<page>-register.md`) with the dashboard plan's exact structure — Files/Interfaces/Steps per task, TDD, one commit per task, a final lint/typecheck/test/build/manual-QA task.

### Phase 1 — Transactions (`app/transactions/page.tsx`)

Highest-leverage phase after Phase 0. Scope: migrate `LedgerTableRow`'s day-group rows to compose `RegisterRow` (or extend `RegisterRow` if the day-grouped-header structure doesn't fit the flat-list shape — verify by reading `LedgerTableRow`'s actual render logic first, don't assume it drops in unchanged), set dates to `font-mono`, and reconcile the "positive amounts are money out" caption/coloring with `--viz-pos`/`--viz-neg`. `MobileLedgerList` needs the same treatment for narrow viewports. Also touches `SavedViewsBar`/`TableToolbar` only if their eyebrow-style labels should pick up `font-mono` for consistency — confirm during research rather than assuming.

### Phase 2 — Reports (`app/reports/page.tsx`)

Migrate `ReportTransactions` to `RegisterRow`. `BreakdownBars` already uses `--viz-pos`/`--viz-neg` — verify its row/label styling (not just the bars) for mono-date/label consistency. `SankeyChart` is explicitly out of scope (dashboard spec's non-goals already exclude touching Sankey/reports charts).

### Phase 3 — Investments (`app/investments/page.tsx`)

Migrate `HoldingsTable` to `RegisterRow` or a close variant (holdings aren't dated transactions, so the "date" slot may need to become "as-of" framing — confirm during research). Recolor day-change from `text-success`/`text-danger` to `--viz-pos`/`--viz-neg`.

### Phase 4 — Recurring (`app/recurring/page.tsx`)

Migrate `RecurringList`'s occurrence rows to `RegisterRow`. `MonthSummary` totals get the mono-label/proportional-money-sans split if they don't already have it (unconfirmed, read `MonthSummary` first).

### Phase 5 — Cash Flow (`app/cash-flow/page.tsx`)

Lighter phase: `BreakdownBars` already on-token; confirm its axis/legend labels are `font-mono` for consistency with the rest of the app. No row-list migration — there isn't one at the page-shell level.

### Phase 6 — Accounts (`app/accounts/page.tsx`)

The convention-fix phase: remap `font-mono` off money figures and onto labels/dates in `AccountRow.tsx`, `SummaryPanel.tsx`, `NetWorthHero.tsx`, and `AccountGroup.tsx`. This is a **visual regression risk** — confirm with the user/via screenshot diff before and after, since it changes the look of an already-shipped page rather than adding something new. `NetWorthHero`'s history table is an optional secondary zebra candidate.

### Phase 7 — Review and Wrapped (`app/review/page.tsx`, `app/wrapped/page.tsx`)

Light zebra/mono treatment on Review's three list blocks. Wrapped is the one page in this phase with a real signature opportunity (its "annual statement" framing) — read `StatTile`, `MiniBars`, `BarList`, and the highlight-card grid in full before proposing anything beyond "mono dates/year chips," since this is the closest thing to a second design decision (not just a mechanical restyle) in the whole rollout.

### Phase 8 — Budget, Debt, Transactions/Receipts (TBD verdicts)

`BudgetPlanner`, `DebtPlannerView`, and `ReceiptInbox` were not read in this survey. Phase 8's research step decides whether each gets Full/Partial/Minimal treatment before any code is written — do not assume Full going in.

### Phase 9 — Notifications and Settings (minimal touch)

Notifications: light zebra/mono on the delivery-history list only. Settings: `font-mono`/`Money` convention check on the few sections with money fields (`BudgetsSection`, `SinkingFundsSection`, `SettleUpSection`, `CardAprSection`) — read each before changing anything, since Settings is a large (~456-line) page and this phase should touch only the money-bearing subsections, nothing else.

### Not in scope

Root (`/`), Login, Signup, Advice, and Admin get no phase — see the spec's page-by-page verdict table for why each has no financial content to extend the motif to. If a phase for one of these is ever wanted, it starts with the same research-then-plan process, not with this roadmap's existing notes (there aren't any to build on).
