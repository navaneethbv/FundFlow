import { describe, it, expect } from "vitest";
import {
  FINANCE_TRANSACTION_COLUMNS,
  fetchFinanceTransactions,
  loadCanonicalProjection,
  monthWindow,
  runBatched,
} from "@/lib/finance-query";
import type { FinancialScope } from "@/lib/financial-scope";
import { clientStub } from "../fixtures/supabase-query";

const MINE: FinancialScope = { kind: "mine", ownerUserId: "user-1" };
const HOUSEHOLD: FinancialScope = { kind: "household", householdId: "hh-1" };

interface Recorded {
  columns: string[];
  eq: Array<[string, unknown]>;
  gte: Array<[string, unknown]>;
  lt: Array<[string, unknown]>;
  order: string[];
  ranges: Array<[number, number]>;
}

/** Mock that serves `total` rows through whatever range windows are asked for. */
function makeSupabase(total: number, pageSize: number) {
  const recorded: Recorded = { columns: [], eq: [], gte: [], lt: [], order: [], ranges: [] };
  const rows = Array.from({ length: total }, (_, i) => ({
    id: `row-${String(i).padStart(4, "0")}`,
    user_id: "user-1",
    account_id: "acct-1",
    plaid_transaction_id: `plaid-${i}`,
    date: "2026-07-01",
    amount: 1,
    merchant_name: "Shop",
    name: "SHOP",
    pfc_primary: "GENERAL_MERCHANDISE",
    pfc_detailed: "GENERAL_MERCHANDISE_OTHER",
    pending: false,
  }));

  const chainFor = () => {
    let pendingRange: [number, number] = [0, pageSize - 1];
    let countMode = false;
    const chain: Record<string, unknown> = {};
    Object.assign(chain, {
      select: (columns: string, opts?: { count?: "exact"; head?: boolean }) => {
        recorded.columns.push(columns);
        countMode = opts?.head === true;
        return chain;
      },
      eq: (column: string, value: unknown) => {
        recorded.eq.push([column, value]);
        return chain;
      },
      gte: (column: string, value: unknown) => {
        recorded.gte.push([column, value]);
        return chain;
      },
      lt: (column: string, value: unknown) => {
        recorded.lt.push([column, value]);
        return chain;
      },
      order: (column: string) => {
        recorded.order.push(column);
        return chain;
      },
      range: (from: number, to: number) => {
        recorded.ranges.push([from, to]);
        pendingRange = [from, to];
        return chain;
      },
      then: (resolve: (value: { data: unknown[]; count?: number; error: null }) => unknown) =>
        resolve(
          countMode
            ? { data: [], count: total, error: null }
            : { data: rows.slice(pendingRange[0], pendingRange[1] + 1), error: null },
        ),
    });
    return chain;
  };

  return { supabase: { from: () => chainFor() } as never, recorded };
}

describe("monthWindow", () => {
  it("spans the anchor month plus the requested trailing months", () => {
    expect(monthWindow("2026-07", 5)).toEqual({ start: "2026-02-01", endExclusive: "2026-08-01" });
  });

  it("crosses a year boundary without timezone math", () => {
    expect(monthWindow("2026-01", 2)).toEqual({ start: "2025-11-01", endExclusive: "2026-02-01" });
  });

  it("covers only the anchor month when no trailing months are asked for", () => {
    expect(monthWindow("2026-07", 0)).toEqual({ start: "2026-07-01", endExclusive: "2026-08-01" });
  });
});

describe("fetchFinanceTransactions", () => {
  it("selects only the projection's columns and a head-only count", async () => {
    const { supabase, recorded } = makeSupabase(3, 1000);
    await fetchFinanceTransactions(supabase, { scope: MINE });
    // Page reads use exactly the projection columns; the count read is a
    // column-explicit head. Neither is `select("*")`.
    expect(recorded.columns).toContain(FINANCE_TRANSACTION_COLUMNS);
    expect(recorded.columns).toContain("id");
    expect(recorded.columns.some((columns) => columns === "*")).toBe(false);
    expect(FINANCE_TRANSACTION_COLUMNS).not.toContain("*");
  });

  it("filters by user_id under personal scope", async () => {
    const { supabase, recorded } = makeSupabase(1, 1000);
    await fetchFinanceTransactions(supabase, { scope: MINE });
    expect(recorded.eq).toContainEqual(["user_id", "user-1"]);
  });

  it("omits the user filter under household scope so RLS decides", async () => {
    const { supabase, recorded } = makeSupabase(1, 1000);
    await fetchFinanceTransactions(supabase, { scope: HOUSEHOLD });
    expect(recorded.eq.some(([column]) => column === "user_id")).toBe(false);
  });

  it("applies a date window when given one", async () => {
    const { supabase, recorded } = makeSupabase(1, 1000);
    await fetchFinanceTransactions(supabase, {
      scope: MINE,
      window: { start: "2026-02-01", endExclusive: "2026-08-01" },
    });
    expect(recorded.gte).toContainEqual(["date", "2026-02-01"]);
    expect(recorded.lt).toContainEqual(["date", "2026-08-01"]);
  });

  it("orders by date then id so pages never overlap or skip", async () => {
    const { supabase, recorded } = makeSupabase(1, 1000);
    await fetchFinanceTransactions(supabase, { scope: MINE });
    expect(recorded.order).toEqual(["date", "id"]);
  });

  it("pages until the source is exhausted", async () => {
    const { supabase, recorded } = makeSupabase(2500, 1000);
    const result = await fetchFinanceTransactions(supabase, { scope: MINE, pageSize: 1000 });
    expect(result.rows).toHaveLength(2500);
    expect(recorded.ranges).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
    expect(result.truncated).toBe(false);
  });

  it("stops at the explicit upper bound and reports truncation", async () => {
    const { supabase } = makeSupabase(5000, 1000);
    const result = await fetchFinanceTransactions(supabase, {
      scope: MINE,
      pageSize: 1000,
      maxRows: 2000,
    });
    expect(result.rows).toHaveLength(2000);
    expect(result.truncated).toBe(true);
  });

  it("adapts rows into the canonical raw shape", async () => {
    const { supabase } = makeSupabase(1, 1000);
    const result = await fetchFinanceTransactions(supabase, { scope: MINE });
    expect(result.rows[0]).toMatchObject({
      id: "row-0000",
      source: "plaid",
      manualAccountId: null,
      pending: false,
    });
  });

  it("excludes pending rows only when asked", async () => {
    const { supabase, recorded } = makeSupabase(1, 1000);
    await fetchFinanceTransactions(supabase, { scope: MINE, excludePending: true });
    expect(recorded.eq).toContainEqual(["pending", false]);

    const second = makeSupabase(1, 1000);
    await fetchFinanceTransactions(second.supabase, { scope: MINE });
    expect(second.recorded.eq.some(([column]) => column === "pending")).toBe(false);
  });

  it("requests and includes a second range once the first page is full", async () => {
    const { supabase, recorded } = makeSupabase(1001, 1000);
    const result = await fetchFinanceTransactions(supabase, {
      scope: MINE,
      pageSize: 1000,
    });
    expect(recorded.ranges).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(result.rows).toHaveLength(1001);
    expect(result.rows[1000]!.id).toBe("row-1000");
    expect(result.truncated).toBe(false);
  });

  it("fetches independent pages across concurrent batches with no gaps or duplicates", async () => {
    const { supabase, recorded } = makeSupabase(7001, 1000);
    const result = await fetchFinanceTransactions(supabase, {
      scope: MINE,
      pageSize: 1000,
    });
    // 8 pages, fetched concurrently in bounded batches, in deterministic order.
    expect(recorded.ranges).toEqual(
      Array.from({ length: 8 }, (_, index) => [index * 1000, index * 1000 + 999]),
    );
    expect(result.rows).toHaveLength(7001);
    expect(new Set(result.rows.map((row) => row.id)).size).toBe(7001);
    expect(result.truncated).toBe(false);
  });

  it("reports truncation when a parallel read reaches the ceiling", async () => {
    const { supabase } = makeSupabase(6000, 1000);
    const result = await fetchFinanceTransactions(supabase, {
      scope: MINE,
      pageSize: 1000,
      maxRows: 2000,
    });
    expect(result.rows).toHaveLength(2000);
    expect(result.truncated).toBe(true);
  });

  it("skips page fetches entirely when the count is zero", async () => {
    const { supabase, recorded } = makeSupabase(0, 1000);
    const result = await fetchFinanceTransactions(supabase, { scope: MINE });
    expect(result.rows).toHaveLength(0);
    expect(result.truncated).toBe(false);
    // One range request (page zero) runs alongside the count, then stops.
    expect(recorded.ranges.length).toBeLessThanOrEqual(1);
  });

  it("orders pages by date then id so duplicate dates never duplicate or skip a row", async () => {
    const pageSize = 10;
    // Every row shares one date: only the id tie-breaker keeps the ranges from
    // overlapping or dropping rows when the sort key is not unique.
    const rows = Array.from({ length: 25 }, (_, index) => ({
      id: `same-day-${index}`,
      user_id: "user-1",
      account_id: "acct-1",
      plaid_transaction_id: `plaid-${index}`,
      date: "2026-08-01",
      amount: 1,
      merchant_name: "Shop",
      name: "SHOP",
      pfc_primary: "GENERAL_MERCHANDISE",
      pfc_detailed: "GENERAL_MERCHANDISE_OTHER",
      pending: false,
    }));
const recorded: Recorded = { columns: [], eq: [], gte: [], lt: [], order: [], ranges: [] };
    const chainFor = () => {
      let pendingRange: [number, number] = [0, pageSize - 1];
      let countMode = false;
      const chain: Record<string, unknown> = {};
      Object.assign(chain, {
        select: (columns: string, opts?: { head?: boolean }) => {
          recorded.columns.push(columns);
          countMode = opts?.head === true;
          return chain;
        },
        eq: () => chain,
        gte: () => chain,
        lt: () => chain,
        order: (column: string) => {
          recorded.order.push(column);
          return chain;
        },
        range: (from: number, to: number) => {
          recorded.ranges.push([from, to]);
          pendingRange = [from, to];
          return chain;
        },
        then: (resolve: (value: { data: unknown[]; count?: number; error: null }) => unknown) =>
          resolve(
            countMode
              ? { data: [], count: rows.length, error: null }
              : { data: rows.slice(pendingRange[0], pendingRange[1] + 1), error: null },
          ),
      });
      return chain;
    };

    const result = await fetchFinanceTransactions(
      { from: () => chainFor() } as never,
      { scope: MINE, pageSize },
    );
    expect(recorded.order.slice(0, 2)).toEqual(["date", "id"]);
    expect(recorded.ranges).toHaveLength(3);
    const ids = result.rows.map((row) => row.id);
    expect(new Set(ids).size).toBe(25);
    expect(ids).toEqual(rows.map((row) => row.id));
  });
});

describe("runBatched", () => {
  it("caps concurrent execution and returns results in input order", async () => {
    let inFlight = 0;
    let peak = 0;
    const tasks = Array.from({ length: 12 }, (_, index) => async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return index;
    });
    const results = await runBatched(tasks, 4);
    expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(peak).toBeLessThanOrEqual(4);
  });

  it("returns [] for no tasks", async () => {
    expect(await runBatched([], 4)).toEqual([]);
  });

  it("propagates a failing task", async () => {
    await expect(
      runBatched(
        [
          async () => "ok",
          async () => {
            throw new Error("split read failed");
          },
        ],
        2,
      ),
    ).rejects.toThrow("split read failed");
  });
});

describe("loadCanonicalProjection", () => {
  const transactionRows = [
    {
      id: "expense-1",
      user_id: "user-1",
      account_id: "account-1",
      plaid_transaction_id: "plaid-expense-1",
      date: "2026-07-10",
      amount: 100,
      merchant_name: "Original Market",
      name: "ORIGINAL MARKET",
      pfc_primary: "FOOD_AND_DRINK",
      pfc_detailed: "FOOD_AND_DRINK_GROCERIES",
      pending: false,
    },
  ];

  function projectionClient(overrides: Record<string, { data?: unknown; error?: unknown }> = {}) {
    return clientStub({
      transactions: { data: transactionRows },
      accounts: {
        data: [
          {
            id: "account-1",
            name: "Daily Checking",
            iso_currency_code: "usd",
          },
        ],
      },
      merchant_rules: {
        data: [
          {
            match_type: "account",
            pattern: "daily checking",
            display_name: "Account Rule",
            category: "FOOD_AND_DRINK",
            enabled: true,
          },
        ],
      },
      category_overrides: {
        data: [
          {
            source_category: "FOOD_AND_DRINK",
            display_category: "EVERYDAY",
          },
        ],
      },
      transaction_splits: {
        data: [
          {
            transaction_id: "expense-1",
            category: "Groceries",
            amount: 40,
          },
          {
            transaction_id: "expense-1",
            category: "Dining",
            amount: 60,
          },
        ],
      },
      linked_refunds: { data: [] },
      linked_duplicates: { data: [] },
      ...overrides,
    });
  }

  it("loads the real split schema and passes every dependency to the projection", async () => {
    const supabase = projectionClient();

    const result = await loadCanonicalProjection(supabase as never, {
      scope: MINE,
      window: { start: "2026-07-01", endExclusive: "2026-08-01" },
    });

    expect(supabase.callsOn("transaction_splits")).toEqual(
      expect.arrayContaining([
        {
          method: "select",
          args: ["transaction_id,category,amount"],
        },
        {
          method: "in",
          args: ["transaction_id", ["expense-1"]],
        },
      ]),
    );
    expect(result.transactions).toEqual([
      expect.objectContaining({
        id: "expense-1::0",
        merchant: "Account Rule",
        groupKey: "EVERYDAY",
        categoryKey: "Groceries",
        signedAmount: 40,
      }),
      expect.objectContaining({
        id: "expense-1::1",
        categoryKey: "Dining",
        signedAmount: 60,
      }),
    ]);
    expect(result.currencyByAccountId).toEqual(
      new Map([["account-1", "USD"]]),
    );
    expect(
      supabase.callsOn("merchant_rules").filter(({ method }) => method === "order"),
    ).toEqual([
      { method: "order", args: ["created_at"] },
      { method: "order", args: ["id"] },
    ]);
  });

  it("filters every Mine dependency by owner and leaves Household visibility to RLS", async () => {
    const mineClient = projectionClient();
    await loadCanonicalProjection(mineClient as never, { scope: MINE });

    for (const table of [
      "accounts",
      "merchant_rules",
      "category_overrides",
      "transaction_splits",
      "linked_refunds",
      "linked_duplicates",
    ]) {
      expect(mineClient.scopedToUser(table, "user-1")).toBe(true);
    }

    const householdClient = projectionClient();
    await loadCanonicalProjection(householdClient as never, {
      scope: HOUSEHOLD,
    });

    for (const table of [
      "accounts",
      "merchant_rules",
      "category_overrides",
      "transaction_splits",
      "linked_refunds",
      "linked_duplicates",
    ]) {
      expect(householdClient.scopedToUser(table, "user-1")).toBe(false);
    }
  });

  it("chunks split dependency reads so no in() call overruns the request line", async () => {
    const rows = Array.from({ length: 501 }, (_, index) => ({
      ...transactionRows[0],
      id: `expense-${index}`,
      plaid_transaction_id: `plaid-expense-${index}`,
    }));
    const supabase = projectionClient({ transactions: { data: rows } });

    await loadCanonicalProjection(supabase as never, { scope: MINE });

    const splitChunks = supabase
      .callsOn("transaction_splits")
      .filter(({ method }) => method === "in");
    expect(splitChunks).toHaveLength(3);
    expect(splitChunks[0]?.args[1]).toHaveLength(250);
    expect(splitChunks[1]?.args[1]).toHaveLength(250);
    expect(splitChunks[2]?.args[1]).toHaveLength(1);
  });

  it("pages every growing projection dependency instead of silently truncating it", async () => {
    const rows = Array.from({ length: 1001 }, (_, index) => ({
      id: `row-${index}`,
      name: `Account ${index}`,
      iso_currency_code: "usd",
    }));
    const supabase = projectionClient({
      accounts: { data: rows },
      merchant_rules: {
        data: rows.map((_, index) => ({
          match_type: "merchant",
          pattern: `Never matches ${index}`,
          display_name: null,
          category: null,
          enabled: false,
        })),
      },
      category_overrides: {
        data: rows.map((_, index) => ({
          source_category: `SOURCE_${index}`,
          display_category: `DISPLAY_${index}`,
        })),
      },
      linked_refunds: {
        data: rows.map((_, index) => ({
          charge_transaction_id: `charge-${index}`,
          refund_transaction_id: `refund-${index}`,
        })),
      },
      linked_duplicates: {
        data: rows.map((_, index) => ({
          excluded_transaction_id: `duplicate-${index}`,
        })),
      },
    });

    const result = await loadCanonicalProjection(supabase as never, { scope: MINE });

    expect(result.currencyByAccountId.size).toBe(1001);
    for (const table of [
      "accounts",
      "merchant_rules",
      "category_overrides",
      "linked_refunds",
      "linked_duplicates",
    ]) {
      expect(
        supabase.callsOn(table).filter(({ method }) => method === "range"),
      ).toEqual([
        { method: "range", args: [0, 999] },
        { method: "range", args: [1000, 1999] },
      ]);
    }
  });

  it("pages split rows within each URL-safe transaction chunk", async () => {
    const supabase = projectionClient({
      transaction_splits: {
        data: Array.from({ length: 1001 }, (_, index) => ({
          transaction_id: "expense-1",
          category: `Part ${index}`,
          amount: index === 1000 ? 1 : 0.099,
        })),
      },
    });

    const result = await loadCanonicalProjection(supabase as never, { scope: MINE });

    expect(result.transactions).toHaveLength(1001);
    expect(
      supabase.callsOn("transaction_splits").filter(({ method }) => method === "range"),
    ).toEqual([
      { method: "range", args: [0, 999] },
      { method: "range", args: [1000, 1999] },
    ]);
  });

  it("excludes only the confirmed duplicate id loaded in the active scope", async () => {
    const supabase = projectionClient({
      linked_duplicates: {
        data: [{ excluded_transaction_id: "expense-1" }],
      },
    });

    const result = await loadCanonicalProjection(supabase as never, { scope: MINE });

    expect(result.transactions).toEqual([]);
  });

  it("reports dependency failures without exposing database messages", async () => {
    const supabase = projectionClient({
      category_overrides: {
        data: null,
        error: { code: "42501", message: "sensitive database detail" },
      },
    });

    await expect(
      loadCanonicalProjection(supabase as never, { scope: MINE }),
    ).rejects.toThrow("finance_projection_query_failed:category_overrides:42501");
  });
});

describe("loadCanonicalProjection — unmigrated linked_transfers", () => {
  const transactionRows = [
    {
      id: "expense-1",
      user_id: "user-1",
      account_id: "account-1",
      plaid_transaction_id: "plaid-expense-1",
      date: "2026-07-10",
      amount: 100,
      merchant_name: "Original Market",
      name: "ORIGINAL MARKET",
      pfc_primary: "FOOD_AND_DRINK",
      pfc_detailed: "FOOD_AND_DRINK_GROCERIES",
      pending: false,
    },
  ];
  const MINE: FinancialScope = { kind: "mine", ownerUserId: "user-1" };

  function minimalClient(overrides: Record<string, { data?: unknown; error?: unknown }> = {}) {
    return clientStub({
      transactions: { data: transactionRows },
      accounts: { data: [{ id: "account-1", name: "Daily Checking", iso_currency_code: "usd" }] },
      merchant_rules: { data: [] },
      category_overrides: { data: [] },
      transaction_splits: { data: [] },
      transaction_annotations: { data: [] },
      linked_refunds: { data: [] },
      linked_duplicates: { data: [] },
      ...overrides,
    });
  }

  it("degrades to no linked transfers when the table is missing (42P01)", async () => {
    const supabase = minimalClient({
      linked_transfers: { error: { code: "42P01" } },
    });
    const result = await loadCanonicalProjection(supabase as never, {
      scope: MINE,
      window: { start: "2026-07-01", endExclusive: "2026-08-01" },
    });
    // The projection completes; the row keeps its provider flow (expense).
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]!.flow).toBe("expense");
  });

  it("rethrows non-42P01 linked_transfers failures", async () => {
    const supabase = minimalClient({
      linked_transfers: { error: { code: "XX000" } },
    });
    await expect(
      loadCanonicalProjection(supabase as never, {
        scope: MINE,
        window: { start: "2026-07-01", endExclusive: "2026-08-01" },
      }),
    ).rejects.toThrow("finance_projection_query_failed:linked_transfers:XX000");
  });
});
