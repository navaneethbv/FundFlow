# Ledger Strip Dashboard Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Ledger Strip" hero to the FundFlow dashboard Overview screen — a horizontal, chronological register of the current month's posted transactions on the user's primary checking account, ending in a running balance — and extend its statement-register visual language (mono labels, `--viz-pos`/`--viz-neg` for inflow/outflow) to the existing Recent Transactions list.

**Architecture:** A new pure module (`lib/ledger-strip.ts`) reconstructs a running balance by walking a single account's month-to-date transactions backward from `AccountSummary.current_balance`, converting Plaid's sign convention (positive = out, negative = in) to a signed ledger delta. A thin I/O wrapper in the same file queries Supabase (RLS-scoped `createClient()`); `loadOverviewWidgetData` in `lib/dashboard-widgets-data.ts` calls it alongside its existing queries. A new server component (`components/dashboard/LedgerStrip.tsx`) renders the ticks; `OverviewView.tsx` renders it above the existing `DashboardWidgetGrid`, entirely outside the `WIDGET_KEYS` registry (always-on, non-reorderable). `RecentActivity.tsx` gets a minimal restyle (zebra rows, mono dates). `BudgetWidget.tsx` gets a one-attribute privacy-blur bugfix found during research.

**Tech Stack:** Next.js 16 App Router, TypeScript, Tailwind 4, Supabase (`@supabase/supabase-js`), Vitest.

**Spec:** `docs/superpowers/specs/2026-08-24-dashboard-ledger-strip-design.md` — read this first. It documents every place this plan deliberately deviates from the approved concept mockup (the "Spending vs last month" widget keeps its real chart, no `PageHeader` kicker, single-account scope, the major/minor tick threshold, no load animation, and the `BudgetWidget` fix) and why.

## Global Constraints

- Amount sign follows Plaid: positive = money out, negative = money in (`CLAUDE.md`). Every place this plan converts a transaction amount to a ledger delta uses `delta = -transaction.amount`.
- Dates are `YYYY-MM-DD` strings end to end.
- Every money figure must carry `.money` (via `<Money>`), `.metric-value`, or sit inside a `data-money` container, or it silently escapes the privacy-blur toggle (`app/globals.css:347-362`).
- Money is never set in the mono face on the dashboard. `font-mono` (→ `--font-mono` → Geist Mono, already loaded in `app/layout.tsx`) is reserved for labels, dates, and eyebrows only.
- No new CSS custom properties, no new fonts, no changes to `docs/PALETTE.md`, `scripts/validate_palette.js`, or any shared `components/ui/` primitive (`Panel`, `Button`, `Badge`, `Money`).
- The Ledger Strip is not a member of `WIDGET_KEYS` / `WIDGET_DEFINITIONS` (`lib/dashboard-widgets.ts`) and must not be gated by `visibleWidgets()` or persisted to `profiles.dashboard_prefs`.
- Reads use the RLS-bound `createClient()` (already threaded through `OverviewView` → `loadOverviewWidgetData`), never `createServiceClient()`.
- Run `npx vitest run <file>` for a single test file; `npm run test:unit` for the full unit suite; `npx tsc --noEmit` for typecheck; `npm run build` for the full production/type/route check; `npm run lint` for eslint.

---

### Task 1: `lib/ledger-strip.ts` — pure ledger math

**Files:**
- Create: `lib/ledger-strip.ts`
- Test: `tests/unit/ledger-strip.test.ts`

**Interfaces:**
- Produces: `LedgerStripAccount { id: string; name: string | null; mask: string | null; current_balance: number | null; iso_currency_code: string | null; type: string | null }`, `LedgerStripTransaction { id: string; date: string; amount: number; merchant_name: string | null; name: string | null }`, `LedgerTick { id: string; date: string; label: string; amount: number; runningBalance: number; major: boolean }`, `pickAnchorAccount(accounts: readonly LedgerStripAccount[]): LedgerStripAccount | null`, `buildLedgerStripTicks(transactions: readonly LedgerStripTransaction[], currentBalance: number, options?: { majorThreshold?: number }): LedgerTick[]`. Task 2 imports all of these.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/ledger-strip.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  pickAnchorAccount,
  buildLedgerStripTicks,
  type LedgerStripAccount,
  type LedgerStripTransaction,
} from "@/lib/ledger-strip";

function account(partial: Partial<LedgerStripAccount> = {}): LedgerStripAccount {
  return {
    id: "acct-1",
    name: "Demo Checking",
    mask: "0001",
    current_balance: 4820.55,
    iso_currency_code: "USD",
    type: "depository",
    ...partial,
  };
}

function transaction(partial: Partial<LedgerStripTransaction> = {}): LedgerStripTransaction {
  return {
    id: "txn-1",
    date: "2026-08-01",
    amount: 10,
    merchant_name: "Corner Grocer",
    name: null,
    ...partial,
  };
}

describe("pickAnchorAccount", () => {
  it("returns the first depository account with a balance", () => {
    const accounts = [
      account({ id: "credit-1", type: "credit", current_balance: -500 }),
      account({ id: "checking-1", type: "depository", current_balance: 1000 }),
    ];
    expect(pickAnchorAccount(accounts)?.id).toBe("checking-1");
  });

  it("returns null when no depository account exists", () => {
    const accounts = [account({ type: "credit" }), account({ type: "loan" })];
    expect(pickAnchorAccount(accounts)).toBeNull();
  });

  it("skips a depository account with no balance on record", () => {
    const accounts = [
      account({ id: "checking-1", type: "depository", current_balance: null }),
      account({ id: "checking-2", type: "depository", current_balance: 250 }),
    ];
    expect(pickAnchorAccount(accounts)?.id).toBe("checking-2");
  });
});

describe("buildLedgerStripTicks", () => {
  it("returns an empty array for no transactions", () => {
    expect(buildLedgerStripTicks([], 100)).toEqual([]);
  });

  it("ends on the current balance", () => {
    const ticks = buildLedgerStripTicks(
      [
        transaction({ id: "1", date: "2026-08-01", amount: 1650 }),
        transaction({ id: "2", date: "2026-08-16", amount: -2450 }),
      ],
      4820.55,
    );
    expect(ticks[ticks.length - 1]!.runningBalance).toBe(4820.55);
  });

  it("sorts by date then id, oldest first", () => {
    const ticks = buildLedgerStripTicks(
      [
        transaction({ id: "b", date: "2026-08-16", amount: -2450 }),
        transaction({ id: "a", date: "2026-08-01", amount: 1650 }),
      ],
      100,
    );
    expect(ticks.map((tick) => tick.id)).toEqual(["a", "b"]);
  });

  it("converts a positive Plaid amount (money out) to a negative ledger delta", () => {
    const ticks = buildLedgerStripTicks([transaction({ amount: 64.18 })], 100);
    expect(ticks[0]!.amount).toBe(-64.18);
  });

  it("converts a negative Plaid amount (money in) to a positive ledger delta", () => {
    const ticks = buildLedgerStripTicks([transaction({ amount: -2450 })], 100);
    expect(ticks[0]!.amount).toBe(2450);
  });

  it("marks any inflow as major regardless of size", () => {
    const ticks = buildLedgerStripTicks([transaction({ amount: -5 })], 100);
    expect(ticks[0]!.major).toBe(true);
  });

  it("marks an outflow at or above the threshold as major", () => {
    const ticks = buildLedgerStripTicks([transaction({ amount: 100 })], 100);
    expect(ticks[0]!.major).toBe(true);
  });

  it("marks a small outflow below the threshold as minor", () => {
    const ticks = buildLedgerStripTicks([transaction({ amount: 6.75 })], 100);
    expect(ticks[0]!.major).toBe(false);
  });

  it("falls back to the transaction name when merchant_name is null", () => {
    const ticks = buildLedgerStripTicks(
      [transaction({ merchant_name: null, name: "ACME PAYROLL DEP" })],
      100,
    );
    expect(ticks[0]!.label).toBe("ACME PAYROLL DEP");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/ledger-strip.test.ts`
Expected: FAIL — `Cannot find module '@/lib/ledger-strip'` (the file does not exist yet).

- [ ] **Step 3: Write the implementation**

Create `lib/ledger-strip.ts`:

```ts
export interface LedgerStripAccount {
  id: string;
  name: string | null;
  mask: string | null;
  current_balance: number | null;
  iso_currency_code: string | null;
  type: string | null;
}

export interface LedgerStripTransaction {
  id: string;
  date: string;
  amount: number;
  merchant_name: string | null;
  name: string | null;
}

export interface LedgerTick {
  id: string;
  date: string;
  label: string;
  amount: number;
  runningBalance: number;
  major: boolean;
}

/**
 * A tick earns a permanent label if it's an inflow, or an outflow of at
 * least this much. Deliberately separate from
 * `SpendingAnomalyInput.largeTransactionThreshold` in lib/planning.ts —
 * "worth a permanent label on a register" and "anomalous spending" are
 * different questions with no reason to share a threshold.
 */
const MAJOR_TICK_THRESHOLD = 100;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function pickAnchorAccount(
  accounts: readonly LedgerStripAccount[],
): LedgerStripAccount | null {
  return (
    accounts.find(
      (account) => account.type === "depository" && account.current_balance !== null,
    ) ?? null
  );
}

/**
 * Walks a single account's transactions in chronological order, converting
 * each from Plaid's sign convention (positive = out, negative = in) to a
 * signed ledger delta, and reconstructs the running balance that ends at
 * `currentBalance` — the same figure `AccountSummary.current_balance`
 * reports.
 */
export function buildLedgerStripTicks(
  transactions: readonly LedgerStripTransaction[],
  currentBalance: number,
  options: Readonly<{ majorThreshold?: number }> = {},
): LedgerTick[] {
  if (transactions.length === 0) {
    return [];
  }

  const majorThreshold = options.majorThreshold ?? MAJOR_TICK_THRESHOLD;
  const sorted = [...transactions].sort(
    (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
  );
  const netDelta = sorted.reduce((sum, transaction) => sum - transaction.amount, 0);
  let balance = round2(currentBalance - netDelta);

  return sorted.map((transaction) => {
    const delta = -transaction.amount;
    balance = round2(balance + delta);
    return {
      id: transaction.id,
      date: transaction.date,
      label: transaction.merchant_name ?? transaction.name ?? "Transaction",
      amount: delta,
      runningBalance: balance,
      major: delta > 0 || Math.abs(delta) >= majorThreshold,
    };
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/ledger-strip.test.ts`
Expected: PASS, all 12 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/ledger-strip.ts tests/unit/ledger-strip.test.ts
git commit -m "feat: add pure ledger-strip running-balance math"
```

---

### Task 2: `loadLedgerStripTicks` I/O wrapper, wired into `loadOverviewWidgetData`

**Files:**
- Modify: `lib/ledger-strip.ts` (append)
- Modify: `lib/dashboard-widgets-data.ts`

**Interfaces:**
- Consumes: `pickAnchorAccount`, `buildLedgerStripTicks`, `LedgerStripAccount`, `LedgerTick`, `LedgerStripTransaction` from Task 1.
- Produces: `loadLedgerStripTicks(supabase: SupabaseClient, options: { accountId: string; month: string; today: string; currentBalance: number }): Promise<LedgerTick[]>` and `OverviewLedgerStrip { ticks: LedgerTick[]; account: LedgerStripAccount | null; currency: string }`, and `loadOverviewWidgetData`'s new `accounts` option and `ledgerStrip` return field, both consumed by Task 4.

No direct test for `loadLedgerStripTicks` or the `loadOverviewWidgetData` change — matching this codebase's existing pattern, where the pure computation (`buildLedgerStripTicks`, `computeCumulativeSpendByDay`) is unit-tested directly but the thin Supabase-query wrappers around it (`loadCumulativeSpend`, `loadDashboardInvestmentSummary`) are not. Correctness here is covered by Task 1's tests plus the typecheck/build/manual-check steps below.

- [ ] **Step 1: Add the I/O wrapper to `lib/ledger-strip.ts`**

Append to `lib/ledger-strip.ts` (add the import at the top of the file, alongside the existing content from Task 1):

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
```

```ts
export async function loadLedgerStripTicks(
  supabase: SupabaseClient,
  options: Readonly<{
    accountId: string;
    month: string;
    today: string;
    currentBalance: number;
  }>,
): Promise<LedgerTick[]> {
  const { data, error } = await supabase
    .from("transactions")
    .select("id, date, amount, merchant_name, name")
    .eq("account_id", options.accountId)
    .gte("date", `${options.month}-01`)
    .lte("date", options.today)
    .order("date", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    throw error;
  }

  return buildLedgerStripTicks(
    (data ?? []) as LedgerStripTransaction[],
    options.currentBalance,
  );
}
```

- [ ] **Step 2: Wire it into `lib/dashboard-widgets-data.ts`**

In `lib/dashboard-widgets-data.ts`, change the import block (currently lines 1–14):

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeCumulativeSpendByDay,
  shiftMonthKey,
  type CumulativeSpendDay,
} from "@/lib/dashboard";
import { loadCanonicalProjection } from "@/lib/finance-query";
import { formatMonth } from "@/lib/format";
import { buildInvestmentsPage } from "@/lib/investments";
import {
  loadHoldings,
  loadHoldingSnapshots,
} from "@/lib/investments-data";
import type { WidgetKey } from "@/lib/dashboard-widgets";
```

to:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeCumulativeSpendByDay,
  shiftMonthKey,
  type CumulativeSpendDay,
} from "@/lib/dashboard";
import { loadCanonicalProjection } from "@/lib/finance-query";
import { formatMonth } from "@/lib/format";
import { buildInvestmentsPage } from "@/lib/investments";
import {
  loadHoldings,
  loadHoldingSnapshots,
} from "@/lib/investments-data";
import type { WidgetKey } from "@/lib/dashboard-widgets";
import {
  loadLedgerStripTicks,
  pickAnchorAccount,
  type LedgerStripAccount,
  type LedgerTick,
} from "@/lib/ledger-strip";
```

Then replace the `loadOverviewWidgetData` function (currently lines 140–162):

```ts
export async function loadOverviewWidgetData(
  supabase: SupabaseClient,
  options: Readonly<{
    month: string;
    today: string;
    userId: string;
    household: boolean;
    visible: readonly WidgetKey[];
  }>,
): Promise<{
  cumulativeSpend: CumulativeSpendView;
  investments: DashboardInvestmentSummary | null;
}> {
  const [cumulativeSpend, investments] = await Promise.all([
    options.visible.includes("spendingCompare")
      ? loadCumulativeSpend(supabase, options)
      : Promise.resolve(EMPTY_CUMULATIVE_SPEND),
    options.visible.includes("investments")
      ? loadDashboardInvestmentSummary(supabase)
      : Promise.resolve(null),
  ]);
  return { cumulativeSpend, investments };
}
```

with:

```ts
export interface OverviewLedgerStrip {
  ticks: LedgerTick[];
  account: LedgerStripAccount | null;
  currency: string;
}

export async function loadOverviewWidgetData(
  supabase: SupabaseClient,
  options: Readonly<{
    month: string;
    today: string;
    userId: string;
    household: boolean;
    visible: readonly WidgetKey[];
    accounts: readonly LedgerStripAccount[];
  }>,
): Promise<{
  cumulativeSpend: CumulativeSpendView;
  investments: DashboardInvestmentSummary | null;
  ledgerStrip: OverviewLedgerStrip;
}> {
  const anchorAccount = pickAnchorAccount(options.accounts);
  const [cumulativeSpend, investments, ledgerTicks] = await Promise.all([
    options.visible.includes("spendingCompare")
      ? loadCumulativeSpend(supabase, options)
      : Promise.resolve(EMPTY_CUMULATIVE_SPEND),
    options.visible.includes("investments")
      ? loadDashboardInvestmentSummary(supabase)
      : Promise.resolve(null),
    anchorAccount
      ? loadLedgerStripTicks(supabase, {
          accountId: anchorAccount.id,
          month: options.month,
          today: options.today,
          currentBalance: anchorAccount.current_balance ?? 0,
        })
      : Promise.resolve([]),
  ]);
  return {
    cumulativeSpend,
    investments,
    ledgerStrip: {
      ticks: ledgerTicks,
      account: anchorAccount,
      currency: anchorAccount?.iso_currency_code ?? "USD",
    },
  };
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: FAILS at this point — `components/dashboard/OverviewView.tsx` still calls `loadOverviewWidgetData` without the new `accounts` field. This is expected; Task 4 fixes the call site. Confirm the error is exactly that (a missing-property error on the `loadOverviewWidgetData` call in `OverviewView.tsx`), not something else in this file.

- [ ] **Step 4: Commit**

```bash
git add lib/ledger-strip.ts lib/dashboard-widgets-data.ts
git commit -m "feat: load ledger-strip ticks alongside the overview widget data"
```

---

### Task 3: `components/dashboard/LedgerStrip.tsx`

**Files:**
- Create: `components/dashboard/LedgerStrip.tsx`
- Test: `tests/unit/ledger-strip-render.test.ts`

**Interfaces:**
- Consumes: `LedgerTick` from `lib/ledger-strip.ts` (Task 1); `Panel` (`components/ui/Panel.tsx`), `Money` (`components/ui/Money.tsx`), `formatCurrency` (`lib/format.ts`), `formatDate` (`lib/format-date.ts`) — all existing.
- Produces: `LedgerStrip({ ticks, accountName, accountMask, monthLabel, currency }): JSX.Element | null`, consumed by Task 4.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/ledger-strip-render.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import LedgerStrip from "@/components/dashboard/LedgerStrip";
import type { LedgerTick } from "@/lib/ledger-strip";

function tick(partial: Partial<LedgerTick> = {}): LedgerTick {
  return {
    id: "1",
    date: "2026-08-01",
    label: "Maple St. Apartments",
    amount: -1650,
    runningBalance: 3170.55,
    major: true,
    ...partial,
  };
}

const baseProps = {
  ticks: [tick()],
  accountName: "Demo Checking",
  accountMask: "0001",
  monthLabel: "August 2026",
  currency: "USD",
};

describe("LedgerStrip", () => {
  it("renders nothing when there are no ticks", () => {
    const html = renderToStaticMarkup(createElement(LedgerStrip, { ...baseProps, ticks: [] }));
    expect(html).toBe("");
  });

  it("shows the account name, mask, and month label", () => {
    const html = renderToStaticMarkup(createElement(LedgerStrip, baseProps));
    expect(html).toContain("Demo Checking");
    expect(html).toContain("0001");
    expect(html).toContain("August 2026");
  });

  it("shows the entry count", () => {
    const html = renderToStaticMarkup(
      createElement(LedgerStrip, {
        ...baseProps,
        ticks: [tick({ id: "1" }), tick({ id: "2" })],
      }),
    );
    expect(html).toContain("2 entries logged");
  });

  it("carries the running balance on the closing figure via the money hook", () => {
    const html = renderToStaticMarkup(createElement(LedgerStrip, baseProps));
    expect(html).toContain("money");
    expect(html).toContain("$3,170.55");
  });

  it("keeps a major tick's label always visible", () => {
    const html = renderToStaticMarkup(
      createElement(LedgerStrip, { ...baseProps, ticks: [tick({ major: true })] }),
    );
    expect(html).not.toContain("opacity-0");
  });

  it("reveals a minor tick's label only on hover/focus", () => {
    const html = renderToStaticMarkup(
      createElement(LedgerStrip, {
        ...baseProps,
        ticks: [tick({ major: false, amount: -6.75 })],
      }),
    );
    expect(html).toContain("opacity-0");
    expect(html).toContain("group-hover:opacity-100");
  });

  it("colors an inflow tick with the positive diverging token", () => {
    const html = renderToStaticMarkup(
      createElement(LedgerStrip, {
        ...baseProps,
        ticks: [tick({ amount: 2450, major: true })],
      }),
    );
    expect(html).toContain("var(--viz-pos)");
  });

  it("colors an outflow tick with the negative diverging token", () => {
    const html = renderToStaticMarkup(createElement(LedgerStrip, baseProps));
    expect(html).toContain("var(--viz-neg)");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/ledger-strip-render.test.ts`
Expected: FAIL — `Cannot find module '@/components/dashboard/LedgerStrip'`.

- [ ] **Step 3: Write the implementation**

Create `components/dashboard/LedgerStrip.tsx`:

```tsx
import Panel from "@/components/ui/Panel";
import Money from "@/components/ui/Money";
import { formatCurrency } from "@/lib/format";
import { formatDate } from "@/lib/format-date";
import type { LedgerTick } from "@/lib/ledger-strip";

export default function LedgerStrip({
  ticks,
  accountName,
  accountMask,
  monthLabel,
  currency,
}: Readonly<{
  ticks: LedgerTick[];
  accountName: string;
  accountMask: string | null;
  monthLabel: string;
  currency: string;
}>) {
  if (ticks.length === 0) {
    return null;
  }

  const maxAbsAmount = Math.max(...ticks.map((tick) => Math.abs(tick.amount)), 1);
  const lastTick = ticks[ticks.length - 1]!;
  const accountLabel = accountMask ? `${accountName} •${accountMask}` : accountName;

  return (
    <Panel
      eyebrow="Running balance"
      title="Month to date, in order"
      action={<span className="eyebrow">{ticks.length} entries logged</span>}
      padding="lg"
    >
      <p className="eyebrow font-mono mb-4">
        {monthLabel} &middot; {accountLabel}
      </p>
      <div className="overflow-x-auto">
        <div className="relative h-32 min-w-[44rem] pr-32" data-money>
          <div className="absolute inset-x-0 top-14 h-px bg-panel-border" aria-hidden="true" />
          {ticks.map((tick, index) => {
            const inflow = tick.amount > 0;
            const left = ticks.length > 1 ? (index / (ticks.length - 1)) * 88 : 0;
            const stemHeight =
              8 +
              Math.round((Math.sqrt(Math.abs(tick.amount)) / Math.sqrt(maxAbsAmount)) * 40);
            const signedAmount = `${inflow ? "+" : "-"}${formatCurrency(
              Math.abs(tick.amount),
              currency,
            )}`;
            const detail = `${formatDate(tick.date)}: ${signedAmount}, ${tick.label}`;
            return (
              <button
                key={tick.id}
                type="button"
                className={`group absolute top-14 flex -translate-x-1/2 flex-col items-center border-0 bg-transparent p-0 ${
                  inflow ? "flex-col-reverse" : ""
                }`}
                style={{ left: `${left}%` }}
                aria-label={detail}
              >
                <span
                  className="w-0.5 rounded-full"
                  style={{
                    height: `${stemHeight}px`,
                    background: inflow ? "var(--viz-pos)" : "var(--viz-neg)",
                  }}
                />
                <span
                  className="h-2 w-2 rounded-full ring-2 ring-panel"
                  style={{ background: inflow ? "var(--viz-pos)" : "var(--viz-neg)" }}
                />
                <span
                  className={`pointer-events-none absolute left-1/2 w-max -translate-x-1/2 text-center text-[0.68rem] ${
                    inflow ? "bottom-full mb-1" : "top-full mt-1"
                  } ${
                    tick.major
                      ? "opacity-100"
                      : "opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                  }`}
                >
                  <span className="block font-mono text-muted">{formatDate(tick.date)}</span>
                  <span
                    className="block font-semibold"
                    style={{ color: inflow ? "var(--viz-pos)" : "var(--viz-neg)" }}
                  >
                    {signedAmount}
                  </span>
                  <span className="block max-w-[8rem] truncate text-muted">{tick.label}</span>
                </span>
              </button>
            );
          })}
          <div className="absolute inset-y-0 right-0 flex w-28 flex-col justify-center border-l border-dashed border-panel-border pl-4 text-right">
            <span className="eyebrow font-mono">Today</span>
            <Money
              amount={lastTick.runningBalance}
              currency={currency}
              className="metric-value text-xl"
            />
          </div>
        </div>
      </div>
    </Panel>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/ledger-strip-render.test.ts`
Expected: PASS, all 8 tests.

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/LedgerStrip.tsx tests/unit/ledger-strip-render.test.ts
git commit -m "feat: add LedgerStrip dashboard component"
```

---

### Task 4: Wire `LedgerStrip` into `OverviewView` and `page.tsx`

**Files:**
- Modify: `components/dashboard/OverviewView.tsx`
- Modify: `app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `LedgerStrip` (Task 3); `loadOverviewWidgetData`'s new `accounts` param and `ledgerStrip` return field (Task 2); `AccountSummary` from `lib/dashboard.ts` (existing); `formatMonth` from `lib/format.ts` (existing).

- [ ] **Step 1: Update `components/dashboard/OverviewView.tsx`**

Replace the full file:

```tsx
import DashboardWidgetGrid, {
  type DashboardWidgetGridData,
} from "@/components/dashboard/DashboardWidgetGrid";
import LedgerStrip from "@/components/dashboard/LedgerStrip";
import RecentActivity from "@/components/dashboard/RecentActivity";
import {
  normalizeWidgetPrefs,
  visibleWidgets,
} from "@/lib/dashboard-widgets";
import { loadOverviewWidgetData } from "@/lib/dashboard-widgets-data";
import type { AccountSummary } from "@/lib/dashboard";
import { formatMonth } from "@/lib/format";
import type { Goal } from "@/lib/goals";
import { createClient } from "@/lib/supabase/server";
import type { ComponentProps } from "react";

/**
 * The Phase 8 overview: the customizable widget grid, as a sibling of
 * MonitorView / PlanView / WealthView so `app/dashboard/page.tsx` stays the
 * orchestrator its own test insists on.
 *
 * It owns the one query the grid needs beyond what the page already loaded, so
 * the other three views never pay for it.
 */
export default async function OverviewView({
  prefsRaw,
  data,
  goals,
  recent,
  accountNames,
  accounts,
  userId,
  household,
  month,
}: Readonly<{
  prefsRaw: unknown;
  data: Omit<DashboardWidgetGridData, "investments">;
  goals: Goal[];
  recent: ComponentProps<typeof RecentActivity>["transactions"];
  accountNames: Map<string, string>;
  accounts: AccountSummary[];
  userId: string;
  household: boolean;
  month: string;
}>) {
  const today = new Date().toISOString().slice(0, 10);
  const supabase = await createClient();
  const prefs = normalizeWidgetPrefs(prefsRaw);
  const monthLabel = formatMonth(month);
  const loaded = await loadOverviewWidgetData(supabase, {
    month,
    today,
    userId,
    household,
    visible: visibleWidgets(prefs),
    accounts,
  });

  return (
    <>
      {loaded.ledgerStrip.account && (
        <LedgerStrip
          ticks={loaded.ledgerStrip.ticks}
          accountName={loaded.ledgerStrip.account.name ?? "Account"}
          accountMask={loaded.ledgerStrip.account.mask}
          monthLabel={monthLabel}
          currency={loaded.ledgerStrip.currency}
        />
      )}
      <DashboardWidgetGrid
        prefs={prefs}
        data={{ ...data, investments: loaded.investments }}
        goals={goals}
        cumulativeSpend={loaded.cumulativeSpend.days}
        monthLabel={loaded.cumulativeSpend.monthLabel}
        previousMonthLabel={loaded.cumulativeSpend.previousMonthLabel}
        recentTransactions={recent}
        accountNames={accountNames}
        today={today}
      />
    </>
  );
}
```

(`monthLabel` is now computed directly from `formatMonth(month)` rather than read off `loaded.cumulativeSpend.monthLabel`, which is `""` whenever the user has hidden the "Spending vs last month" widget — the Ledger Strip must not depend on another widget's visibility.)

- [ ] **Step 2: Update `app/dashboard/page.tsx`**

In the `<OverviewView>` call (currently lines 205–216), add the `accounts` prop:

```tsx
          {activeView === "overview" && (
            <OverviewView
              prefsRaw={profileRow?.dashboard_prefs}
              data={data}
              goals={goals}
              recent={recentTransactions}
              accountNames={accountNames}
              accounts={data.accounts}
              userId={user?.id ?? ""}
              household={dashboardScope === "household"}
              month={data.selectedMonth}
            />
          )}
```

- [ ] **Step 3: Typecheck and run the full unit suite**

Run: `npx tsc --noEmit`
Expected: PASS — no errors (this resolves the expected failure from Task 2, Step 3).

Run: `npm run test:unit`
Expected: PASS — all existing tests plus the two new suites from Tasks 1 and 3.

- [ ] **Step 4: Commit**

```bash
git add components/dashboard/OverviewView.tsx app/dashboard/page.tsx
git commit -m "feat: render LedgerStrip above the dashboard overview grid"
```

---

### Task 5: Restyle `RecentActivity` as a register (zebra rows, mono dates)

> **Superseded.** `docs/superpowers/plans/2026-08-24-app-wide-register-rollout-roadmap.md`
> Phase 0 Task B replaces this task: it extracts a shared `RegisterRow`
> primitive (also needed by the transactions/reports/recurring/investments
> pages) and migrates `RecentActivity` onto it, which additionally fixes an
> inflow-color inconsistency (`text-success` → `var(--viz-pos)`) this task
> did not know about. If this task hasn't been executed yet, skip it and go
> straight to the roadmap's Phase 0. If it has already been executed, run
> Phase 0 Task B anyway — its Step 3 replaces this task's output rather than
> building on it.

**Files:**
- Modify: `components/dashboard/RecentActivity.tsx`
- Test: `tests/unit/recent-activity-render.test.ts`

**Interfaces:** None new — `RecentActivity`'s props (`transactions`, `accountNames`) and exported `RecentTransaction` type are unchanged; only its internal className logic changes.

- [ ] **Step 1: Check for an existing test file**

Run: `find /Users/navaneethbv/Desktop/Projects/FundFlow/tests -iname "*recent-activity*"`

If a file is found, open it and add the two new `it(...)` blocks from Step 2 below into it (matching whatever describe block/import style it already uses) instead of creating a new file. If nothing is found, proceed to Step 2 as written.

- [ ] **Step 2: Write the failing tests**

Create (or extend) `tests/unit/recent-activity-render.test.ts`:

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

  it("zebra-stripes every other row", () => {
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

  it("sets the date in the mono face", () => {
    const html = renderToStaticMarkup(
      createElement(RecentActivity, {
        transactions: [transaction()],
        accountNames: new Map(),
      }),
    );
    expect(html).toContain('class="block text-xs text-muted font-mono"');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/recent-activity-render.test.ts`
Expected: FAIL — the zebra-stripe and mono-date assertions fail against the current markup (no `bg-panel-2` on any row, no `font-mono` on the date span).

- [ ] **Step 4: Write the implementation**

In `components/dashboard/RecentActivity.tsx`, change:

```tsx
  return (
    <ul className="space-y-3">
      {transactions.map((transaction) => {
        const merchant = transaction.merchant_name ?? transaction.name ?? "Unknown";
        const income = transaction.amount < 0;
        return (
          <li key={transaction.id} className="flex items-center gap-3 rounded-field p-2 hover:bg-panel-hover">
```

to:

```tsx
  return (
    <ul className="space-y-3">
      {transactions.map((transaction, index) => {
        const merchant = transaction.merchant_name ?? transaction.name ?? "Unknown";
        const income = transaction.amount < 0;
        return (
          <li
            key={transaction.id}
            className={`flex items-center gap-3 rounded-field p-2 hover:bg-panel-hover${
              index % 2 === 1 ? " bg-panel-2" : ""
            }`}
          >
```

and change:

```tsx
              <span className="block text-xs text-muted">{formatDate(transaction.date)}</span>
```

to:

```tsx
              <span className="block text-xs text-muted font-mono">{formatDate(transaction.date)}</span>
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/recent-activity-render.test.ts`
Expected: PASS, all 3 tests.

- [ ] **Step 6: Commit**

```bash
git add components/dashboard/RecentActivity.tsx tests/unit/recent-activity-render.test.ts
git commit -m "feat: give recent transactions a register-style zebra/mono treatment"
```

---

### Task 6: Fix `BudgetWidget`'s privacy-blur gap

**Files:**
- Modify: `components/dashboard/widgets/BudgetWidget.tsx`
- Modify: `tests/unit/dashboard-widgets-render.test.ts`

**Interfaces:** None new — uses the existing `budgetGroup()` factory already defined at the top of `tests/unit/dashboard-widgets-render.test.ts` (lines 42–54).

- [ ] **Step 1: Write the failing test**

In `tests/unit/dashboard-widgets-render.test.ts`, add a new test as the first `it(...)` inside the existing `describe("BudgetWidget", () => {` block (starts at line 96), right after the opening line:

```ts
  it("wraps the spent/limit figure in the privacy-blur hook", () => {
    const html = renderToStaticMarkup(
      createElement(BudgetWidget, {
        currency: "USD",
        groups: [
          budgetGroup({
            key: "flexible",
            label: "Dining Out",
            spent: 128,
            monthlyLimit: 100,
            status: "over",
          }),
        ],
      }),
    );
    expect(html).toContain("data-money");
  });

```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/dashboard-widgets-render.test.ts -t "wraps the spent/limit figure"`
Expected: FAIL — current markup has no `data-money` attribute anywhere.

- [ ] **Step 3: Write the fix**

In `components/dashboard/widgets/BudgetWidget.tsx`, change:

```tsx
                <span className="tabular-nums text-muted">
                  {formatCurrency(group.spent, currency)} /{" "}
                  {formatCurrency(group.monthlyLimit, currency)}
                </span>
```

to:

```tsx
                <span className="tabular-nums text-muted" data-money>
                  {formatCurrency(group.spent, currency)} /{" "}
                  {formatCurrency(group.monthlyLimit, currency)}
                </span>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/dashboard-widgets-render.test.ts`
Expected: PASS, all tests in the file (the new one plus every pre-existing `BudgetWidget`/`WidgetShell`/other-widget test still green).

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/widgets/BudgetWidget.tsx tests/unit/dashboard-widgets-render.test.ts
git commit -m "fix: cover BudgetWidget's spent/limit figure with the privacy-blur hook"
```

---

### Task 7: Full verification and manual QA

**Files:** None (verification only).

- [ ] **Step 1: Full automated verification**

Run in order, fixing anything that fails before moving to the next:

```bash
npm run lint
npx tsc --noEmit
npm run test:unit
npm run build
```

All four must pass clean. `npm run build` is also the fastest full type/route check per `CLAUDE.md` — a green build here means Next.js itself accepts every new/changed file.

- [ ] **Step 2: Manual browser check**

```bash
npm run dev
```

Open `http://localhost:3000/dashboard` signed in as a user with at least one connected depository (checking/savings) account and some transactions this month (use `/api/demo` per `docs/QA.md`/prior session notes if no live data is available). Confirm:

- The Ledger Strip renders above the widget grid, showing this month's transactions in order, ending in a running balance that matches the account's real current balance.
- Hovering and tab-focusing a minor (small-outflow) tick reveals its date/amount/merchant; major ticks (income, and outflows ≥ $100) show their label without needing hover/focus.
- Toggling the privacy-blur control blurs the Ledger Strip's running balance and every tick amount, exactly like it already blurs the other widgets' money figures.
- Recent Transactions (in the widget grid) shows visible zebra striping and mono-styled dates.
- Toggle the OS/browser to dark mode (or `prefers-color-scheme`) and confirm the Ledger Strip and Recent Transactions still read correctly — both reuse existing dark-mode tokens, so no new dark-mode work should be needed, but confirm nothing looks broken.
- If the signed-in account has no depository account at all, confirm the dashboard renders exactly as it did before this change (no Ledger Strip, no error, no layout gap).

- [ ] **Step 3: Stop the dev server**

Stop the `npm run dev` process once manual QA is complete.

## Spec coverage

Every design decision and deviation in `docs/superpowers/specs/2026-08-24-dashboard-ledger-strip-design.md` maps to a task above:

- Token/font reuse, no new colors → Tasks 1, 3 (no new CSS custom properties; `font-mono`/`.metric-value`/`Money` only).
- `--viz-pos`/`--viz-neg` for inflow/outflow → Task 3.
- Signature confined to Ledger Strip + Recent Transactions → Tasks 3, 5 (no other widget touched, except the unrelated Task 6 bugfix).
- "Spending vs last month" untouched → no task modifies `SpendingCompareWidget.tsx` or `CumulativeCompareChart.tsx`.
- No `PageHeader` kicker → no task modifies `components/shell/PageHeader.tsx` or the greeting logic in `app/dashboard/page.tsx` beyond the one added `accounts` prop.
- Single anchor account, mine-only → Task 1 (`pickAnchorAccount`), Task 2 (query scoped to one `account_id`).
- Major/minor threshold, independent of anomaly detection → Task 1 (`MAJOR_TICK_THRESHOLD`).
- No load animation → Task 3 (no keyframe/animation in the implementation).
- `BudgetWidget` privacy-blur fix → Task 6.
