import { describe, it, expect } from "vitest";
import {
  FINANCE_TRANSACTION_COLUMNS,
  fetchFinanceTransactions,
  monthWindow,
} from "@/lib/finance-query";
import type { FinancialScope } from "@/lib/financial-scope";

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

  let pendingRange: [number, number] = [0, pageSize - 1];
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    select: (columns: string) => {
      recorded.columns.push(columns);
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
    then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
      resolve({ data: rows.slice(pendingRange[0], pendingRange[1] + 1), error: null }),
  });

  return { supabase: { from: () => chain } as never, recorded };
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
  it("selects only the projection's columns", async () => {
    const { supabase, recorded } = makeSupabase(3, 1000);
    await fetchFinanceTransactions(supabase, { scope: MINE });
    expect(recorded.columns).toEqual([FINANCE_TRANSACTION_COLUMNS]);
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
});
