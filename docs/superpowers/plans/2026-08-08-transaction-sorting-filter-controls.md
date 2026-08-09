# Transaction Sorting and Filter Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add staged transaction filters and complete-result sorting by date, signed displayed amount, merchant, category, or account without hard browser reloads.

**Architecture:** Keep `app/transactions/page.tsx` as the authenticated server orchestrator, centralize URL parsing and serialization in a pure ledger-query module, and centralize displayed-value projection and comparison in a pure ledger-projection module.
Date and amount use Supabase ordering when rule-aware display filtering is not required, while merchant, category, account, and rule-aware paths use a complete lightweight projection fetched in bounded chunks before pagination.

**Tech Stack:** Next.js 16.2 App Router, React 19.2, TypeScript 6, Supabase PostgREST, Vitest 4, and Playwright 1.61.

## Global Constraints

- Scope only the Transactions page and its focused helpers, controls, tests, and documentation.
- Ship one pull request with reviewable commits for query semantics, projection and sorting, server integration, controls, and verification.
- Do not add a database migration or persist derived merchant, category, or account labels.
- Do not add a client-side data cache or a new test dependency.
- Keep merchant-rule semantics centralized through `applyMerchantRules`.
- Sort the complete filtered result before selecting the 50-row page.
- Treat displayed amount as `-plaidAmount`, where spending is negative and income is positive.
- Treat the ledger as USD-only and do not add exchange-rate conversion.
- Keep missing merchant, category, and account labels after populated values in both sort directions.
- Use date descending and transaction ID ascending as deterministic tie-breakers.
- Preserve repeated `col` parameters, filters, sorting, and column state across navigation.
- Saved views store filters plus non-default sorting, but do not store column visibility.
- Clear filters preserves sorting and column visibility.
- Apply through `router.push()` with a hard-coded `/transactions` path and encoded `URLSearchParams` values.
- Pass normalized serializable props from the Server Component to Client Components instead of calling `useSearchParams` in the controls.
- Keep current results visible during a route transition and disable repeated Apply actions while pending.
- Keep every trigger and action at least 44 pixels in both dimensions.
- Keep owner filters on every financial-data query in addition to RLS.
- Preserve privacy-blur hooks and the existing green-credit, neutral-debit presentation.
- Read the relevant Next.js 16 guides under `node_modules/next/dist/docs/` before changing navigation code.
- Use the current app popover pattern: a fixed backdrop button, Escape handling, explicit focus movement, and focus restoration.
- Do not touch `CHANGELOG.md` or any generated file.
- Do not add an agent name as a commit co-author.
- Use Vercel CLI 58.9.0 or newer if deployment verification requires the CLI.

## File Structure

### Create

- `lib/ledger-query.ts`: normalized ledger query types, parsing, serialization, patching, defaults, and saved-view parameters.
- `lib/ledger-projection.ts`: canonical displayed ledger rows, rule-aware filtering, sorting, and filter-option derivation.
- `lib/ledger-data.ts`: bounded chunk collection and database-order selection without UI concerns.
- `components/transactions/TransactionQueryControls.tsx`: staged Search, Date, Filters, applied chips, Clear filters, focus, and route transitions.
- `components/transactions/TransactionSortMenu.tsx`: the one shared staged Sort popover for desktop and mobile.
- `tests/unit/ledger-query.test.ts`: parser and URL-state coverage.
- `tests/unit/ledger-projection.test.ts`: displayed-value projection, filter options, and complete-result comparator coverage.
- `tests/unit/ledger-data.test.ts`: chunk failure and direct-order coverage.
- `tests/unit/transaction-query-controls-render.test.ts`: initial accessible markup and control-label coverage.
- `tests/e2e/transactions.spec.ts`: credentialed transaction sorting and filtering acceptance journey.

### Modify

- `lib/ledger-filter.ts`: delegate rule-aware display projection to `lib/ledger-projection.ts` while retaining the current public filter API.
- `app/transactions/page.tsx`: consume the normalized query, load facet projection rows, select the direct or projected page path, render errors, and pass controls serializable props.
- `components/transactions/TableToolbar.tsx`: render the shared Sort control beside Edit multiple and Columns.
- `tests/unit/ledger-filter.test.ts`: prove existing rule-aware filters still delegate correctly.
- `tests/unit/table-toolbar-render.test.ts`: prove Sort renders once for both responsive presentations.
- `tests/unit/transactions-ui.test.ts`: replace the obsolete native GET-form assertion with the staged-control contract.
- `docs/HANDOFF.md`: add a concise delivered-feature entry only after all verification gates pass.

---

### Task 1: Centralize the ledger query contract

**Files:**

- Create: `lib/ledger-query.ts`
- Create: `tests/unit/ledger-query.test.ts`
- Reuse: `lib/ledger-columns.ts`

**Interfaces:**

- Consumes: `LedgerColumn` and `parseLedgerColumns` from `lib/ledger-columns.ts`.
- Produces: `LedgerRawSearchParams`, `LedgerFilters`, `LedgerQueryState`, `LedgerSortField`, `LedgerSortDirection`, `LedgerQueryEntry`, `parseLedgerQuery`, `ledgerQueryEntries`, `ledgerHref`, `savedLedgerViewParams`, and `hasActiveLedgerFilters`.

- [ ] **Step 1: Create the feature branch from the approved design commit**

Run:

```bash
git switch -c feat/transaction-sorting-filters
git status --short --branch
```

Expected: branch `feat/transaction-sorting-filters`, the approved specification and implementation-plan commits ahead of `origin/main`, and no uncommitted files.

- [ ] **Step 2: Write failing query parser and serializer tests**

Create `tests/unit/ledger-query.test.ts` with explicit cases for defaults, allow-lists, sanitization, repeated columns, patch preservation, filter clearing, pagination reset, and saved views.

```ts
import { describe, expect, it } from "vitest";
import {
  hasActiveLedgerFilters,
  ledgerHref,
  ledgerQueryEntries,
  parseLedgerQuery,
  savedLedgerViewParams,
} from "@/lib/ledger-query";

describe("parseLedgerQuery", () => {
  it("defaults to Date newest first and page one", () => {
    const state = parseLedgerQuery({});
    expect(state.sort).toBe("date");
    expect(state.direction).toBe("desc");
    expect(state.page).toBe(1);
  });

  it("drops invalid enum, month, UUID, category, and page values", () => {
    const state = parseLedgerQuery({
      sort: "drop table",
      direction: "sideways",
      month: "2026-99",
      accountId: "not-a-uuid",
      category: "food;delete",
      flow: "sideways",
      accountType: "loan",
      page: "-9",
    });
    expect(state).toMatchObject({
      sort: "date",
      direction: "desc",
      month: "",
      accountId: "",
      category: "",
      flow: "",
      accountType: "",
      page: 1,
    });
  });

  it("preserves repeated visible columns", () => {
    const state = parseLedgerQuery({
      colsSubmitted: "1",
      col: ["category", "account"],
    });
    expect([...state.columns]).toEqual(["category", "account"]);
    expect(ledgerQueryEntries(state).filter(([key]) => key === "col")).toEqual([
      ["col", "category"],
      ["col", "account"],
    ]);
  });
});

describe("ledgerHref", () => {
  it("overlays staged values, resets page, and preserves repeated columns", () => {
    const state = parseLedgerQuery({
      page: "3",
      q: "coffee",
      sort: "merchant",
      direction: "asc",
      colsSubmitted: "1",
      col: ["category", "source"],
    });
    const href = ledgerHref(ledgerQueryEntries(state), {
      month: "2026-08",
      accountId: null,
    });
    const url = new URL(href, "https://fundflow.test");
    expect(url.pathname).toBe("/transactions");
    expect(url.searchParams.get("page")).toBeNull();
    expect(url.searchParams.get("q")).toBe("coffee");
    expect(url.searchParams.get("sort")).toBe("merchant");
    expect(url.searchParams.getAll("col")).toEqual(["category", "source"]);
  });

  it("clears filters without clearing sorting or columns", () => {
    const state = parseLedgerQuery({
      q: "coffee",
      month: "2026-08",
      sort: "amount",
      direction: "asc",
      colsSubmitted: "1",
      col: "account",
    });
    const href = ledgerHref(ledgerQueryEntries(state), {
      q: null,
      month: null,
      accountId: null,
      category: null,
      sub: null,
      merchant: null,
      flow: null,
      accountType: null,
    });
    const url = new URL(href, "https://fundflow.test");
    expect(url.searchParams.get("q")).toBeNull();
    expect(url.searchParams.get("month")).toBeNull();
    expect(url.searchParams.get("sort")).toBe("amount");
    expect(url.searchParams.get("direction")).toBe("asc");
    expect(url.searchParams.getAll("col")).toEqual(["account"]);
  });
});

describe("savedLedgerViewParams", () => {
  it("stores filters and non-default sorting but not columns or page", () => {
    const state = parseLedgerQuery({
      q: "rent",
      sort: "account",
      direction: "desc",
      page: "4",
      colsSubmitted: "1",
      col: "source",
    });
    expect(savedLedgerViewParams(state)).toEqual({
      q: "rent",
      sort: "account",
      direction: "desc",
    });
    expect(hasActiveLedgerFilters(state)).toBe(true);
  });
});
```

- [ ] **Step 3: Run the focused test and verify the red state**

Run:

```bash
npm run test:unit -- tests/unit/ledger-query.test.ts
```

Expected: FAIL because `@/lib/ledger-query` does not exist.

- [ ] **Step 4: Implement the normalized query module**

Create `lib/ledger-query.ts` with the following public contract and validation behavior.

```ts
import { parseLedgerColumns, type LedgerColumn } from "@/lib/ledger-columns";

export const LEDGER_SORT_FIELDS = ["date", "amount", "merchant", "category", "account"] as const;
export type LedgerSortField = (typeof LEDGER_SORT_FIELDS)[number];
export type LedgerSortDirection = "asc" | "desc";

export interface LedgerRawSearchParams {
  month?: string | string[];
  accountId?: string | string[];
  q?: string | string[];
  page?: string | string[];
  category?: string | string[];
  sub?: string | string[];
  merchant?: string | string[];
  flow?: string | string[];
  accountType?: string | string[];
  sort?: string | string[];
  direction?: string | string[];
  col?: string | string[];
  colsSubmitted?: string | string[];
}

export interface LedgerFilters {
  q: string;
  month: string;
  accountId: string;
  category: string;
  sub: string;
  merchant: string;
  flow: "" | "in" | "out";
  accountType: "" | "depository" | "credit";
}

export interface LedgerQueryState extends LedgerFilters {
  sort: LedgerSortField;
  direction: LedgerSortDirection;
  page: number;
  columns: Set<LedgerColumn>;
  columnsSubmitted: boolean;
}

export type LedgerQueryEntry = readonly [string, string];
export type LedgerQueryPatch = Record<string, string | readonly string[] | null | undefined>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CATEGORY_RE = /^[A-Z][A-Z0-9_]*$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const FILTER_KEYS = ["q", "month", "accountId", "category", "sub", "merchant", "flow", "accountType"] as const;

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export function sanitizeLedgerSearch(value: string): string {
  return value.replace(/[%_,()."\\]/g, " ").replace(/\s+/g, " ").trim();
}

export function parseLedgerQuery(raw: LedgerRawSearchParams): LedgerQueryState {
  const sortValue = first(raw.sort);
  const directionValue = first(raw.direction);
  const monthValue = first(raw.month);
  const accountValue = first(raw.accountId);
  const categoryValue = first(raw.category);
  const subValue = first(raw.sub);
  const flowValue = first(raw.flow);
  const accountTypeValue = first(raw.accountType);
  return {
    q: sanitizeLedgerSearch(first(raw.q)),
    month: MONTH_RE.test(monthValue) ? monthValue : "",
    accountId: UUID_RE.test(accountValue) ? accountValue : "",
    category: CATEGORY_RE.test(categoryValue) ? categoryValue : "",
    sub: CATEGORY_RE.test(subValue) ? subValue : "",
    merchant: sanitizeLedgerSearch(first(raw.merchant)),
    flow: flowValue === "in" || flowValue === "out" ? flowValue : "",
    accountType:
      accountTypeValue === "depository" || accountTypeValue === "credit"
        ? accountTypeValue
        : "",
    sort: LEDGER_SORT_FIELDS.includes(sortValue as LedgerSortField)
      ? (sortValue as LedgerSortField)
      : "date",
    direction: directionValue === "asc" || directionValue === "desc" ? directionValue : "desc",
    page: Math.max(1, Number.parseInt(first(raw.page), 10) || 1),
    columns: parseLedgerColumns({ col: raw.col, colsSubmitted: raw.colsSubmitted }),
    columnsSubmitted: Boolean(first(raw.colsSubmitted)),
  };
}
```

Implement `ledgerQueryEntries` so it omits empty filters, page one, default `date/desc`, and default column state while preserving explicit all-hidden columns through `colsSubmitted=1`.
Implement `ledgerHref` by constructing `new URLSearchParams(entries)`, deleting each patched key before appending its replacement values, deleting `page` by default, and returning only a hard-coded `/transactions` path plus the encoded query.
Implement `savedLedgerViewParams` from the eight filter keys plus non-default sort and direction.
Implement `hasActiveLedgerFilters` by checking only the eight filter keys.

- [ ] **Step 5: Run query tests and the existing column tests**

Run:

```bash
npm run test:unit -- tests/unit/ledger-query.test.ts tests/unit/ledger-columns.test.ts
```

Expected: both files PASS.

- [ ] **Step 6: Commit the query contract**

```bash
git add lib/ledger-query.ts tests/unit/ledger-query.test.ts
git commit -m "feat(transactions): centralize ledger query state"
```

### Task 2: Project displayed rows, rule-aware filters, sort comparators, and filter options

**Files:**

- Create: `lib/ledger-projection.ts`
- Create: `tests/unit/ledger-projection.test.ts`
- Modify: `lib/ledger-filter.ts`
- Modify: `tests/unit/ledger-filter.test.ts`

**Interfaces:**

- Consumes: `MerchantRule` and `applyMerchantRules` from `lib/planning.ts`, plus `LedgerSortField` and `LedgerSortDirection` from Task 1.
- Produces: `LedgerProjectionSourceRow`, `LedgerProjectedRow`, `LedgerFilterOptions`, `projectLedgerRows`, `filterProjectedLedgerRows`, `sortLedgerRows`, `buildLedgerFilterOptions`, and `resolvedLedgerAccountId`.

- [ ] **Step 1: Write failing projection and sorting tests**

Create `tests/unit/ledger-projection.test.ts` with fixtures that make stored and displayed values disagree.

```ts
import { describe, expect, it } from "vitest";
import {
  buildLedgerFilterOptions,
  filterProjectedLedgerRows,
  projectLedgerRows,
  sortLedgerRows,
  type LedgerProjectionSourceRow,
} from "@/lib/ledger-projection";
import type { MerchantRule } from "@/lib/planning";

const accounts = new Map([
  ["a-checking", "Everyday Checking ••1234"],
  ["z-card", "Travel Card ••9876"],
]);
const rules: MerchantRule[] = [{
  matchType: "keyword",
  pattern: "sq *bluebottle",
  displayName: "Blue Bottle",
  category: "FOOD_AND_DRINK",
  enabled: true,
}];

function row(input: Partial<LedgerProjectionSourceRow> & Pick<LedgerProjectionSourceRow, "id">): LedgerProjectionSourceRow {
  return {
    id: input.id,
    date: input.date ?? "2026-08-01",
    amount: input.amount ?? 10,
    merchant_name: input.merchant_name ?? null,
    name: input.name ?? null,
    pfc_primary: input.pfc_primary ?? null,
    pfc_detailed: input.pfc_detailed ?? null,
    account_id: input.account_id ?? "a-checking",
    manual_account_id: input.manual_account_id ?? null,
    iso_currency_code: "USD",
    pending: false,
  };
}

describe("projectLedgerRows", () => {
  it("uses rule-adjusted merchant and category plus manual account labels", () => {
    const projected = projectLedgerRows([
      row({ id: "1", merchant_name: "SQ *BlueBottle Coffee", pfc_primary: "GENERAL_MERCHANDISE" }),
      row({ id: "2", account_id: null, manual_account_id: "manual", name: "Cash purchase" }),
    ], rules, new Map([...accounts, ["manual", "Cash Wallet"]]));
    expect(projected[0]).toMatchObject({ merchant: "Blue Bottle", category: "FOOD_AND_DRINK" });
    expect(projected[1]?.accountLabel).toBe("Cash Wallet");
  });
});

describe("sortLedgerRows", () => {
  const projected = projectLedgerRows([
    row({ id: "spend", date: "2026-08-03", amount: 100, merchant_name: "Zebra" }),
    row({ id: "income", date: "2026-08-02", amount: -500, merchant_name: "Alpha" }),
    row({ id: "tie-b", date: "2026-08-01", amount: 25, merchant_name: "Same" }),
    row({ id: "tie-a", date: "2026-08-01", amount: 25, merchant_name: "Same" }),
    row({ id: "missing", date: "2026-08-04", amount: 1, merchant_name: null, name: null }),
  ], [], accounts);

  it("sorts signed displayed amount instead of stored Plaid amount", () => {
    expect(sortLedgerRows(projected, "amount", "asc").map((item) => item.id).slice(0, 2))
      .toEqual(["spend", "tie-a"]);
    expect(sortLedgerRows(projected, "amount", "desc")[0]?.id).toBe("income");
  });

  it("keeps missing labels last in both directions", () => {
    expect(sortLedgerRows(projected, "merchant", "asc").at(-1)?.id).toBe("missing");
    expect(sortLedgerRows(projected, "merchant", "desc").at(-1)?.id).toBe("missing");
  });

  it("uses date descending and id ascending for equal primary values", () => {
    const ids = sortLedgerRows(projected, "merchant", "asc").map((item) => item.id);
    expect(ids.indexOf("tie-a")).toBeLessThan(ids.indexOf("tie-b"));
  });
});

describe("filter options", () => {
  it("derives cleaned merchants and category-scoped subcategories", () => {
    const projected = projectLedgerRows([
      row({ id: "1", merchant_name: "SQ *BlueBottle Coffee", pfc_primary: "GENERAL_MERCHANDISE", pfc_detailed: "FOOD_AND_DRINK_COFFEE" }),
    ], rules, accounts);
    const options = buildLedgerFilterOptions(projected, [
      { value: "a-checking", label: "Everyday Checking ••1234" },
    ]);
    expect(options.merchants).toEqual(["Blue Bottle"]);
    expect(options.categories).toContainEqual({ value: "FOOD_AND_DRINK", label: "Food And Drink" });
    expect(options.subcategoriesByCategory.FOOD_AND_DRINK).toContainEqual({
      value: "FOOD_AND_DRINK_COFFEE",
      label: "Coffee",
    });
  });
});

describe("filterProjectedLedgerRows", () => {
  it("matches committed category, subcategory, and merchant on projected values", () => {
    const projected = projectLedgerRows([
      row({ id: "1", merchant_name: "SQ *BlueBottle Coffee", pfc_primary: "GENERAL_MERCHANDISE", pfc_detailed: "FOOD_AND_DRINK_COFFEE" }),
      row({ id: "2", merchant_name: "Safeway", pfc_primary: "FOOD_AND_DRINK", pfc_detailed: "FOOD_AND_DRINK_GROCERIES" }),
    ], rules, accounts);
    expect(filterProjectedLedgerRows(projected, {
      category: "FOOD_AND_DRINK",
      sub: "FOOD_AND_DRINK_COFFEE",
      merchant: "Blue Bottle",
    }).map((item) => item.id)).toEqual(["1"]);
  });
});
```

- [ ] **Step 2: Run the focused test and verify the red state**

Run:

```bash
npm run test:unit -- tests/unit/ledger-projection.test.ts
```

Expected: FAIL because `@/lib/ledger-projection` does not exist.

- [ ] **Step 3: Implement display projection and stable comparison**

Create `lib/ledger-projection.ts` with these public shapes.

```ts
import { subcategoryLabel } from "@/lib/drilldown";
import { titleCase } from "@/lib/format";
import type { LedgerSortDirection, LedgerSortField } from "@/lib/ledger-query";
import { applyMerchantRules, type MerchantRule } from "@/lib/planning";

export interface LedgerProjectionSourceRow {
  id: string;
  date: string;
  amount: number;
  iso_currency_code: string | null;
  merchant_name: string | null;
  name: string | null;
  pfc_primary: string | null;
  pfc_detailed: string | null;
  pending: boolean;
  account_id: string | null;
  manual_account_id?: string | null;
  source?: "plaid" | "import" | "manual";
}

export interface LedgerProjectedRow extends LedgerProjectionSourceRow {
  merchant: string;
  category: string | null;
  accountLabel: string;
  displayedAmount: number;
}

export interface LedgerFilterOptions {
  accounts: Array<{ value: string; label: string }>;
  categories: Array<{ value: string; label: string }>;
  subcategoriesByCategory: Record<string, Array<{ value: string; label: string }>>;
  merchants: string[];
}

export function resolvedLedgerAccountId(row: Pick<LedgerProjectionSourceRow, "account_id" | "manual_account_id">): string {
  return row.account_id ?? row.manual_account_id ?? "";
}
```

Implement `projectLedgerRows` with one call to `applyMerchantRules`, returning cleaned `merchant`, cleaned `category`, resolved `accountLabel`, and `displayedAmount: -row.amount` while retaining raw row fields.
Implement `filterProjectedLedgerRows` as exact case-insensitive merchant matching, exact category matching with `UNCATEGORIZED` as the null sentinel, and exact raw `pfc_detailed` matching.
Implement `sortLedgerRows` with `toSorted`, missing-value placement before the direction multiplier, `Intl.Collator(undefined, { sensitivity: "base", numeric: true })` for labels, and final `b.date.localeCompare(a.date) || a.id.localeCompare(b.id)` tie-breaking.
Implement `buildLedgerFilterOptions` with de-duplicated sorted values, `titleCase` primary labels, and `subcategoryLabel(category, sub)` detailed labels.

- [ ] **Step 4: Refactor the existing rule-aware filter to delegate projection**

Keep `hasRemapRules` unchanged.
Replace the private projection code in `lib/ledger-filter.ts` with `projectLedgerRows` and `filterProjectedLedgerRows`, then map selected projected IDs back to the original generic rows in original order.

```ts
const projected = projectLedgerRows(rows, rules, accountNamesById);
const selected = new Set(
  filterProjectedLedgerRows(projected, {
    category: filter.category,
    merchant: filter.merchant,
  }).map((row) => row.id),
);
return rows.filter((row) => selected.has(row.id));
```

Add one regression case to `tests/unit/ledger-filter.test.ts` proving row order remains unchanged after delegation.

- [ ] **Step 5: Run projection and existing rule tests**

Run:

```bash
npm run test:unit -- tests/unit/ledger-projection.test.ts tests/unit/ledger-filter.test.ts
```

Expected: both files PASS.

- [ ] **Step 6: Commit projection semantics**

```bash
git add lib/ledger-projection.ts lib/ledger-filter.ts tests/unit/ledger-projection.test.ts tests/unit/ledger-filter.test.ts
git commit -m "feat(transactions): add rule-aware ledger sorting"
```

### Task 3: Add bounded chunk loading and integrate complete-result pagination

**Files:**

- Create: `lib/ledger-data.ts`
- Create: `tests/unit/ledger-data.test.ts`
- Modify: `app/transactions/page.tsx`
- Modify: `tests/unit/transactions-ui.test.ts`

**Interfaces:**

- Consumes: `LedgerQueryState`, `LedgerProjectionSourceRow`, `projectLedgerRows`, `filterProjectedLedgerRows`, `sortLedgerRows`, `buildLedgerFilterOptions`, and existing Supabase clients.
- Produces: `collectLedgerChunks`, `ledgerDatabaseOrder`, and a page that returns a complete, correctly ordered `LedgerProjectedRow[]` slice plus filter options or an actionable error.

- [ ] **Step 1: Write failing chunk and database-order tests**

Create `tests/unit/ledger-data.test.ts`.

```ts
import { describe, expect, it, vi } from "vitest";
import { collectLedgerChunks, ledgerDatabaseOrder } from "@/lib/ledger-data";

describe("collectLedgerChunks", () => {
  it("collects until the first short chunk", async () => {
    const load = vi.fn()
      .mockResolvedValueOnce({ rows: [1, 2], error: null })
      .mockResolvedValueOnce({ rows: [3], error: null });
    await expect(collectLedgerChunks(load, 2)).resolves.toEqual([1, 2, 3]);
    expect(load.mock.calls).toEqual([[0, 1], [2, 3]]);
  });

  it("throws instead of returning a partial result", async () => {
    const load = vi.fn()
      .mockResolvedValueOnce({ rows: [1, 2], error: null })
      .mockResolvedValueOnce({ rows: [], error: { code: "query_failed" } });
    await expect(collectLedgerChunks(load, 2)).rejects.toThrow("query_failed");
  });
});

describe("ledgerDatabaseOrder", () => {
  it("maps displayed amount direction to the inverse stored Plaid direction", () => {
    expect(ledgerDatabaseOrder("amount", "asc")).toEqual([
      { column: "amount", ascending: false },
      { column: "date", ascending: false },
      { column: "id", ascending: true },
    ]);
    expect(ledgerDatabaseOrder("amount", "desc")[0]).toEqual({
      column: "amount",
      ascending: true,
    });
  });
});
```

- [ ] **Step 2: Run the focused test and verify the red state**

Run:

```bash
npm run test:unit -- tests/unit/ledger-data.test.ts
```

Expected: FAIL because `@/lib/ledger-data` does not exist.

- [ ] **Step 3: Implement bounded chunk collection and order selection**

Create `lib/ledger-data.ts`.

```ts
import type { LedgerSortDirection, LedgerSortField } from "@/lib/ledger-query";

export interface LedgerChunkResult<T> {
  rows: T[];
  error: { code?: string; message?: string } | null;
}

export async function collectLedgerChunks<T>(
  load: (from: number, to: number) => Promise<LedgerChunkResult<T>>,
  chunkSize = 1000,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += chunkSize) {
    const result = await load(from, from + chunkSize - 1);
    if (result.error) throw new Error(result.error.code || "ledger_query_failed");
    rows.push(...result.rows);
    if (result.rows.length < chunkSize) return rows;
  }
}

export function ledgerDatabaseOrder(
  sort: Extract<LedgerSortField, "date" | "amount">,
  direction: LedgerSortDirection,
): Array<{ column: "date" | "amount" | "id"; ascending: boolean }> {
  if (sort === "amount") {
    return [
      { column: "amount", ascending: direction === "desc" },
      { column: "date", ascending: false },
      { column: "id", ascending: true },
    ];
  }
  return [
    { column: "date", ascending: direction === "asc" },
    { column: "id", ascending: true },
  ];
}
```

- [ ] **Step 4: Replace page-local parsing with `parseLedgerQuery`**

In `app/transactions/page.tsx`, change `PageProps.searchParams` to `Promise<LedgerRawSearchParams>`, call `parseLedgerQuery`, and replace local `CATEGORY_RE`, `UUID_RE`, `sanitizeSearch`, page parsing, and visible-column parsing with fields from the normalized state.
Keep `monthBounds` local because it is date-query behavior rather than URL parsing.

- [ ] **Step 5: Load the facet projection in complete chunks**

After owner-scoped accounts and merchant rules load, build one lightweight transaction query that applies owner ID, month, account, free search, flow, and account type but deliberately leaves category, subcategory, and merchant for the projected facet layer.
Retain the Supabase result objects for accounts, manual accounts, and merchant rules, and enter the same ledger error state if any of those three prerequisite reads returns an error.
Order every chunk by date descending and ID ascending before applying `.range(from, to)`.
Select the current base columns plus `pfc_detailed`, and include `manual_account_id` and `source` only when `transactionsParity` is enabled.

Use this exact failure boundary:

```ts
let projectedScope: LedgerProjectedRow[] = [];
let ledgerError: string | null = null;
try {
  const sourceRows = await collectLedgerChunks<LedgerProjectionSourceRow>(async (from, to) => {
    const result = await buildFacetQuery(from, to);
    return {
      rows: (result.data ?? []) as unknown as LedgerProjectionSourceRow[],
      error: result.error ? { code: result.error.code } : null,
    };
  });
  projectedScope = projectLedgerRows(sourceRows, rulesList, accountName);
} catch (error) {
  console.error("Transaction ledger projection failed", {
    code: error instanceof Error ? error.message : "unknown",
  });
  ledgerError = "Transactions could not be loaded. Change or clear the filters and try again.";
}
```

Do not log query text, search terms, merchant names, account labels, or row data.

- [ ] **Step 6: Select the direct or projected page path**

Build `filterOptions` from the successfully projected facet scope.
Set `needsProjectedPage` when sort is merchant, category, or account, or when any category or merchant filter must run after a remap rule.

For the projected path:

```ts
const filtered = filterProjectedLedgerRows(projectedScope, {
  category: state.category,
  sub: state.sub,
  merchant: state.merchant,
});
const ordered = sortLedgerRows(filtered, state.sort, state.direction);
total = ordered.length;
rows = ordered.slice(offset, offset + PAGE_SIZE);
```

For the direct path, keep Supabase count and range pagination, apply category, subcategory, and merchant SQL filters, and apply every entry from `ledgerDatabaseOrder` in order.
Convert direct raw rows through `projectLedgerRows` so both paths render the same `merchant`, `category`, `accountLabel`, and `displayedAmount` fields.
Check `pageResult.error` before treating a missing `data` array as an empty ledger.
After visible IDs are known, check annotation and split query errors before rendering enriched rows so notes, tags, or split categories never disappear behind a partial-success response.

- [ ] **Step 7: Render controls even when results fail and distinguish empty states**

Render the query controls before the result state.
When `ledgerError` is set, render an error-toned Panel with the exact copy from Step 5 and do not render a false zero-result count.
When `total === 0`, use `hasActiveLedgerFilters(state)` to choose between `No transactions yet` and `No transactions match these filters`.

- [ ] **Step 8: Update the source-contract test**

Replace the obsolete native GET-form expectations in `tests/unit/transactions-ui.test.ts` with assertions that the page imports and renders `TransactionQueryControls`, uses `parseLedgerQuery`, checks `pageResult.error`, and retains `TableToolbar`, privacy hooks, and the current amount color classes.
Keep this test limited to composition boundaries and leave data semantics in the new pure tests.

- [ ] **Step 9: Run server integration tests**

Run:

```bash
npm run test:unit -- tests/unit/ledger-data.test.ts tests/unit/ledger-query.test.ts tests/unit/ledger-projection.test.ts tests/unit/ledger-filter.test.ts tests/unit/transactions-ui.test.ts
npm run typecheck
```

Expected: all focused tests PASS and TypeScript reports no errors.

- [ ] **Step 10: Commit complete-result data loading**

```bash
git add lib/ledger-data.ts app/transactions/page.tsx tests/unit/ledger-data.test.ts tests/unit/transactions-ui.test.ts
git commit -m "feat(transactions): paginate complete sorted results"
```

### Task 4: Build staged Search, Date, Filters, chips, and Clear filters

**Files:**

- Create: `components/transactions/TransactionQueryControls.tsx`
- Create: `tests/unit/transaction-query-controls-render.test.ts`
- Modify: `app/transactions/page.tsx`

**Interfaces:**

- Consumes: `LedgerFilters`, `LedgerFilterOptions`, `LedgerQueryEntry`, `ledgerHref`, `ledgerQueryEntries`, `savedLedgerViewParams`, and normalized committed server props.
- Produces: `TransactionQueryControls` with serializable `committed`, `entries`, and `options` props.

- [ ] **Step 1: Write the failing static render test**

Create `tests/unit/transaction-query-controls-render.test.ts` using the repository's existing `renderToStaticMarkup` pattern and a `next/navigation` mock.

```ts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import TransactionQueryControls from "@/components/transactions/TransactionQueryControls";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const committed = {
  q: "coffee",
  month: "2026-08",
  accountId: "",
  category: "FOOD_AND_DRINK",
  sub: "",
  merchant: "",
  flow: "out" as const,
  accountType: "",
};

describe("TransactionQueryControls", () => {
  it("renders one Search field plus Date and Filters popovers with committed chips", () => {
    const html = renderToStaticMarkup(createElement(TransactionQueryControls, {
      committed,
      entries: [["q", "coffee"], ["month", "2026-08"], ["category", "FOOD_AND_DRINK"], ["flow", "out"]],
      options: {
        accounts: [{ value: "account", label: "Checking ••1234" }],
        categories: [{ value: "FOOD_AND_DRINK", label: "Food And Drink" }],
        subcategoriesByCategory: { FOOD_AND_DRINK: [{ value: "FOOD_AND_DRINK_COFFEE", label: "Coffee" }] },
        merchants: ["Blue Bottle"],
      },
    }));
    expect(html).toContain('aria-label="Search transactions"');
    expect(html).toContain("Date: Aug 2026");
    expect(html).toContain("Filters (2)");
    expect(html).toContain('aria-label="Remove category filter Food And Drink"');
    expect(html).toContain("Clear filters");
    expect(html).toContain("min-h-11");
  });
});
```

- [ ] **Step 2: Run the focused test and verify the red state**

Run:

```bash
npm run test:unit -- tests/unit/transaction-query-controls-render.test.ts
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the serializable staged-control props**

Create `components/transactions/TransactionQueryControls.tsx` as a Client Component.

```ts
export interface TransactionQueryControlsProps {
  committed: LedgerFilters;
  entries: LedgerQueryEntry[];
  options: LedgerFilterOptions;
}
```

Use `useRouter`, `useState`, `useEffect`, `useRef`, and `useTransition`.
Keep `open` as `"none" | "date" | "filters"`, keep independent staged copies of the eight filters, and synchronize those drafts from `committed` after successful Back, Forward, or Apply navigation.

Use this one navigation boundary for Search, Apply, chip removal, and Clear filters:

```ts
function navigate(patch: LedgerQueryPatch) {
  const href = ledgerHref(entries, patch);
  startTransition(() => router.push(href, { scroll: false }));
}
```

Because `ledgerHref` always returns the hard-coded `/transactions` path and encodes values with `URLSearchParams`, no untrusted href reaches `router.push`.

- [ ] **Step 4: Implement Search and Date**

Keep Search visible with `type="search"`, `aria-label="Search transactions"`, a Search button, and a form submit handler that calls `navigate({ q: search.trim() || null })`.
Date uses an `Input type="month"`, stages its value, and applies through `navigate({ month: stagedMonth || null })`.
The Date trigger reads `Date` when empty and `Date: ${formatMonth(month)}` when committed.

- [ ] **Step 5: Implement the Filters popover**

Render account, category, subcategory, merchant, flow, and account-type controls.
Use Select for account, category, subcategory, flow, and account type.
Use an Input with a datalist for the searchable merchant combobox.
Reset staged subcategory to empty when the staged category changes to a value that does not own the current subcategory option.
The Filters trigger count excludes search and date and includes the six popover filters.
Apply all six values in one `ledgerHref` patch and close the popover before starting navigation.

- [ ] **Step 6: Implement popover dismissal and focus**

Follow the existing fixed-backdrop pattern.
On open, move focus to the first field through a ref.
On Escape, restore the committed draft values, close without navigation, and return focus to the trigger.
On backdrop click, perform the same cancel behavior.
Set `aria-haspopup="dialog"`, `aria-expanded`, `role="dialog"`, a descriptive `aria-label`, and `aria-busy={isPending}`.

- [ ] **Step 7: Implement committed chips and Clear filters**

Render chips for all eight filter fields with descriptive removal names.
Use option labels for account, category, subcategory, flow, and account type.
Use `formatMonth` for the month chip.
Removing category also removes subcategory because a detailed category without its parent is invalid UI state.
Clear filters sends null for all eight filter keys and relies on `ledgerHref` to preserve sorting and columns.

- [ ] **Step 8: Wire controls and saved-view params from the page**

In `app/transactions/page.tsx`, pass only serializable values:

```tsx
<TransactionQueryControls
  committed={{
    q: state.q,
    month: state.month,
    accountId: state.accountId,
    category: state.category,
    sub: state.sub,
    merchant: state.merchant,
    flow: state.flow,
    accountType: state.accountType,
  }}
  entries={ledgerQueryEntries(state)}
  options={filterOptions}
/>
```

Remove the old always-open GET filter form and the separately rendered drill-down chips.
Pass `savedLedgerViewParams(state)` to `SavedViewsBar.currentParams` so sort and direction persist with saved views.
No mutation is required inside `SavedViewsBar` because its stored value and link builder already accept arbitrary string parameters.

- [ ] **Step 9: Run focused render, URL, and saved-view tests**

Run:

```bash
npm run test:unit -- tests/unit/transaction-query-controls-render.test.ts tests/unit/ledger-query.test.ts tests/unit/transactions-ui.test.ts
npm run typecheck
```

Expected: all focused tests PASS and TypeScript reports no errors.

- [ ] **Step 10: Commit staged filters**

```bash
git add components/transactions/TransactionQueryControls.tsx app/transactions/page.tsx tests/unit/transaction-query-controls-render.test.ts tests/unit/transactions-ui.test.ts
git commit -m "feat(transactions): add staged filter controls"
```

### Task 5: Add the one shared Sort popover and preserve state across toolbar and pagination

**Files:**

- Create: `components/transactions/TransactionSortMenu.tsx`
- Create: `tests/unit/transaction-sort-menu-render.test.ts`
- Modify: `components/transactions/TableToolbar.tsx`
- Modify: `app/transactions/page.tsx`
- Modify: `tests/unit/table-toolbar-render.test.ts`

**Interfaces:**

- Consumes: `LedgerSortField`, `LedgerSortDirection`, `LedgerQueryEntry`, and `ledgerHref`.
- Produces: `TransactionSortMenu` with `sort`, `direction`, and `entries` props, plus `TableToolbar.sortMenu`.

- [ ] **Step 1: Extend the failing toolbar render test**

Update `tests/unit/table-toolbar-render.test.ts` so the primary case passes a marker Sort node and asserts it renders exactly once while Edit multiple and Columns remain collapsed.

```ts
const html = renderToStaticMarkup(
  createElement(TableToolbar, {
    bulkTagBar: createElement("div", null, "BULK_TAG_BAR_CONTENT"),
    sortMenu: createElement("button", null, "SORT_MENU_CONTENT"),
    columnsMenu: createElement("div", null, "COLUMNS_MENU_CONTENT"),
  }),
);
expect(html.match(/SORT_MENU_CONTENT/g)).toHaveLength(1);
```

Create `tests/unit/transaction-sort-menu-render.test.ts` with the same `next/navigation` mock pattern and assert `Sort: Date, newest first`, `aria-expanded="false"`, and the 44-pixel trigger class.

- [ ] **Step 2: Run the toolbar test and verify the red state**

Run:

```bash
npm run test:unit -- tests/unit/table-toolbar-render.test.ts
```

Expected: FAIL because `TableToolbar` has no `sortMenu` prop and `TransactionSortMenu` does not exist.

- [ ] **Step 3: Implement the shared Sort popover**

Create `components/transactions/TransactionSortMenu.tsx` as a Client Component with this public contract.

```ts
export interface TransactionSortMenuProps {
  sort: LedgerSortField;
  direction: LedgerSortDirection;
  entries: LedgerQueryEntry[];
}
```

Use one field Select with Date, Amount, Merchant, Category, and Account.
Use one direction Select whose labels are `Oldest first` and `Newest first` for Date, `Low to high` and `High to low` for Amount, and `A to Z` and `Z to A` for label fields.
Keep staged values local until Apply.
On Apply, call `ledgerHref(entries, { sort: stagedSort, direction: stagedDirection })` inside `startTransition(() => router.push(href, { scroll: false }))`.
Implement the same backdrop, Escape cancellation, first-field focus, trigger-focus restoration, pending state, and 44-pixel target behavior as the Filters control.

- [ ] **Step 4: Render Sort once in the shared toolbar**

Add `sortMenu: React.ReactNode` to `TableToolbar` and place it between Edit multiple and Columns.
Do not clone it into the mobile list or desktop table because the toolbar already renders above both responsive twins.

```tsx
<TableToolbar
  bulkTagBar={<BulkTagBar transactionIds={rows.map((row) => row.id)} />}
  sortMenu={(
    <TransactionSortMenu
      sort={state.sort}
      direction={state.direction}
      entries={ledgerQueryEntries(state)}
    />
  )}
  columnsMenu={columnsMenu}
/>
```

- [ ] **Step 5: Preserve complete query state through columns and pagination**

Build `ColumnsMenu.otherParams` from `ledgerQueryEntries(state)` after removing `col`, `colsSubmitted`, and `page`, preserving `sort` and `direction`.
Replace the manual `pageLink` builder with `ledgerHref(ledgerQueryEntries(state), { page: String(targetPage) }, { resetPage: false })`.
Extend `ledgerHref` with an optional `{ resetPage?: boolean }` argument defaulting to true and add the corresponding unit test before using it.
Change pagination button copy from Newer and Older to Previous and Next when the primary sort is not Date because chronological labels become false under merchant, category, account, or amount order.

- [ ] **Step 6: Run toolbar, query, and page tests**

Run:

```bash
npm run test:unit -- tests/unit/table-toolbar-render.test.ts tests/unit/transaction-sort-menu-render.test.ts tests/unit/transaction-query-controls-render.test.ts tests/unit/ledger-query.test.ts tests/unit/transactions-ui.test.ts
npm run typecheck
```

Expected: all focused tests PASS and TypeScript reports no errors.

- [ ] **Step 7: Commit shared sorting controls**

```bash
git add components/transactions/TransactionSortMenu.tsx components/transactions/TableToolbar.tsx app/transactions/page.tsx tests/unit/table-toolbar-render.test.ts tests/unit/transaction-sort-menu-render.test.ts tests/unit/ledger-query.test.ts
git commit -m "feat(transactions): add shared sort control"
```

### Task 6: Add credentialed browser acceptance and complete the verification gate

**Files:**

- Create: `tests/e2e/transactions.spec.ts`
- Modify: `docs/HANDOFF.md`

**Interfaces:**

- Consumes: the complete URL, control, sorting, saved-view, focus, responsive, and error behavior from Tasks 1 through 5.
- Produces: a deterministic throwaway-user browser journey and final delivery evidence.

- [ ] **Step 1: Create a deterministic credentialed transaction fixture**

Model `tests/e2e/transactions.spec.ts` on the existing serial Supabase setup in `tests/e2e/recurring.spec.ts`.
Create a throwaway confirmed user, one Plaid item, two USD accounts named `Alpha Checking` and `Zebra Card`, 55 transactions spanning two months, and one enabled merchant rule that renames `SQ *BlueBottle` to `Blue Bottle` and recategorizes it to `FOOD_AND_DRINK`.
Use transaction IDs and merchant names containing the test timestamp so cleanup through `auth.admin.deleteUser(userId)` removes all owned rows.
Skip the entire describe block unless public URL, publishable key, and secret key are present.

- [ ] **Step 2: Prove staged filters and client navigation**

Add a test that signs in through the real login UI, opens `/transactions`, sets a marker on `window`, stages account, category, and Money out values, and asserts the URL remains unchanged before Apply.
After Apply, assert the expected parameters, matching rows, active chips, and marker preservation.

```ts
await page.evaluate(() => {
  (window as typeof window & { __fundflowLedgerMarker?: string }).__fundflowLedgerMarker = "preserved";
});
await page.getByRole("button", { name: /^Filters/ }).click();
await page.getByLabel("Account").selectOption(alphaAccountId);
await page.getByLabel("Category").selectOption("FOOD_AND_DRINK");
await page.getByLabel("Money direction").selectOption("out");
await expect(page).not.toHaveURL(/accountId=/);
await page.getByRole("button", { name: "Apply filters" }).click();
await expect(page).toHaveURL(new RegExp(`accountId=${alphaAccountId}`));
expect(await page.evaluate(() => (window as typeof window & { __fundflowLedgerMarker?: string }).__fundflowLedgerMarker)).toBe("preserved");
```

- [ ] **Step 3: Prove complete-result sorting and rule-adjusted labels**

Use the Sort popover to test Date, Amount, Merchant, Category, and Account in both directions.
For the 55-row amount fixture, assert the first and second pages form one monotonic signed displayed sequence rather than two independently sorted pages.
For Merchant and Category, assert the renamed `Blue Bottle` row appears according to its displayed values rather than its stored `SQ *BlueBottle` and `GENERAL_MERCHANDISE` values.
For equal primary values, assert the date-descending and ID-ascending fixture order remains stable across reload and Back navigation.

- [ ] **Step 4: Prove saved views, Back and Forward, cancellation, and clear behavior**

Save a filtered `Merchant: A to Z` state through `Save this view`, clear filters, change sorting, and reopen the saved view.
Assert filters, sort, and direction restore while column state remains independent.
Open Filters, change a value, press Escape, and assert the URL and committed chip remain unchanged.
Use browser Back and Forward and assert controls and rows follow the restored URL.
Assert Clear filters keeps `sort`, `direction`, and repeated `col` parameters.

- [ ] **Step 5: Prove responsive and theme acceptance**

At 390 by 844, assert Search, Date, Filters, and the one Sort trigger are reachable, popovers stay within viewport width, no horizontal overflow appears, and trigger bounding boxes are at least 44 pixels high.
Repeat the primary control-open screenshots in light and dark themes and inspect focus rings, panel borders, menu placement, selected values, pending states, and chip wrapping.
Store Playwright artifacts only in the configured test-results directory and do not commit ad hoc screenshots.

- [ ] **Step 6: Run the focused unit gate**

Run:

```bash
npm run test:unit -- tests/unit/ledger-query.test.ts tests/unit/ledger-projection.test.ts tests/unit/ledger-data.test.ts tests/unit/ledger-filter.test.ts tests/unit/transaction-query-controls-render.test.ts tests/unit/transaction-sort-menu-render.test.ts tests/unit/table-toolbar-render.test.ts tests/unit/transactions-ui.test.ts
```

Expected: all focused unit tests PASS.

- [ ] **Step 7: Run the complete local code gate serially**

Run:

```bash
npm run lint
npm run typecheck
npm run test:unit
npm run build
git diff --check
```

Expected: every command exits zero.
Run build after typecheck rather than concurrently so `.next` generated types cannot produce a stale false failure.

- [ ] **Step 8: Run the targeted browser test**

Run:

```bash
npx playwright test tests/e2e/transactions.spec.ts --project=chromium
```

Expected: PASS when Supabase browser and service credentials are available, or an explicit credential skip that is reported as an incomplete browser gate.

- [ ] **Step 9: Perform manual browser acceptance**

Run `npm run dev`, sign into the seeded or real test account, and verify Search, Date, Filters, Sort, chips, Clear filters, pagination, saved views, Back and Forward, light theme, dark theme, 1440 by 900 desktop, and 390 by 844 phone behavior.
Inspect the actual ordering across pages and confirm no full browser reload occurs.
Record any blocked credential step separately from passed automated gates.

- [ ] **Step 10: Update the handoff after verification**

Add one concise dated entry near the top of `docs/HANDOFF.md` describing the shipped transaction sorting and staged filters, the no-migration decision, the exact local gates run, and any still-blocked live browser evidence.
Keep each full sentence on its own physical line.

- [ ] **Step 11: Commit acceptance coverage and handoff**

```bash
git add tests/e2e/transactions.spec.ts docs/HANDOFF.md
git commit -m "test(transactions): cover sorting and filter journey"
```

- [ ] **Step 12: Review the complete pull-request diff**

Run:

```bash
git status --short --branch
git log --oneline origin/main..HEAD
git diff --stat origin/main...HEAD
git diff --check origin/main...HEAD
```

Expected: only the approved design, implementation plan, transaction feature files, focused tests, and handoff entry appear.
Do not push or open the pull request until this final scope check is clean.

## Pull Request Acceptance Checklist

- [ ] Query values are normalized once and invalid values cannot reach Supabase or router navigation.
- [ ] Date and amount use correct direct database ordering when eligible.
- [ ] Merchant, category, account, and rule-aware filters sort the complete projected result before pagination.
- [ ] Displayed amount ordering uses `-plaidAmount`.
- [ ] Missing display labels remain last in both directions.
- [ ] Stable tie-breakers prevent pagination drift.
- [ ] All eight filters are staged and explicitly applied.
- [ ] Search applies on Enter and through its Search button.
- [ ] Escape and outside click cancel drafts and restore trigger focus.
- [ ] One Sort popover serves desktop and mobile.
- [ ] Saved views preserve filters, sort, and direction without storing columns.
- [ ] Clear filters preserves sorting and repeated column parameters.
- [ ] Current rows remain visible during client navigation and hard reload does not occur.
- [ ] Query failures never render as successful empty states or partial projected results.
- [ ] Owner scoping, RLS, sanitization, and privacy hooks remain intact.
- [ ] Focused tests, lint, typecheck, complete unit suite, build, and diff check pass.
- [ ] Targeted E2E and manual light, dark, desktop, and phone acceptance pass or are reported as explicitly blocked.
