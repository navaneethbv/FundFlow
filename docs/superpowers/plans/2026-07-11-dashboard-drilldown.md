# Dashboard Drill-Down Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every dashboard aggregate clickable: category -> subcategory -> transactions drill-down in place, month/merchant/card/bank drills, and exact filters on the Transactions page.

**Architecture:** URL-param-driven, fully server-rendered. Drill state lives in `/dashboard` searchParams (`category`, `sub`, `merchant`, `itemId`) alongside the existing `month`/`accountId`/`tab`. Pure aggregation lives in a new `lib/drilldown.ts` (unit-tested like `chart-utils.ts`); `lib/dashboard.ts` wires it over the already-fetched 6-month transaction window. Charts gain link affordances via optional `href` fields on their item props (SVG `<a>` + `next/link`); zero client JS.

**Tech Stack:** Next.js 16 App Router (server components), TypeScript, Tailwind 4, Supabase (user-scoped RLS client only), Vitest.

**Spec:** `docs/superpowers/specs/2026-07-11-dashboard-drilldown-design.md`

## Global Constraints

- No client-side JS in charts, no chart library. Interactivity is `<a>` links only.
- No new Plaid calls; the transaction fetch stays bounded to the 6-month window (never a select-all).
- All reads use the user-scoped (RLS-bound) client; no service-client usage anywhere in this feature.
- Every spend total applies `EXCLUDED_PFC` semantics (already encoded in `isSpending`); linked-refund pairs stay excluded from drill totals.
- Amount sign follows Plaid: positive = money out. Dates are `YYYY-MM-DD` strings; month keys `YYYY-MM`.
- Never interpolate raw user input into PostgREST filters; new Transactions filters are validated against strict patterns before use.
- Never render a 7th+ categorical hue: donuts stay folded to <= 6 slices; the full-category view is a single-color BarList, not a donut.
- `getDashboardData` called without the new options must return exactly what it returns today (all existing tests stay green).
- Forbidden output character: never use the em dash (U+2014) in any file.
- Run `npx vitest run <file>` per task; `npm run test:unit`, `npx tsc --noEmit`, `npm run lint`, `npm run build` in the final task.
- Commit after every task (small, conventional-commit messages).

## URL contract (used by every task)

| Param | Example | Meaning |
| --- | --- | --- |
| `category` | `RENT_AND_UTILITIES` | Level-1 drill (pfc_primary key). `_other` = expanded full-category list |
| `sub` | `RENT_AND_UTILITIES_RENT` | Level-2 drill (pfc_detailed key); only valid with `category` |
| `merchant` | `Netflix` | Merchant drill; ignored when `category` present |
| `itemId` | uuid | Filter dashboard to one bank (plaid_items id) |

Links preserve `month`, `accountId`, `itemId`, `tab`. Switching tab drops `category`/`sub`/`merchant` (the existing `tabUrl` already does this by omission). Switching month or account keeps the drill.

---

### Task 1: Drill param normalization + URL builder (`lib/drilldown.ts` part 1)

**Files:**
- Create: `lib/drilldown.ts`
- Test: `tests/unit/drilldown.test.ts`

**Interfaces:**
- Consumes: `titleCase` from `@/lib/format`.
- Produces (later tasks import these exact names from `@/lib/drilldown`):
  - `DrillTxn`, `DrillSplit`, `DrillParams` interfaces
  - `MANUAL_SPLIT_KEY = "MANUAL_SPLIT"`, `OTHER_CATEGORY_KEY = "_other"`
  - `normalizeDrillParams(raw, known): DrillParams`
  - `dashboardUrl(params): string`
  - `subcategoryLabel(category, subKey): string`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/drilldown.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  dashboardUrl,
  normalizeDrillParams,
  subcategoryLabel,
  MANUAL_SPLIT_KEY,
  OTHER_CATEGORY_KEY,
} from "@/lib/drilldown";

describe("dashboardUrl", () => {
  it("builds /dashboard with only the params provided, in stable order", () => {
    expect(dashboardUrl({})).toBe("/dashboard");
    expect(dashboardUrl({ tab: "overview", month: "2026-07" })).toBe(
      "/dashboard?tab=overview&month=2026-07",
    );
    expect(
      dashboardUrl({
        tab: "overview",
        month: "2026-07",
        accountId: "acct-1",
        itemId: "item-1",
        category: "FOOD_AND_DRINK",
        sub: "FOOD_AND_DRINK_COFFEE",
      }),
    ).toBe(
      "/dashboard?tab=overview&month=2026-07&accountId=acct-1&itemId=item-1&category=FOOD_AND_DRINK&sub=FOOD_AND_DRINK_COFFEE",
    );
  });

  it("URL-encodes merchant names", () => {
    expect(dashboardUrl({ merchant: "Trader Joe's" })).toBe(
      "/dashboard?merchant=Trader+Joe%27s",
    );
  });
});

describe("normalizeDrillParams", () => {
  const known = {
    categories: new Set(["FOOD_AND_DRINK", "RENT_AND_UTILITIES"]),
    subcategories: new Set(["FOOD_AND_DRINK_COFFEE"]),
    merchants: new Set(["netflix", "trader joe's"]),
  };

  it("accepts a known category and known sub", () => {
    expect(
      normalizeDrillParams(
        { category: "FOOD_AND_DRINK", sub: "FOOD_AND_DRINK_COFFEE" },
        known,
      ),
    ).toEqual({ category: "FOOD_AND_DRINK", sub: "FOOD_AND_DRINK_COFFEE" });
  });

  it("drops an unknown sub but keeps the category", () => {
    expect(
      normalizeDrillParams({ category: "FOOD_AND_DRINK", sub: "NOPE" }, known),
    ).toEqual({ category: "FOOD_AND_DRINK" });
  });

  it("accepts MANUAL_SPLIT and UNCATEGORIZED sentinels as sub", () => {
    expect(
      normalizeDrillParams({ category: "FOOD_AND_DRINK", sub: MANUAL_SPLIT_KEY }, known),
    ).toEqual({ category: "FOOD_AND_DRINK", sub: MANUAL_SPLIT_KEY });
  });

  it("rejects an unknown category entirely (sub dropped too)", () => {
    expect(normalizeDrillParams({ category: "EVIL", sub: "X" }, known)).toEqual({});
  });

  it("passes _other through untouched", () => {
    expect(normalizeDrillParams({ category: OTHER_CATEGORY_KEY }, known)).toEqual({
      category: OTHER_CATEGORY_KEY,
    });
  });

  it("matches merchants case-insensitively, returning the trimmed raw value", () => {
    expect(normalizeDrillParams({ merchant: "  NETFLIX " }, known)).toEqual({
      merchant: "NETFLIX",
    });
    expect(normalizeDrillParams({ merchant: "Unknown Co" }, known)).toEqual({});
  });

  it("category wins over merchant when both are present", () => {
    expect(
      normalizeDrillParams({ category: "FOOD_AND_DRINK", merchant: "Netflix" }, known),
    ).toEqual({ category: "FOOD_AND_DRINK" });
  });
});

describe("subcategoryLabel", () => {
  it("strips the primary-category prefix and title-cases", () => {
    expect(subcategoryLabel("RENT_AND_UTILITIES", "RENT_AND_UTILITIES_RENT")).toBe("Rent");
    expect(
      subcategoryLabel("FOOD_AND_DRINK", "FOOD_AND_DRINK_COFFEE"),
    ).toBe("Coffee");
  });

  it("handles sentinels and non-prefixed keys", () => {
    expect(subcategoryLabel("FOOD_AND_DRINK", MANUAL_SPLIT_KEY)).toBe("Manual split");
    expect(subcategoryLabel("FOOD_AND_DRINK", "UNCATEGORIZED")).toBe("Uncategorized");
    expect(subcategoryLabel("FOOD_AND_DRINK", "SOMETHING_ELSE")).toBe("Something Else");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/drilldown.test.ts`
Expected: FAIL with "Cannot find module '@/lib/drilldown'" (or equivalent resolve error).

- [ ] **Step 3: Write the implementation**

Create `lib/drilldown.ts`:

```ts
import { titleCase } from "@/lib/format";

/**
 * Pure drill-down helpers for the dashboard. Everything here operates on
 * already-fetched, rules-applied window transactions (no I/O), mirroring the
 * chart-utils.ts pattern so it stays unit-testable.
 *
 * Sign convention (Plaid): positive amount = money out. Callers pass
 * spending-only, refund-excluded transactions (lib/dashboard.ts owns those
 * filters via isSpending + the linked-refund set).
 */

export const MANUAL_SPLIT_KEY = "MANUAL_SPLIT";
export const OTHER_CATEGORY_KEY = "_other";
const UNCATEGORIZED_KEY = "UNCATEGORIZED";

export interface DrillTxn {
  id: string;
  date: string; // YYYY-MM-DD
  amount: number;
  merchant: string;
  category: string | null; // rules-applied pfc_primary
  subcategory: string | null; // pfc_detailed
}

export interface DrillSplit {
  transactionId: string;
  category: string;
  amount: number;
}

export interface DrillParams {
  category?: string;
  sub?: string;
  merchant?: string;
}

export interface KnownDrillValues {
  categories: Set<string>;
  subcategories: Set<string>;
  /** lower-cased, trimmed merchant names */
  merchants: Set<string>;
}

/**
 * Validate raw searchParam strings against values that actually exist in the
 * user's data. Anything unknown is dropped (the page renders un-drilled).
 * `category` wins over `merchant`; `sub` requires a valid `category`.
 */
export function normalizeDrillParams(
  raw: DrillParams,
  known: KnownDrillValues,
): DrillParams {
  if (raw.category === OTHER_CATEGORY_KEY) return { category: OTHER_CATEGORY_KEY };
  if (raw.category && (known.categories.has(raw.category) || raw.category === UNCATEGORIZED_KEY)) {
    const out: DrillParams = { category: raw.category };
    if (
      raw.sub &&
      (known.subcategories.has(raw.sub) ||
        raw.sub === MANUAL_SPLIT_KEY ||
        raw.sub === UNCATEGORIZED_KEY)
    ) {
      out.sub = raw.sub;
    }
    return out;
  }
  if (raw.merchant) {
    const merchant = raw.merchant.trim();
    if (known.merchants.has(merchant.toLowerCase())) return { merchant };
  }
  return {};
}

/** Canonical /dashboard URL builder; skips empty params, stable key order. */
export function dashboardUrl(params: {
  tab?: string;
  month?: string;
  accountId?: string;
  itemId?: string;
  category?: string;
  sub?: string;
  merchant?: string;
}): string {
  const search = new URLSearchParams();
  for (const key of ["tab", "month", "accountId", "itemId", "category", "sub", "merchant"] as const) {
    const value = params[key];
    if (value) search.set(key, value);
  }
  const qs = search.toString();
  return qs ? `/dashboard?${qs}` : "/dashboard";
}

/** "RENT_AND_UTILITIES_RENT" within RENT_AND_UTILITIES -> "Rent". */
export function subcategoryLabel(category: string, subKey: string): string {
  if (subKey === MANUAL_SPLIT_KEY) return "Manual split";
  if (subKey === UNCATEGORIZED_KEY) return "Uncategorized";
  const prefix = `${category}_`;
  return titleCase(subKey.startsWith(prefix) ? subKey.slice(prefix.length) : subKey);
}
```

Note: check `lib/format.ts` `titleCase` output for "MANUAL_SPLIT" style keys before relying on the sentinel branches; the sentinels are special-cased above precisely so the label copy is controlled.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/drilldown.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add lib/drilldown.ts tests/unit/drilldown.test.ts
git commit -m "feat: drill param normalization and dashboard URL builder"
```

---

### Task 2: `buildCategoryDrilldown` (pure aggregation)

**Files:**
- Modify: `lib/drilldown.ts`
- Test: `tests/unit/drilldown.test.ts`

**Interfaces:**
- Consumes: Task 1's `DrillTxn`, `DrillSplit`, `MANUAL_SPLIT_KEY`, `subcategoryLabel`.
- Produces:
  - `CategoryDrilldownData` interface (exact shape below)
  - `buildCategoryDrilldown(input: { txns: DrillTxn[]; splits: DrillSplit[]; category: string; sub: string | null; months: string[]; activeMonth: string }): CategoryDrilldownData`

Semantics (from the spec):
- A transaction belongs to the drilled category if its rules-applied category matches, or (active month only, where splits are fetched) any valid split assigns spend to it; the attributed amount is the split amount in that case. Split validity = split amounts sum to the transaction amount within a cent (same rule as `validateSplits` in `lib/transaction-quality.ts`).
- Split-assigned portions group under the `MANUAL_SPLIT` subcategory bucket.
- `months` is the 6-month window oldest -> newest (matches `monthlySpending` order); trend uses whole-transaction category matching for non-active months.
- `momDelta` = active-month total minus previous-month trend value.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/drilldown.test.ts`:

```ts
import { buildCategoryDrilldown, type DrillTxn } from "@/lib/drilldown";

const WINDOW = ["2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"];

function txn(partial: Partial<DrillTxn> & { id: string }): DrillTxn {
  return {
    date: "2026-07-10",
    amount: 100,
    merchant: "Merchant",
    category: "FOOD_AND_DRINK",
    subcategory: "FOOD_AND_DRINK_GROCERIES",
    ...partial,
  };
}

describe("buildCategoryDrilldown", () => {
  it("groups active-month spend by subcategory and ranks merchants", () => {
    const result = buildCategoryDrilldown({
      txns: [
        txn({ id: "a", amount: 60, merchant: "Safeway" }),
        txn({ id: "b", amount: 40, merchant: "Safeway" }),
        txn({ id: "c", amount: 30, merchant: "Blue Bottle", subcategory: "FOOD_AND_DRINK_COFFEE" }),
        txn({ id: "d", amount: 999, category: "TRAVEL", subcategory: null }),
      ],
      splits: [],
      category: "FOOD_AND_DRINK",
      sub: null,
      months: WINDOW,
      activeMonth: "2026-07",
    });
    expect(result.kind).toBe("category");
    expect(result.total).toBe(130);
    expect(result.subcategories).toEqual([
      { key: "FOOD_AND_DRINK_GROCERIES", label: "Groceries", amount: 100 },
      { key: "FOOD_AND_DRINK_COFFEE", label: "Coffee", amount: 30 },
    ]);
    expect(result.merchants).toEqual([
      { merchant: "Safeway", amount: 100 },
      { merchant: "Blue Bottle", amount: 30 },
    ]);
    expect(result.transactions.map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("null subcategory groups under UNCATEGORIZED", () => {
    const result = buildCategoryDrilldown({
      txns: [txn({ id: "a", subcategory: null })],
      splits: [],
      category: "FOOD_AND_DRINK",
      sub: null,
      months: WINDOW,
      activeMonth: "2026-07",
    });
    expect(result.subcategories).toEqual([
      { key: "UNCATEGORIZED", label: "Uncategorized", amount: 100 },
    ]);
  });

  it("valid splits reassign spend into the category with the split amount", () => {
    const result = buildCategoryDrilldown({
      txns: [txn({ id: "a", amount: 100, category: "GENERAL_MERCHANDISE", subcategory: null, merchant: "Costco" })],
      splits: [
        { transactionId: "a", category: "FOOD_AND_DRINK", amount: 70 },
        { transactionId: "a", category: "GENERAL_MERCHANDISE", amount: 30 },
      ],
      category: "FOOD_AND_DRINK",
      sub: null,
      months: WINDOW,
      activeMonth: "2026-07",
    });
    expect(result.total).toBe(70);
    expect(result.subcategories).toEqual([
      { key: "MANUAL_SPLIT", label: "Manual split", amount: 70 },
    ]);
    expect(result.transactions).toEqual([
      expect.objectContaining({ id: "a", amount: 70, merchant: "Costco" }),
    ]);
  });

  it("invalid splits (do not sum to the amount) fall back to whole-txn category", () => {
    const result = buildCategoryDrilldown({
      txns: [txn({ id: "a", amount: 100 })],
      splits: [{ transactionId: "a", category: "TRAVEL", amount: 10 }],
      category: "FOOD_AND_DRINK",
      sub: null,
      months: WINDOW,
      activeMonth: "2026-07",
    });
    expect(result.total).toBe(100);
  });

  it("builds a 6-month trend and MoM delta for the category", () => {
    const result = buildCategoryDrilldown({
      txns: [
        txn({ id: "a", date: "2026-06-05", amount: 50 }),
        txn({ id: "b", date: "2026-07-05", amount: 80 }),
        txn({ id: "c", date: "2026-03-01", amount: 20 }),
      ],
      splits: [],
      category: "FOOD_AND_DRINK",
      sub: null,
      months: WINDOW,
      activeMonth: "2026-07",
    });
    expect(result.trend).toEqual([
      { month: "2026-02", amount: 0 },
      { month: "2026-03", amount: 20 },
      { month: "2026-04", amount: 0 },
      { month: "2026-05", amount: 0 },
      { month: "2026-06", amount: 50 },
      { month: "2026-07", amount: 80 },
    ]);
    expect(result.momDelta).toBe(30);
  });

  it("sub filter scopes everything to one subcategory", () => {
    const result = buildCategoryDrilldown({
      txns: [
        txn({ id: "a", amount: 60 }),
        txn({ id: "b", amount: 30, merchant: "Blue Bottle", subcategory: "FOOD_AND_DRINK_COFFEE" }),
      ],
      splits: [],
      category: "FOOD_AND_DRINK",
      sub: "FOOD_AND_DRINK_COFFEE",
      months: WINDOW,
      activeMonth: "2026-07",
    });
    expect(result.total).toBe(30);
    expect(result.merchants).toEqual([{ merchant: "Blue Bottle", amount: 30 }]);
    expect(result.transactions.map((t) => t.id)).toEqual(["b"]);
    expect(result.trend[5]).toEqual({ month: "2026-07", amount: 30 });
  });

  it("transactions sort newest first and cap at 25", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      txn({ id: `t${i}`, date: `2026-07-${String((i % 28) + 1).padStart(2, "0")}`, amount: 5 }),
    );
    const result = buildCategoryDrilldown({
      txns: many,
      splits: [],
      category: "FOOD_AND_DRINK",
      sub: null,
      months: WINDOW,
      activeMonth: "2026-07",
    });
    expect(result.transactions).toHaveLength(25);
    expect(result.transactions[0]!.date >= result.transactions[1]!.date).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/drilldown.test.ts`
Expected: FAIL with "buildCategoryDrilldown is not a function" (module has no such export).

- [ ] **Step 3: Write the implementation**

Append to `lib/drilldown.ts`:

```ts
export interface CategoryDrilldownData {
  kind: "category";
  category: string;
  sub: string | null;
  /** Active-month total for the drilled scope. */
  total: number;
  /** Active-month total minus previous month's. */
  momDelta: number;
  subcategories: { key: string; label: string; amount: number }[];
  merchants: { merchant: string; amount: number }[];
  trend: { month: string; amount: number }[];
  /** Active-month rows, newest first, capped; amount = attributed amount. */
  transactions: DrillTxn[];
}

const TXN_CAP = 25;
const MERCHANT_CAP = 8;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

interface Contribution {
  txn: DrillTxn;
  amount: number;
  subKey: string;
}

export function buildCategoryDrilldown(input: {
  txns: DrillTxn[];
  splits: DrillSplit[];
  category: string;
  sub: string | null;
  /** Window months oldest -> newest; must contain activeMonth. */
  months: string[];
  activeMonth: string;
}): CategoryDrilldownData {
  const { txns, splits, category, sub, months, activeMonth } = input;

  const splitsByTxn = new Map<string, DrillSplit[]>();
  for (const split of splits) {
    const rows = splitsByTxn.get(split.transactionId) ?? [];
    rows.push(split);
    splitsByTxn.set(split.transactionId, rows);
  }

  // Membership: split-aware for the active month (splits are only fetched for
  // it), whole-transaction category elsewhere - matching how the donut totals
  // are computed so drill totals always reconcile.
  const contributions: Contribution[] = [];
  for (const txn of txns) {
    const month = txn.date.slice(0, 7);
    if (month === activeMonth) {
      const rows = splitsByTxn.get(txn.id);
      const splitTotal = rows?.reduce((sum, row) => sum + row.amount, 0) ?? 0;
      if (rows && Math.abs(Math.abs(txn.amount) - splitTotal) < 0.01) {
        for (const row of rows) {
          if (row.category !== category) continue;
          contributions.push({ txn, amount: row.amount, subKey: MANUAL_SPLIT_KEY });
        }
        continue;
      }
    }
    if ((txn.category ?? "UNCATEGORIZED") !== category) continue;
    contributions.push({
      txn,
      amount: txn.amount,
      subKey: txn.subcategory ?? "UNCATEGORIZED",
    });
  }

  const scoped = sub ? contributions.filter((c) => c.subKey === sub) : contributions;

  const trendMap = new Map<string, number>();
  for (const c of scoped) {
    const month = c.txn.date.slice(0, 7);
    trendMap.set(month, (trendMap.get(month) ?? 0) + c.amount);
  }
  const trend = months.map((month) => ({ month, amount: round2(trendMap.get(month) ?? 0) }));

  const activeScoped = scoped.filter((c) => c.txn.date.slice(0, 7) === activeMonth);
  const total = round2(activeScoped.reduce((sum, c) => sum + c.amount, 0));
  const activeIndex = months.indexOf(activeMonth);
  const prevAmount = activeIndex > 0 ? (trend[activeIndex - 1]?.amount ?? 0) : 0;
  const momDelta = round2(total - prevAmount);

  const subMap = new Map<string, number>();
  const merchantMap = new Map<string, number>();
  for (const c of activeScoped) {
    subMap.set(c.subKey, (subMap.get(c.subKey) ?? 0) + c.amount);
    merchantMap.set(c.txn.merchant, (merchantMap.get(c.txn.merchant) ?? 0) + c.amount);
  }
  const subcategories = [...subMap.entries()]
    .map(([key, amount]) => ({ key, label: subcategoryLabel(category, key), amount: round2(amount) }))
    .sort((a, b) => b.amount - a.amount || a.key.localeCompare(b.key));
  const merchants = [...merchantMap.entries()]
    .map(([merchant, amount]) => ({ merchant, amount: round2(amount) }))
    .sort((a, b) => b.amount - a.amount || a.merchant.localeCompare(b.merchant))
    .slice(0, MERCHANT_CAP);

  // One row per transaction (a multi-split txn contributes once, with the
  // summed attributed amount), newest first.
  const byId = new Map<string, DrillTxn>();
  for (const c of activeScoped) {
    const existing = byId.get(c.txn.id);
    byId.set(
      c.txn.id,
      existing
        ? { ...existing, amount: round2(existing.amount + c.amount) }
        : { ...c.txn, amount: round2(c.amount) },
    );
  }
  const transactions = [...byId.values()]
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id.localeCompare(b.id)))
    .slice(0, TXN_CAP);

  return { kind: "category", category, sub, total, momDelta, subcategories, merchants, trend, transactions };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/drilldown.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/drilldown.ts tests/unit/drilldown.test.ts
git commit -m "feat: split-aware category drilldown aggregation"
```

---

### Task 3: `buildMerchantDrilldown` (pure aggregation)

**Files:**
- Modify: `lib/drilldown.ts`
- Test: `tests/unit/drilldown.test.ts`

**Interfaces:**
- Consumes: Task 1/2 types.
- Produces:
  - `MerchantDrilldownData` interface
  - `buildMerchantDrilldown(input: { txns: DrillTxn[]; merchant: string; months: string[] }): MerchantDrilldownData`
  - `type DrilldownData = CategoryDrilldownData | MerchantDrilldownData`

Semantics: matches merchant case-insensitively (trimmed); stats (`total`, `count`, `average`) cover the whole 6-month window (a merchant view is about the pattern, not one month); `dominantCategory` is the category carrying the most spend; transactions are all window matches, newest first, capped at 25.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/drilldown.test.ts`:

```ts
import { buildMerchantDrilldown } from "@/lib/drilldown";

describe("buildMerchantDrilldown", () => {
  const txns: DrillTxn[] = [
    txn({ id: "a", date: "2026-07-01", amount: 15.49, merchant: "Netflix", category: "ENTERTAINMENT", subcategory: null }),
    txn({ id: "b", date: "2026-06-01", amount: 15.49, merchant: "netflix ", category: "ENTERTAINMENT", subcategory: null }),
    txn({ id: "c", date: "2026-05-01", amount: 12.99, merchant: "Netflix", category: "GENERAL_SERVICES", subcategory: null }),
    txn({ id: "d", date: "2026-07-02", amount: 80, merchant: "Safeway" }),
  ];

  it("matches case-insensitively and computes window stats", () => {
    const result = buildMerchantDrilldown({ txns, merchant: "Netflix", months: WINDOW });
    expect(result.kind).toBe("merchant");
    expect(result.count).toBe(3);
    expect(result.total).toBe(43.97);
    expect(result.average).toBe(14.66);
    expect(result.dominantCategory).toBe("ENTERTAINMENT");
    expect(result.transactions.map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("builds the per-month trend", () => {
    const result = buildMerchantDrilldown({ txns, merchant: "Netflix", months: WINDOW });
    expect(result.trend).toEqual([
      { month: "2026-02", amount: 0 },
      { month: "2026-03", amount: 0 },
      { month: "2026-04", amount: 0 },
      { month: "2026-05", amount: 12.99 },
      { month: "2026-06", amount: 15.49 },
      { month: "2026-07", amount: 15.49 },
    ]);
  });

  it("returns zeroed stats for a merchant with no matches", () => {
    const result = buildMerchantDrilldown({ txns, merchant: "Nobody", months: WINDOW });
    expect(result.count).toBe(0);
    expect(result.total).toBe(0);
    expect(result.average).toBe(0);
    expect(result.dominantCategory).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/drilldown.test.ts`
Expected: FAIL with "buildMerchantDrilldown is not a function".

- [ ] **Step 3: Write the implementation**

Append to `lib/drilldown.ts`:

```ts
export interface MerchantDrilldownData {
  kind: "merchant";
  merchant: string;
  /** Whole-window (6-month) stats. */
  total: number;
  count: number;
  average: number;
  dominantCategory: string | null;
  trend: { month: string; amount: number }[];
  transactions: DrillTxn[];
}

export type DrilldownData = CategoryDrilldownData | MerchantDrilldownData;

export function buildMerchantDrilldown(input: {
  txns: DrillTxn[];
  merchant: string;
  months: string[];
}): MerchantDrilldownData {
  const { txns, merchant, months } = input;
  const target = merchant.trim().toLowerCase();
  const matches = txns.filter((t) => t.merchant.trim().toLowerCase() === target);

  const trendMap = new Map<string, number>();
  const categoryMap = new Map<string, number>();
  let total = 0;
  for (const t of matches) {
    total += t.amount;
    const month = t.date.slice(0, 7);
    trendMap.set(month, (trendMap.get(month) ?? 0) + t.amount);
    const cat = t.category ?? "UNCATEGORIZED";
    categoryMap.set(cat, (categoryMap.get(cat) ?? 0) + t.amount);
  }

  const dominantCategory =
    [...categoryMap.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return {
    kind: "merchant",
    merchant,
    total: round2(total),
    count: matches.length,
    average: matches.length ? round2(total / matches.length) : 0,
    dominantCategory,
    trend: months.map((month) => ({ month, amount: round2(trendMap.get(month) ?? 0) })),
    transactions: matches
      .slice()
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id.localeCompare(b.id)))
      .slice(0, TXN_CAP),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/drilldown.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/drilldown.ts tests/unit/drilldown.test.ts
git commit -m "feat: merchant drilldown aggregation"
```

---

### Task 4: Wire drilldown into `lib/dashboard.ts` + cache scope

**Files:**
- Modify: `lib/dashboard.ts`
- Modify: `lib/dashboard-cache.ts`
- Test: `tests/unit/dashboard-cache-wiring.test.ts` (extend), `tests/unit/drilldown.test.ts` (scope-key tests)

**Interfaces:**
- Consumes: Task 1-3 exports from `@/lib/drilldown`.
- Produces:
  - `getDashboardData(supabase, selectedAccountId?, selectedMonth?, userId?, options?: DashboardOptions)` where `export interface DashboardOptions { itemId?: string; drill?: DrillParams }`
  - `DashboardData` gains: `drilldown?: DrilldownData`
  - `DashboardData.spendPerCard` items gain `accountId: string`; `spendPerBank` items gain `itemId: string | null`
  - `dashboard-cache.ts` exports `dashboardScopeKey(accountId?, month?, options?): string` and `getCachedDashboardData(supabase, userId, selectedAccountId?, selectedMonth?, options?: DashboardOptions)`

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/dashboard-cache-wiring.test.ts` (inside the existing `describe`):

```ts
it("caches different drill scopes separately", async () => {
  const base = await getCachedDashboardData(supabase, "drill-user", undefined, "2026-07");
  const drilled = await getCachedDashboardData(supabase, "drill-user", undefined, "2026-07", {
    drill: { category: "FOOD_AND_DRINK" },
  });
  const drilledAgain = await getCachedDashboardData(supabase, "drill-user", undefined, "2026-07", {
    drill: { category: "FOOD_AND_DRINK" },
  });
  expect(mockGetDashboardData).toHaveBeenCalledTimes(2);
  expect(drilled).not.toBe(base);
  expect(drilledAgain).toBe(drilled);
});

it("caches item-filtered scopes separately", async () => {
  await getCachedDashboardData(supabase, "item-user", undefined, "2026-07");
  await getCachedDashboardData(supabase, "item-user", undefined, "2026-07", { itemId: "item-1" });
  expect(mockGetDashboardData).toHaveBeenCalledTimes(2);
});
```

And add a scope-key unit test to `tests/unit/drilldown.test.ts` (it imports from dashboard-cache, which is fine because that module's import of `lib/dashboard` is type-only plus the mocked function; if the unmocked import drags in Supabase types only, it still loads):

Instead, to avoid cross-module surprises, put the scope-key tests in `tests/unit/dashboard-cache-wiring.test.ts` too (the module is already mocked there):

```ts
import { dashboardScopeKey } from "@/lib/dashboard-cache";

describe("dashboardScopeKey", () => {
  it("encodes every drill dimension", () => {
    expect(dashboardScopeKey(undefined, undefined)).toBe("all:default:all:-:-:-");
    expect(
      dashboardScopeKey("acct-1", "2026-07", {
        itemId: "item-1",
        drill: { category: "FOOD_AND_DRINK", sub: "FOOD_AND_DRINK_COFFEE" },
      }),
    ).toBe("acct-1:2026-07:item-1:FOOD_AND_DRINK:FOOD_AND_DRINK_COFFEE:-");
    expect(dashboardScopeKey(undefined, "2026-07", { drill: { merchant: "Netflix" } })).toBe(
      "all:2026-07:all:-:-:Netflix",
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/dashboard-cache-wiring.test.ts`
Expected: FAIL ("dashboardScopeKey is not a function" and/or drill-scope tests hitting the same cache entry).

- [ ] **Step 3: Update `lib/dashboard-cache.ts`**

Replace the bottom half of the file (from `const DASHBOARD_TTL_MS` comment block onward keeps its comment; the function bodies change):

```ts
import type { DashboardOptions } from "@/lib/dashboard";

export function dashboardScopeKey(
  selectedAccountId?: string,
  selectedMonth?: string,
  options?: DashboardOptions,
): string {
  return [
    selectedAccountId ?? "all",
    selectedMonth ?? "default",
    options?.itemId ?? "all",
    options?.drill?.category ?? "-",
    options?.drill?.sub ?? "-",
    options?.drill?.merchant ?? "-",
  ].join(":");
}

export async function getCachedDashboardData(
  supabase: SupabaseClient,
  userId: string,
  selectedAccountId?: string,
  selectedMonth?: string,
  options?: DashboardOptions,
): Promise<DashboardData> {
  const scope = dashboardScopeKey(selectedAccountId, selectedMonth, options);
  const cached = await dashboardCache.get(userId, scope);
  if (cached) return cached;
  const data = await getDashboardData(supabase, selectedAccountId, selectedMonth, userId, options);
  await dashboardCache.set(userId, scope, data);
  return data;
}
```

(`invalidateDashboardCache` is untouched; user-prefix invalidation already clears every drill scope.)

- [ ] **Step 4: Update `lib/dashboard.ts`**

4a. Imports: add at the top:

```ts
import {
  buildCategoryDrilldown,
  buildMerchantDrilldown,
  normalizeDrillParams,
  OTHER_CATEGORY_KEY,
  type DrilldownData,
  type DrillParams,
  type DrillTxn,
} from "@/lib/drilldown";
```

4b. Types: add to `DashboardData`:

```ts
  /** Present when a category/merchant drill is active and valid. */
  drilldown?: DrilldownData;
```

Change the two breakdown item shapes:

```ts
  spendPerCard: { name: string; amount: number; accountId: string }[];
  spendPerBank: { name: string; amount: number; itemId: string | null }[];
```

Add the options interface and extend the signature:

```ts
export interface DashboardOptions {
  itemId?: string;
  drill?: DrillParams;
}

export async function getDashboardData(
  supabase: SupabaseClient,
  selectedAccountId?: string,
  selectedMonth?: string,
  userId?: string,
  options?: DashboardOptions,
): Promise<DashboardData> {
```

4c. `TxnLite` gains `pfc_detailed: string | null;` and the stage-2 select adds it:

```ts
      .select("id, date, amount, merchant_name, name, pfc_primary, pfc_detailed, account_id")
```

(The `allTxnsRaw` mapping uses spread, so `pfc_detailed` flows through untouched.)

4d. Item filter: replace the `filteredTxns` assignment:

```ts
  // Filter transactions by selected account and/or bank (plaid item)
  const itemAccountIds = options?.itemId
    ? new Set(
        allAccounts
          .filter((a) => a.plaid_item_id === options.itemId)
          .map((a) => a.id),
      )
    : null;
  const filteredTxns = allTxnsRaw.filter(
    (t) =>
      (!selectedAccountId || t.account_id === selectedAccountId) &&
      (!itemAccountIds || itemAccountIds.has(t.account_id)),
  );
```

4e. `spendPerCard`: carry the id:

```ts
      return { name: displayName, amount: round2(amount), accountId: acctId };
```

4f. `spendPerBank`: rekey by item id so the id can be carried. Replace the block:

```ts
  const bankSpendMap = new Map<string, number>();
  for (const t of spendTxns) {
    if (monthKey(t.date) !== activeMonth || !isSpending(t)) continue;
    const acct = allAccounts.find((a) => a.id === t.account_id);
    const bankItemId = acct?.plaid_item_id ?? null;
    bankSpendMap.set(bankItemId ?? "", (bankSpendMap.get(bankItemId ?? "") ?? 0) + t.amount);
  }
  const spendPerBank = [...bankSpendMap.entries()]
    .map(([itemKey, amount]) => ({
      name: itemKey
        ? (allItems.find((i) => i.id === itemKey)?.institution_name ?? "Other Bank")
        : "Unknown Bank",
      amount: round2(amount),
      itemId: itemKey || null,
    }))
    .sort((a, b) => b.amount - a.amount);
```

4g. Drilldown computation: after `categoryBreakdown` is computed (it needs `splits`), add:

```ts
  // Drill-down: pure aggregation over the same window txns the donut uses.
  // Params are validated against values present in the data - unknown values
  // simply render the un-drilled dashboard.
  let drilldown: DrilldownData | undefined;
  if (options?.drill && (options.drill.category || options.drill.merchant)) {
    const windowSpendTxns: DrillTxn[] = spendTxns.filter(isSpending).map((t) => ({
      id: t.id,
      date: t.date,
      amount: t.amount,
      merchant: t.merchant_name ?? t.name ?? "Unknown",
      category: t.pfc_primary,
      subcategory: t.pfc_detailed,
    }));
    const knownCategories = new Set<string>();
    const knownSubcategories = new Set<string>();
    const knownMerchants = new Set<string>();
    for (const t of windowSpendTxns) {
      knownCategories.add(t.category ?? "UNCATEGORIZED");
      knownSubcategories.add(t.subcategory ?? "UNCATEGORIZED");
      knownMerchants.add(t.merchant.trim().toLowerCase());
    }
    for (const s of splits) knownCategories.add(s.category);
    const drill = normalizeDrillParams(options.drill, {
      categories: knownCategories,
      subcategories: knownSubcategories,
      merchants: knownMerchants,
    });
    const windowMonths = monthlySpending.map((m) => m.month);
    if (drill.category && drill.category !== OTHER_CATEGORY_KEY) {
      drilldown = buildCategoryDrilldown({
        txns: windowSpendTxns,
        splits: splits.map((s) => ({
          transactionId: s.transactionId,
          category: s.category,
          amount: s.amount,
        })),
        category: drill.category,
        sub: drill.sub ?? null,
        months: windowMonths,
        activeMonth,
      });
    } else if (drill.merchant) {
      drilldown = buildMerchantDrilldown({
        txns: windowSpendTxns,
        merchant: drill.merchant,
        months: windowMonths,
      });
    }
  }
```

(Note: `spendTxns` are refund-excluded already; `isSpending` applies `EXCLUDED_PFC`. The `splits` variable is the mapped array already in scope from the categoryBreakdown block.)

4h. Return: add `drilldown,` to the returned object (after `merchantBreakdown`).

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run tests/unit/dashboard-cache-wiring.test.ts tests/unit/drilldown.test.ts && npx tsc --noEmit`
Expected: tests PASS. `tsc` will flag `spendPerCard`/`spendPerBank` consumers if any destructure removed fields; `BreakdownsTab.tsx` only reads `name`/`amount`, so it should be clean. Fix any surfaced errors (they will be missing-field errors in tests that construct `DashboardData` fixtures; add the new fields there).

Also run the full unit suite to catch fixture breakage early:
`npm run test:unit`
Expected: PASS (fix `DashboardData` fixtures in `tests/unit/dashboard-ui.test.ts` / `planning-ui.test.ts` etc. by adding `accountId`/`itemId` fields to their `spendPerCard`/`spendPerBank` arrays if they exist there).

- [ ] **Step 6: Commit**

```bash
git add lib/dashboard.ts lib/dashboard-cache.ts tests/unit
git commit -m "feat: dashboard drilldown data wiring, itemId filter, drill-aware cache scope"
```

---

### Task 5: Link affordances in chart components

**Files:**
- Modify: `components/charts/DonutChart.tsx`
- Modify: `components/charts/TrendChart.tsx`
- Modify: `components/charts/DivergingColumns.tsx`
- Modify: `components/dashboard/BarList.tsx`
- Test: `tests/unit/charts-render.test.ts` (extend)

**Interfaces:**
- Produces (consumed by Tasks 6-8):
  - `DonutItem` gains `href?: string` (slice + legend row become links when set)
  - `BarList` items gain `href?: string`
  - `TrendChart` gains prop `links?: (string | undefined)[]` (parallel to `labels`; the invisible hit-target rect becomes a link)
  - `DivergingColumns` gains prop `links?: (string | undefined)[]` (same)
- Chart geometry in `lib/chart-utils.ts` is untouched.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/charts-render.test.ts`:

```ts
describe("chart link affordances", () => {
  it("DonutChart wraps slices and legend rows in links when href is set", () => {
    const html = renderToStaticMarkup(
      createElement(DonutChart, {
        items: [
          { label: "Food And Drink", amount: 420, href: "/dashboard?category=FOOD_AND_DRINK" },
          { label: "Travel", amount: 260 },
        ],
        centerLabel: "spent",
      }),
    );
    expect(html).toContain('href="/dashboard?category=FOOD_AND_DRINK"');
    // Unlinked items render no anchor for themselves: exactly 2 anchors
    // (slice + legend) for the one linked item.
    expect(html.match(/<a /g)?.length).toBe(2);
  });

  it("TrendChart makes month hit-targets links", () => {
    const html = renderToStaticMarkup(
      createElement(TrendChart, {
        labels,
        links: labels.map((_, i) => `/dashboard?month=2026-0${i + 1}`),
        series: [{ name: "Spending", slot: 1, values: spend }],
      }),
    );
    expect(html).toContain('href="/dashboard?month=2026-01"');
    expect(html).toContain('href="/dashboard?month=2026-06"');
  });

  it("DivergingColumns makes month hit-targets links", () => {
    const html = renderToStaticMarkup(
      createElement(DivergingColumns, {
        labels,
        up: income,
        down: spend,
        upName: "Deposits",
        downName: "Withdrawals",
        links: labels.map((_, i) => `/dashboard?tab=cashflow&month=2026-0${i + 1}`),
      }),
    );
    expect(html).toContain('href="/dashboard?tab=cashflow&amp;month=2026-03"');
  });
});
```

Also add a BarList render test in the same file:

```ts
import BarList from "@/components/dashboard/BarList";

describe("BarList links", () => {
  it("renders items as links when href is set", () => {
    const html = renderToStaticMarkup(
      createElement(BarList, {
        items: [
          { label: "Netflix", amount: 15.49, href: "/dashboard?merchant=Netflix" },
          { label: "Safeway", amount: 210 },
        ],
        max: 210,
      }),
    );
    expect(html).toContain('href="/dashboard?merchant=Netflix"');
    expect(html.match(/<a /g)?.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/charts-render.test.ts`
Expected: FAIL (no anchors rendered; `links`/`href` props rejected by TS in test or ignored at runtime).

- [ ] **Step 3: Implement `DonutChart` links**

In `components/charts/DonutChart.tsx`:

Add `href` to the interface:

```ts
export interface DonutItem {
  label: string;
  amount: number;
  /** When set, the slice and its legend row become links. */
  href?: string;
}
```

Wrap each slice path (the `segments.map` body) so linked slices are anchors:

```tsx
        {segments.map((s) => {
          const slice = (
            <path key={s.item.label} d={s.path} fill={`var(--viz-${slotOf(s.item)})`}>
              <title>
                {`${s.item.label}: ${valueFormatter(s.item.amount)} (${Math.round(
                  (s.item.amount / total) * 100,
                )}%)`}
              </title>
            </path>
          );
          return s.item.href ? (
            <a
              key={s.item.label}
              href={s.item.href}
              aria-label={`${s.item.label}: ${valueFormatter(s.item.amount)}`}
              className="focus-visible:outline-2"
            >
              {slice}
            </a>
          ) : (
            slice
          );
        })}
```

Legend rows: replace the `<li>` body so the row content is a `Link` when `href` is set (add `import Link from "next/link";` at the top):

```tsx
        {items.map((item, i) => {
          const row = (
            <>
              <span
                className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ background: `var(--viz-${i + 1})` }}
              />
              <span className="truncate" style={{ color: "var(--viz-ink-2)" }}>
                {item.label}
              </span>
              <span
                className="ml-auto tabular-nums font-medium"
                style={{ color: "var(--viz-ink)" }}
              >
                {valueFormatter(item.amount)}
              </span>
              <span className="w-10 text-right tabular-nums text-xs" style={{ color: "var(--viz-muted)" }}>
                {total > 0 ? `${Math.round((item.amount / total) * 100)}%` : ""}
              </span>
            </>
          );
          return (
            <li key={item.label}>
              {item.href ? (
                <Link
                  href={item.href}
                  className="flex items-center gap-2 rounded-field p-1 -m-1 hover:bg-panel-hover focus-visible:outline-2"
                >
                  {row}
                </Link>
              ) : (
                <span className="flex items-center gap-2 p-1 -m-1">{row}</span>
              )}
            </li>
          );
        })}
```

- [ ] **Step 4: Implement `TrendChart` and `DivergingColumns` links**

`TrendChart.tsx`: add to props:

```ts
  /** Optional per-label link (parallel to labels); wraps the hit-target rect. */
  links?: (string | undefined)[];
```

Replace the hit-target block:

```tsx
        {labels.map((l, i) => {
          const hit = (
            <rect
              x={x(i) - plotW / labels.length / 2}
              y={PAD.top}
              width={plotW / labels.length}
              height={plotH}
              fill="transparent"
            >
              <title>
                {`${l}${series.map((s) => ` · ${s.name}: ${valueFormatter(s.values[i] ?? 0)}`).join("")}`}
              </title>
            </rect>
          );
          const href = links?.[i];
          return href ? (
            <a key={l} href={href} aria-label={`View ${l}`}>
              {hit}
            </a>
          ) : (
            <g key={l}>{hit}</g>
          );
        })}
```

`DivergingColumns.tsx`: add the same `links?: (string | undefined)[]` prop; in the per-label `<g>` block, wrap only the existing hit-target `<rect>` (keep the column paths and axis text outside the anchor):

```tsx
            {links?.[i] ? (
              <a href={links[i]} aria-label={`View ${l}`}>
                <rect x={PAD.left + band * i} y={PAD.top} width={band} height={plotH} fill="transparent">
                  <title>
                    {`${l} · ${upName}: ${valueFormatter(up[i] ?? 0)} · ${downName}: ${valueFormatter(down[i] ?? 0)} · Net: ${valueFormatter((up[i] ?? 0) - (down[i] ?? 0))}`}
                  </title>
                </rect>
              </a>
            ) : (
              <rect x={PAD.left + band * i} y={PAD.top} width={band} height={plotH} fill="transparent">
                <title>
                  {`${l} · ${upName}: ${valueFormatter(up[i] ?? 0)} · ${downName}: ${valueFormatter(down[i] ?? 0)} · Net: ${valueFormatter((up[i] ?? 0) - (down[i] ?? 0))}`}
                </title>
              </rect>
            )}
```

- [ ] **Step 5: Implement `BarList` links**

Replace `components/dashboard/BarList.tsx`:

```tsx
import Link from "next/link";
import { formatCurrency } from "@/lib/format";

export default function BarList({
  items,
  max,
}: {
  items: { label: string; amount: number; href?: string }[];
  max: number;
}) {
  if (items.length === 0) {
    return <p className="py-4 text-sm text-muted">No data yet.</p>;
  }

  return (
    <ul className="space-y-3">
      {items.map((item) => {
        const body = (
          <>
            <div className="mb-1.5 flex justify-between gap-4 font-medium">
              <span>{item.label}</span>
              <span className="tabular-nums font-semibold">{formatCurrency(item.amount)}</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-panel-hover">
              <div
                className="h-full rounded-full bg-accent transition-all duration-500 ease-out"
                style={{ width: `${max > 0 ? (item.amount / max) * 100 : 0}%` }}
              />
            </div>
          </>
        );
        return (
          <li key={item.label} className="text-sm">
            {item.href ? (
              <Link
                href={item.href}
                className="block rounded-field p-1.5 -m-1.5 hover:bg-panel-hover focus-visible:outline-2"
              >
                {body}
              </Link>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/charts-render.test.ts && npm run test:unit`
Expected: PASS (including the pre-existing chart render assertions).

- [ ] **Step 7: Commit**

```bash
git add components/charts components/dashboard/BarList.tsx tests/unit/charts-render.test.ts
git commit -m "feat: link affordances on donut slices, bar rows, and chart month targets"
```

---

### Task 6: `CategoryDrilldownPanel` and `MerchantDrilldownPanel` components

**Files:**
- Create: `components/dashboard/CategoryDrilldownPanel.tsx`
- Create: `components/dashboard/MerchantDrilldownPanel.tsx`
- Test: `tests/unit/drilldown-panels.test.ts`

**Interfaces:**
- Consumes: `CategoryDrilldownData` / `MerchantDrilldownData` / `dashboardUrl` / `subcategoryLabel` / `MANUAL_SPLIT_KEY` from `@/lib/drilldown`; `DonutChart`, `TrendChart`, `BarList`, `Panel`; `formatCurrency`, `formatMonth`, `titleCase` from `@/lib/format`; `foldTail` from `@/lib/chart-utils`.
- Produces (consumed by Task 7):
  - `CategoryDrilldownPanel({ drill, linkParams, month })`
  - `MerchantDrilldownPanel({ drill, linkParams, month })`
  - Shared prop type: `export interface DrillLinkParams { tab: string; month?: string; accountId?: string; itemId?: string }` (exported from `CategoryDrilldownPanel.tsx`).

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/drilldown-panels.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import CategoryDrilldownPanel from "@/components/dashboard/CategoryDrilldownPanel";
import MerchantDrilldownPanel from "@/components/dashboard/MerchantDrilldownPanel";
import type { CategoryDrilldownData, MerchantDrilldownData } from "@/lib/drilldown";

const linkParams = { tab: "overview", month: "2026-07" };

const categoryDrill: CategoryDrilldownData = {
  kind: "category",
  category: "FOOD_AND_DRINK",
  sub: null,
  total: 488.25,
  momDelta: -42.1,
  subcategories: [
    { key: "FOOD_AND_DRINK_GROCERIES", label: "Groceries", amount: 300 },
    { key: "FOOD_AND_DRINK_COFFEE", label: "Coffee", amount: 188.25 },
  ],
  merchants: [{ merchant: "Safeway", amount: 300 }],
  trend: [
    { month: "2026-02", amount: 0 },
    { month: "2026-03", amount: 120 },
    { month: "2026-04", amount: 200 },
    { month: "2026-05", amount: 310 },
    { month: "2026-06", amount: 530.35 },
    { month: "2026-07", amount: 488.25 },
  ],
  transactions: [
    {
      id: "t1",
      date: "2026-07-08",
      amount: 84.1,
      merchant: "Safeway",
      category: "FOOD_AND_DRINK",
      subcategory: "FOOD_AND_DRINK_GROCERIES",
    },
  ],
};

describe("CategoryDrilldownPanel", () => {
  const html = renderToStaticMarkup(
    createElement(CategoryDrilldownPanel, { drill: categoryDrill, linkParams, month: "2026-07" }),
  );

  it("renders breadcrumb with a link back to all categories", () => {
    expect(html).toContain("All categories");
    expect(html).toContain('href="/dashboard?tab=overview&amp;month=2026-07"');
    expect(html).toContain("Food And Drink");
  });

  it("links subcategories to sub drills", () => {
    expect(html).toContain(
      'href="/dashboard?tab=overview&amp;month=2026-07&amp;category=FOOD_AND_DRINK&amp;sub=FOOD_AND_DRINK_GROCERIES"',
    );
  });

  it("links merchants to merchant drills", () => {
    expect(html).toContain('href="/dashboard?tab=overview&amp;month=2026-07&amp;merchant=Safeway"');
  });

  it("shows MoM delta, transactions, and a ledger link with exact filters", () => {
    expect(html).toContain("vs last month");
    expect(html).toContain("Safeway");
    expect(html).toContain("2026-07-08");
    expect(html).toContain(
      'href="/transactions?month=2026-07&amp;category=FOOD_AND_DRINK"',
    );
  });

  it("at sub level, breadcrumb links back to the category and ledger carries sub", () => {
    const subHtml = renderToStaticMarkup(
      createElement(CategoryDrilldownPanel, {
        drill: { ...categoryDrill, sub: "FOOD_AND_DRINK_COFFEE" },
        linkParams,
        month: "2026-07",
      }),
    );
    expect(subHtml).toContain(
      'href="/dashboard?tab=overview&amp;month=2026-07&amp;category=FOOD_AND_DRINK"',
    );
    expect(subHtml).toContain(
      'href="/transactions?month=2026-07&amp;category=FOOD_AND_DRINK&amp;sub=FOOD_AND_DRINK_COFFEE"',
    );
  });
});

describe("MerchantDrilldownPanel", () => {
  const merchantDrill: MerchantDrilldownData = {
    kind: "merchant",
    merchant: "Netflix",
    total: 46.47,
    count: 3,
    average: 15.49,
    dominantCategory: "ENTERTAINMENT",
    trend: [
      { month: "2026-02", amount: 0 },
      { month: "2026-03", amount: 15.49 },
      { month: "2026-04", amount: 0 },
      { month: "2026-05", amount: 15.49 },
      { month: "2026-06", amount: 0 },
      { month: "2026-07", amount: 15.49 },
    ],
    transactions: [
      {
        id: "n1",
        date: "2026-07-01",
        amount: 15.49,
        merchant: "Netflix",
        category: "ENTERTAINMENT",
        subcategory: null,
      },
    ],
  };
  const html = renderToStaticMarkup(
    createElement(MerchantDrilldownPanel, { drill: merchantDrill, linkParams, month: "2026-07" }),
  );

  it("shows stats and links the dominant category to a category drill", () => {
    expect(html).toContain("Netflix");
    expect(html).toContain("3"); // count
    expect(html).toContain(
      'href="/dashboard?tab=overview&amp;month=2026-07&amp;category=ENTERTAINMENT"',
    );
  });

  it("links to the ledger filtered by merchant", () => {
    expect(html).toContain('href="/transactions?month=2026-07&amp;merchant=Netflix"');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/drilldown-panels.test.ts`
Expected: FAIL with module-not-found for the two components.

- [ ] **Step 3: Implement `CategoryDrilldownPanel`**

Create `components/dashboard/CategoryDrilldownPanel.tsx`:

```tsx
import Link from "next/link";
import {
  dashboardUrl,
  subcategoryLabel,
  type CategoryDrilldownData,
} from "@/lib/drilldown";
import { foldTail } from "@/lib/chart-utils";
import { formatCurrency, formatMonth, titleCase } from "@/lib/format";
import DonutChart from "@/components/charts/DonutChart";
import TrendChart from "@/components/charts/TrendChart";
import BarList from "@/components/dashboard/BarList";
import Panel from "@/components/ui/Panel";

export interface DrillLinkParams {
  tab: string;
  month?: string;
  accountId?: string;
  itemId?: string;
}

function ledgerUrl(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  return `/transactions?${search.toString()}`;
}

export default function CategoryDrilldownPanel({
  drill,
  linkParams,
  month,
}: {
  drill: CategoryDrilldownData;
  linkParams: DrillLinkParams;
  /** The resolved active month (data.selectedMonth), for ledger links. */
  month: string;
}) {
  const categoryLabel = titleCase(drill.category);
  const atSubLevel = drill.sub !== null;
  const donutItems = foldTail(
    drill.subcategories.map((s) => ({
      label: s.label,
      amount: s.amount,
      href: atSubLevel
        ? undefined
        : dashboardUrl({ ...linkParams, category: drill.category, sub: s.key }),
    })),
    6,
    (amount) => ({ label: "Other", amount, href: undefined }),
  );
  const maxMerchant = Math.max(1, ...drill.merchants.map((m) => m.amount));
  const deltaLabel = `${drill.momDelta >= 0 ? "+" : "-"}${formatCurrency(Math.abs(drill.momDelta))} vs last month`;

  return (
    <Panel
      eyebrow="Drill-down"
      title={
        <span className="flex flex-wrap items-center gap-1.5 text-sm font-normal">
          <Link href={dashboardUrl(linkParams)} className="text-accent hover:underline">
            All categories
          </Link>
          <span aria-hidden className="text-muted">/</span>
          {atSubLevel ? (
            <>
              <Link
                href={dashboardUrl({ ...linkParams, category: drill.category })}
                className="text-accent hover:underline"
              >
                {categoryLabel}
              </Link>
              <span aria-hidden className="text-muted">/</span>
              <span className="font-semibold">{subcategoryLabel(drill.category, drill.sub!)}</span>
            </>
          ) : (
            <span className="font-semibold">{categoryLabel}</span>
          )}
        </span>
      }
      action={
        <span className="text-xs font-bold text-muted">
          {formatCurrency(drill.total)} · {deltaLabel}
        </span>
      }
    >
      <div className="space-y-5">
        {!atSubLevel && drill.subcategories.length > 0 && (
          <DonutChart items={donutItems} centerLabel="in category" />
        )}

        <div>
          <h4 className="eyebrow mb-2">Top merchants</h4>
          <BarList
            items={drill.merchants.map((m) => ({
              label: m.merchant,
              amount: m.amount,
              href: dashboardUrl({ ...linkParams, merchant: m.merchant }),
            }))}
            max={maxMerchant}
          />
        </div>

        <div>
          <h4 className="eyebrow mb-2">6-month trend</h4>
          <TrendChart
            labels={drill.trend.map((t) => formatMonth(t.month))}
            links={drill.trend.map((t) =>
              dashboardUrl({
                ...linkParams,
                month: t.month,
                category: drill.category,
                sub: drill.sub ?? undefined,
              }),
            )}
            series={[{ name: categoryLabel, slot: 1, values: drill.trend.map((t) => t.amount) }]}
          />
        </div>

        <div>
          <h4 className="eyebrow mb-2">Transactions</h4>
          <ul className="divide-y divide-panel-border text-sm">
            {drill.transactions.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-4 py-2">
                <span>
                  <span className="block font-medium">{t.merchant}</span>
                  <span className="block text-xs text-muted">{t.date}</span>
                </span>
                <span className="tabular-nums font-semibold">{formatCurrency(t.amount)}</span>
              </li>
            ))}
            {drill.transactions.length === 0 && (
              <li className="py-3 text-sm text-muted">No transactions this month.</li>
            )}
          </ul>
          <Link
            href={ledgerUrl({
              month,
              accountId: linkParams.accountId,
              category: drill.category,
              sub: drill.sub ?? undefined,
            })}
            className="mt-2 inline-block text-xs font-semibold text-accent hover:underline"
          >
            View all in Ledger
          </Link>
        </div>
      </div>
    </Panel>
  );
}
```

Note: check `components/ui/Panel.tsx` for the `title` prop type; if it is `string`, widen it to `React.ReactNode` (a one-line change) - the breadcrumb needs a node. If widening, run the full unit suite after.

- [ ] **Step 4: Implement `MerchantDrilldownPanel`**

Create `components/dashboard/MerchantDrilldownPanel.tsx`:

```tsx
import Link from "next/link";
import { dashboardUrl, type MerchantDrilldownData } from "@/lib/drilldown";
import { formatCurrency, formatMonth, titleCase } from "@/lib/format";
import TrendChart from "@/components/charts/TrendChart";
import Panel from "@/components/ui/Panel";
import type { DrillLinkParams } from "@/components/dashboard/CategoryDrilldownPanel";

export default function MerchantDrilldownPanel({
  drill,
  linkParams,
  month,
}: {
  drill: MerchantDrilldownData;
  linkParams: DrillLinkParams;
  month: string;
}) {
  const ledger = new URLSearchParams();
  ledger.set("month", month);
  if (linkParams.accountId) ledger.set("accountId", linkParams.accountId);
  ledger.set("merchant", drill.merchant);

  return (
    <Panel
      eyebrow="Merchant"
      title={
        <span className="flex flex-wrap items-center gap-1.5 text-sm font-normal">
          <Link href={dashboardUrl(linkParams)} className="text-accent hover:underline">
            All categories
          </Link>
          <span aria-hidden className="text-muted">/</span>
          <span className="font-semibold">{drill.merchant}</span>
        </span>
      }
      action={
        <span className="text-xs font-bold text-muted">
          {formatCurrency(drill.total)} over 6 months
        </span>
      }
    >
      <div className="space-y-5">
        <dl className="grid grid-cols-3 gap-3 text-sm">
          <div>
            <dt className="eyebrow">Charges</dt>
            <dd className="mt-1 tabular-nums font-semibold">{drill.count}</dd>
          </div>
          <div>
            <dt className="eyebrow">Average</dt>
            <dd className="mt-1 tabular-nums font-semibold">{formatCurrency(drill.average)}</dd>
          </div>
          <div>
            <dt className="eyebrow">Category</dt>
            <dd className="mt-1 font-semibold">
              {drill.dominantCategory ? (
                <Link
                  href={dashboardUrl({ ...linkParams, category: drill.dominantCategory })}
                  className="text-accent hover:underline"
                >
                  {titleCase(drill.dominantCategory)}
                </Link>
              ) : (
                "-"
              )}
            </dd>
          </div>
        </dl>

        <TrendChart
          labels={drill.trend.map((t) => formatMonth(t.month))}
          links={drill.trend.map((t) =>
            dashboardUrl({ ...linkParams, month: t.month, merchant: drill.merchant }),
          )}
          series={[{ name: drill.merchant, slot: 1, values: drill.trend.map((t) => t.amount) }]}
        />

        <div>
          <h4 className="eyebrow mb-2">Transactions</h4>
          <ul className="divide-y divide-panel-border text-sm">
            {drill.transactions.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-4 py-2">
                <span>
                  <span className="block font-medium">{t.merchant}</span>
                  <span className="block text-xs text-muted">{t.date}</span>
                </span>
                <span className="tabular-nums font-semibold">{formatCurrency(t.amount)}</span>
              </li>
            ))}
            {drill.transactions.length === 0 && (
              <li className="py-3 text-sm text-muted">No transactions in the window.</li>
            )}
          </ul>
          <Link
            href={`/transactions?${ledger.toString()}`}
            className="mt-2 inline-block text-xs font-semibold text-accent hover:underline"
          >
            View all in Ledger
          </Link>
        </div>
      </div>
    </Panel>
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/drilldown-panels.test.ts && npm run test:unit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/dashboard/CategoryDrilldownPanel.tsx components/dashboard/MerchantDrilldownPanel.tsx components/ui/Panel.tsx tests/unit/drilldown-panels.test.ts
git commit -m "feat: category and merchant drill-down panels"
```

---

### Task 7: Dashboard page + OverviewTab wiring

**Files:**
- Modify: `app/dashboard/page.tsx`
- Modify: `components/dashboard/OverviewTab.tsx`
- Modify: `components/dashboard/MonthChips.tsx`
- Modify: `components/dashboard/CardCarousel.tsx` (link builder only)
- Test: `tests/unit/dashboard-ui.test.ts` (extend if it renders OverviewTab; otherwise coverage comes from Tasks 5-6 and the build)

**Interfaces:**
- Consumes: `DashboardOptions` (Task 4), `CategoryDrilldownPanel` / `MerchantDrilldownPanel` / `DrillLinkParams` (Task 6), `dashboardUrl` / `OTHER_CATEGORY_KEY` (Task 1), chart `href`/`links` props (Task 5).
- Produces: `/dashboard` accepts and round-trips `category`, `sub`, `merchant`, `itemId` searchParams.

- [ ] **Step 1: Parse and pass the new params in `app/dashboard/page.tsx`**

Extend `PageProps`:

```ts
interface PageProps {
  searchParams: Promise<{
    accountId?: string;
    month?: string;
    tab?: string;
    itemId?: string;
    category?: string;
    sub?: string;
    merchant?: string;
  }>;
}
```

After the existing param reads:

```ts
  const selectedItemId = params.itemId;
  const drillOptions = {
    itemId: selectedItemId,
    drill: { category: params.category, sub: params.sub, merchant: params.merchant },
  };
```

Pass through to the data call:

```ts
    user
      ? getCachedDashboardData(supabase, user.id, selectedAccountId, selectedMonth, drillOptions)
      : getDashboardData(supabase, selectedAccountId, selectedMonth, undefined, drillOptions),
```

Update `tabUrl` to also carry `itemId` (drill params are deliberately dropped on tab switch):

```ts
function tabUrl(tab: string, selectedAccountId?: string, selectedMonth?: string, itemId?: string) {
  const params = new URLSearchParams({ tab });
  if (selectedAccountId) params.set("accountId", selectedAccountId);
  if (selectedMonth) params.set("month", selectedMonth);
  if (itemId) params.set("itemId", itemId);
  return `/dashboard?${params.toString()}`;
}
```

and update the three `tabUrl(...)` call sites to pass `selectedItemId` as the 4th argument.

Build the link params and pass new props into the tabs:

```ts
  const linkParams = {
    tab: activeTab,
    month: selectedMonth,
    accountId: selectedAccountId,
    itemId: selectedItemId,
  };
  const drillQuery = {
    category: params.category,
    sub: params.sub,
    merchant: params.merchant,
  };
```

```tsx
          {activeTab === "overview" && (
            <OverviewTab
              data={data}
              netWorth={netWorth}
              savingsRate={savingsRate}
              recentTransactions={recentTransactions}
              accountNames={accountNames}
              goals={goals}
              linkParams={linkParams}
              drillQuery={drillQuery}
            />
          )}
          {activeTab === "breakdowns" && <BreakdownsTab data={data} linkParams={linkParams} />}
          {activeTab === "cashflow" && <CashflowTab data={data} linkParams={linkParams} />}
```

(`BreakdownsTab`/`CashflowTab` props land in Task 8; add the props there - for this task pass them anyway and update both components' signatures minimally to accept and ignore `linkParams`, or defer the two lines to Task 8. Prefer: add the props in Task 8 and leave those two lines unchanged here.)

`MonthChips` and `CardCarousel` need to preserve the drill:

```tsx
          <CardCarousel
            accounts={data.accounts}
            selectedAccountId={selectedAccountId}
            selectedMonth={selectedMonth}
            activeTab={activeTab}
            extraParams={{ itemId: selectedItemId, ...drillQuery }}
          />
          <MonthChips
            months={data.availableMonths}
            selectedMonth={data.selectedMonth}
            selectedAccountId={selectedAccountId}
            activeTab={activeTab}
            extraParams={{ itemId: selectedItemId, ...drillQuery }}
          />
```

- [ ] **Step 2: `MonthChips` extraParams**

In `components/dashboard/MonthChips.tsx`, add the prop and merge it into the URL:

```tsx
export default function MonthChips({
  months,
  selectedMonth,
  selectedAccountId,
  activeTab,
  extraParams,
}: {
  months: string[];
  selectedMonth: string;
  selectedAccountId?: string;
  activeTab: string;
  extraParams?: Record<string, string | undefined>;
}) {
```

and inside the map, after the existing `params.set` calls:

```ts
        for (const [key, value] of Object.entries(extraParams ?? {})) {
          if (value) params.set(key, value);
        }
```

- [ ] **Step 3: `CardCarousel` extraParams**

In `components/dashboard/CardCarousel.tsx`, the `cardUrl` helper builds `new URLSearchParams({ tab: activeTab })` (around line 19). Add an `extraParams?: Record<string, string | undefined>` argument threaded from the component prop, and append the same loop as MonthChips before returning the URL. Also append the extra params to the "All accounts" link at line 43 (`/dashboard?tab=${activeTab}` becomes the same URLSearchParams pattern). Keep the existing behavior byte-identical when `extraParams` is empty.

- [ ] **Step 4: `OverviewTab` drill rendering**

In `components/dashboard/OverviewTab.tsx`:

New imports:

```ts
import Link from "next/link";
import { dashboardUrl, OTHER_CATEGORY_KEY } from "@/lib/drilldown";
import CategoryDrilldownPanel, { type DrillLinkParams } from "@/components/dashboard/CategoryDrilldownPanel";
import MerchantDrilldownPanel from "@/components/dashboard/MerchantDrilldownPanel";
```

New props:

```ts
  linkParams: DrillLinkParams;
  drillQuery: { category?: string; sub?: string; merchant?: string };
```

Donut items gain hrefs (replace the existing `donutItems`):

```ts
  const donutItems = foldTail(
    data.categoryBreakdown.map((c) => ({
      label: titleCase(c.category),
      amount: c.amount,
      href: dashboardUrl({ ...linkParams, category: c.category }),
    })),
    6,
    (amount) => ({
      label: "Other",
      amount,
      href: dashboardUrl({ ...linkParams, category: OTHER_CATEGORY_KEY }),
    }),
  );
  const showAllCategories = drillQuery.category === OTHER_CATEGORY_KEY;
  const maxCategory = Math.max(1, ...data.categoryBreakdown.map((c) => c.amount));
```

Replace the "Spending by category" panel with the drill-aware slot:

```tsx
        {data.drilldown?.kind === "category" ? (
          <CategoryDrilldownPanel drill={data.drilldown} linkParams={linkParams} month={data.selectedMonth} />
        ) : data.drilldown?.kind === "merchant" ? (
          <MerchantDrilldownPanel drill={data.drilldown} linkParams={linkParams} month={data.selectedMonth} />
        ) : showAllCategories ? (
          <Panel
            title="All categories"
            eyebrow="This month"
            action={
              <Link href={dashboardUrl(linkParams)} className="text-xs font-semibold text-accent hover:underline">
                Back to top 6
              </Link>
            }
          >
            <BarList
              items={data.categoryBreakdown.map((c) => ({
                label: titleCase(c.category),
                amount: c.amount,
                href: dashboardUrl({ ...linkParams, category: c.category }),
              }))}
              max={maxCategory}
            />
          </Panel>
        ) : (
          <Panel
            title="Spending by category"
            eyebrow="This month"
            action={<span className="text-xs font-bold text-muted">Total {formatCurrency(data.currentMonthExpenses)}</span>}
          >
            <DonutChart items={donutItems} centerLabel="spent" />
          </Panel>
        )}
```

(The full-category view is a single-color BarList, never a donut: the palette rule caps categorical hues at 6.)

Trend chart months become links (keep the active drill):

```tsx
          <TrendChart
            labels={monthLabels}
            links={data.monthlySpending.map((m) =>
              dashboardUrl({ ...linkParams, ...drillQuery, month: m.month }),
            )}
            series={[
              { name: "Spending", slot: 1, values: spendSeries },
              { name: "Income", slot: 2, values: incomeSeries },
            ]}
          />
```

Top merchants become links:

```tsx
          <BarList
            items={data.merchantBreakdown.map((m) => ({
              label: m.merchant,
              amount: m.amount,
              href: dashboardUrl({ ...linkParams, merchant: m.merchant }),
            }))}
            max={maxMerchant}
          />
```

Recurring stream rows: wrap each subscription row's outer `<div>` in a `Link` to `dashboardUrl({ ...linkParams, merchant: stream.merchant })` (same hover class, `block` display), keeping the inner layout unchanged.

- [ ] **Step 5: Verify**

Run: `npm run test:unit && npx tsc --noEmit`
Expected: PASS. If `tests/unit/dashboard-ui.test.ts` renders `OverviewTab`, its fixture calls now need the two new props; add `linkParams: { tab: "overview" }` and `drillQuery: {}` to those fixtures.

Then verify in the browser (`npm run dev`, sign in, dashboard):
- Click a donut slice -> URL gains `?category=...`, panel swaps to the drill view.
- Click a subcategory -> `sub=` appears; breadcrumb navigates back correctly.
- Click "Other" -> full ranked category list; "Back to top 6" restores the donut.
- Click a merchant bar -> merchant panel.
- Click a month on the trend chart -> month switches, drill preserved.
- Switch months via MonthChips with a drill active -> drill preserved.
- Switch tab -> drill dropped.

- [ ] **Step 6: Commit**

```bash
git add app/dashboard/page.tsx components/dashboard
git commit -m "feat: in-place category/merchant drill-down on the dashboard"
```

---

### Task 8: BreakdownsTab and CashflowTab drills

**Files:**
- Modify: `components/dashboard/BreakdownsTab.tsx`
- Modify: `components/dashboard/CashflowTab.tsx`
- Modify: `app/dashboard/page.tsx` (pass `linkParams` to both tabs, from Task 7 Step 1)

**Interfaces:**
- Consumes: `spendPerCard[].accountId` / `spendPerBank[].itemId` (Task 4), `BarList` `href` (Task 5), `DivergingColumns` `links` (Task 5), `dashboardUrl` (Task 1), `DrillLinkParams` (Task 6).

- [ ] **Step 1: `BreakdownsTab` links**

Replace `components/dashboard/BreakdownsTab.tsx`:

```tsx
import type { DashboardData } from "@/lib/dashboard";
import { dashboardUrl } from "@/lib/drilldown";
import { formatCurrency } from "@/lib/format";
import BarList from "@/components/dashboard/BarList";
import Panel from "@/components/ui/Panel";
import type { DrillLinkParams } from "@/components/dashboard/CategoryDrilldownPanel";

export default function BreakdownsTab({
  data,
  linkParams,
}: {
  data: DashboardData;
  linkParams: DrillLinkParams;
}) {
  const maxCard = Math.max(1, ...data.spendPerCard.map((i) => i.amount));
  const maxBank = Math.max(1, ...data.spendPerBank.map((i) => i.amount));

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Panel title="Spend by card" eyebrow={formatCurrency(data.currentMonthExpenses)}>
        <BarList
          items={data.spendPerCard.map((i) => ({
            label: i.name,
            amount: i.amount,
            href: dashboardUrl({ ...linkParams, accountId: i.accountId }),
          }))}
          max={maxCard}
        />
      </Panel>
      <Panel title="Spend by bank" eyebrow="This month">
        <BarList
          items={data.spendPerBank.map((i) => ({
            label: i.name,
            amount: i.amount,
            href: i.itemId ? dashboardUrl({ ...linkParams, itemId: i.itemId }) : undefined,
          }))}
          max={maxBank}
        />
      </Panel>
    </div>
  );
}
```

- [ ] **Step 2: `CashflowTab` links**

In `components/dashboard/CashflowTab.tsx`:

Add props + imports:

```tsx
import Link from "next/link";
import { dashboardUrl } from "@/lib/drilldown";
import type { DrillLinkParams } from "@/components/dashboard/CategoryDrilldownPanel";

export default function CashflowTab({
  data,
  linkParams,
}: {
  data: DashboardData;
  linkParams: DrillLinkParams;
}) {
```

Deposits/withdrawals tiles link to the ledger (wrap each amount `<p>` in a `Link`; the ledger `flow`/`accountType` filters land in Task 9):

```tsx
        <Panel title="Deposits">
          <Link
            href={`/transactions?month=${data.selectedMonth}&flow=in&accountType=depository`}
            className="block rounded-field hover:bg-panel-hover"
          >
            <p className="display text-3xl text-success">{formatCurrency(data.cashFlow.deposits)}</p>
          </Link>
        </Panel>
        <Panel title="Withdrawals">
          <Link
            href={`/transactions?month=${data.selectedMonth}&flow=out&accountType=depository`}
            className="block rounded-field hover:bg-panel-hover"
          >
            <p className="display text-3xl text-danger">{formatCurrency(data.cashFlow.withdrawals)}</p>
          </Link>
        </Panel>
```

Cash-flow columns get month links:

```tsx
        <DivergingColumns
          labels={data.monthlyCashFlow.map((m) => formatMonth(m.month))}
          links={data.monthlyCashFlow.map((m) => dashboardUrl({ ...linkParams, month: m.month }))}
          up={data.monthlyCashFlow.map((m) => m.deposits)}
          down={data.monthlyCashFlow.map((m) => m.withdrawals)}
          upName="Deposits"
          downName="Withdrawals"
        />
```

- [ ] **Step 3: Pass `linkParams` from the page**

In `app/dashboard/page.tsx` (deferred lines from Task 7):

```tsx
          {activeTab === "breakdowns" && <BreakdownsTab data={data} linkParams={linkParams} />}
          {activeTab === "cashflow" && <CashflowTab data={data} linkParams={linkParams} />}
```

- [ ] **Step 4: Verify**

Run: `npm run test:unit && npx tsc --noEmit`
Expected: PASS (fix any tab-component fixtures the same way as Task 7).

Browser check: card bar -> account-filtered dashboard; bank bar -> `?itemId=` filters every total to that bank; cash-flow column -> month switch; tiles -> ledger (filters 404-safe even before Task 9 since unknown params are ignored today).

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/BreakdownsTab.tsx components/dashboard/CashflowTab.tsx app/dashboard/page.tsx
git commit -m "feat: card/bank/cashflow drill links"
```

---

### Task 9: Transactions page exact filters + chips

**Files:**
- Modify: `app/transactions/page.tsx`
- Test: `tests/unit/transactions-ui.test.ts` (extend if it renders the page with searchParams; otherwise verify via browser + build)

**Interfaces:**
- Consumes: nothing new from earlier tasks (the URL contract only).
- Produces: `/transactions` accepts `category`, `sub`, `merchant`, `flow`, `accountType` searchParams; active filters render as removable chips.

- [ ] **Step 1: Parse and validate the new params**

Extend `PageProps`:

```ts
  searchParams: Promise<{
    month?: string;
    accountId?: string;
    q?: string;
    page?: string;
    category?: string;
    sub?: string;
    merchant?: string;
    flow?: string;
    accountType?: string;
  }>;
```

After the existing param reads, add strict validation (never pass raw input into PostgREST):

```ts
  const CATEGORY_RE = /^[A-Z][A-Z0-9_]*$/;
  const category = CATEGORY_RE.test(params.category ?? "") ? params.category! : "";
  const sub = CATEGORY_RE.test(params.sub ?? "") ? params.sub! : "";
  const merchant = sanitizeSearch(params.merchant ?? "");
  const flow = params.flow === "in" || params.flow === "out" ? params.flow : "";
  const accountType =
    params.accountType === "depository" || params.accountType === "credit"
      ? params.accountType
      : "";
```

- [ ] **Step 2: Reorder fetches so accounts are available before the query**

`accountType` filters by account ids, which requires the accounts list first. Replace the combined `Promise.all` with:

```ts
  const [{ data: accounts }, { data: merchantRules }] = await Promise.all([
    supabase.from("accounts").select("id, name, mask, type").order("name"),
    supabase
      .from("merchant_rules")
      .select("match_type, pattern, display_name, category, enabled")
      .order("created_at"),
  ]);
```

(note the added `type` column), then apply the new filters to `query` before running it:

```ts
  if (category) query = query.eq("pfc_primary", category);
  if (sub) query = query.eq("pfc_detailed", sub);
  if (merchant) {
    query = query.or(`merchant_name.ilike.${merchant},name.ilike.${merchant}`);
  }
  if (flow === "in") query = query.lt("amount", 0);
  if (flow === "out") query = query.gt("amount", 0);
  if (accountType) {
    const typedIds = (accounts ?? [])
      .filter((a) => a.type === accountType)
      .map((a) => a.id as string);
    query = query.in("account_id", typedIds.length ? typedIds : ["-"]);
  }

  const offset = (page - 1) * PAGE_SIZE;
  const { data: txns, count } = await query.range(offset, offset + PAGE_SIZE - 1);
```

Known gap (documented in the spec): these are SQL-level filters on stored `pfc_primary`/`pfc_detailed`; rows recategorized in-app by merchant rules can differ from the dashboard's rules-applied drill totals. Acceptable for v1.

- [ ] **Step 3: Carry the filters through paging and render chips**

Extend `pageLink`:

```ts
  const pageLink = (p: number) => {
    const parts = [`page=${p}`];
    if (month) parts.push(`month=${month}`);
    if (accountId) parts.push(`accountId=${accountId}`);
    if (params.q) parts.push(`q=${encodeURIComponent(params.q)}`);
    if (category) parts.push(`category=${category}`);
    if (sub) parts.push(`sub=${sub}`);
    if (merchant) parts.push(`merchant=${encodeURIComponent(merchant)}`);
    if (flow) parts.push(`flow=${flow}`);
    if (accountType) parts.push(`accountType=${accountType}`);
    return `/transactions?${parts.join("&")}`;
  };
```

Add a chips row after the filter `Panel` (before the count line). Each chip links to the same URL minus that one filter:

```tsx
        {(category || sub || merchant || flow || accountType) && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {(
              [
                ["category", category ? titleCase(category) : ""],
                ["sub", sub ? titleCase(sub) : ""],
                ["merchant", merchant],
                ["flow", flow === "in" ? "Money in" : flow === "out" ? "Money out" : ""],
                ["accountType", accountType ? titleCase(accountType) : ""],
              ] as const
            )
              .filter(([, label]) => label)
              .map(([key, label]) => {
                const remaining = new URLSearchParams();
                if (month) remaining.set("month", month);
                if (accountId) remaining.set("accountId", accountId);
                if (params.q) remaining.set("q", params.q);
                if (category && key !== "category") remaining.set("category", category);
                if (sub && key !== "sub" && key !== "category") remaining.set("sub", sub);
                if (merchant && key !== "merchant") remaining.set("merchant", merchant);
                if (flow && key !== "flow") remaining.set("flow", flow);
                if (accountType && key !== "accountType") remaining.set("accountType", accountType);
                return (
                  <ButtonLink key={key} href={`/transactions?${remaining.toString()}`} variant="ghost">
                    {label} ×
                  </ButtonLink>
                );
              })}
          </div>
        )}
```

(Removing `category` also removes `sub`: a sub filter without its category is meaningless.)

Also update the "Clear" button condition to include the new params:

```tsx
            {(month || accountId || params.q || category || sub || merchant || flow || accountType) && (
```

- [ ] **Step 4: Verify**

Run: `npm run test:unit && npx tsc --noEmit && npm run build`
Expected: PASS / clean build.

Browser check:
- `/transactions?month=2026-07&category=FOOD_AND_DRINK` shows only that category; chip removes it.
- `?flow=in&accountType=depository` shows only depository money-in rows.
- Dashboard drill panel's "View all in Ledger" lands on the exact filtered view.
- Pagination preserves all filters.

- [ ] **Step 5: Commit**

```bash
git add app/transactions/page.tsx tests/unit
git commit -m "feat: exact category/sub/merchant/flow filters and chips on the ledger"
```

---

### Task 10: Full verification + docs

**Files:**
- Modify: `docs/HANDOFF.md`
- Modify: `docs/TODO.md`

- [ ] **Step 1: Full check suite**

Run, in order, and confirm each is clean:

```bash
npm run test:unit
npx tsc --noEmit
npm run lint
npm run build
```

Expected: all PASS. Fix anything that surfaces before proceeding.

- [ ] **Step 2: End-to-end browser pass**

With `npm run dev` and the live Supabase data, walk the full drill story once:
donut slice -> subcategory -> merchant -> month switch (drill kept) -> Other expansion -> card/bank drills -> cashflow tiles -> ledger chips -> back-button all the way out. Confirm the un-drilled dashboard is visually unchanged from before the feature.

- [ ] **Step 3: Update docs**

- `docs/HANDOFF.md`: add a session note describing the drill-down feature, the URL contract table, and the known gap (ledger SQL filters vs rules-applied dashboard totals).
- `docs/TODO.md`: remove/check off any drill-down or "clickable charts" items; add follow-ups if any emerged (e.g. rules-aware ledger filtering).

- [ ] **Step 4: Commit**

```bash
git add docs/HANDOFF.md docs/TODO.md
git commit -m "docs: dashboard drill-down handoff notes"
```
