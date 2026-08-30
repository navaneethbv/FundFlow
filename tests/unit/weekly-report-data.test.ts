import { describe, expect, it } from "vitest";
import { getWeeklyReportData } from "@/lib/weekly-report-data";
import { clientStub } from "../fixtures/supabase-query";

/**
 * A Supabase client whose `transactions` table serves `range` windows from a
 * fixed deterministic row list, so a test can prove the loader pages past the
 * 1,000-row PostgREST cap and never drops or duplicates a row.
 */
function paginatedTransactionsClient(
  total: number,
  splitRows: unknown[] = [],
  splitResult: { data: unknown; error: unknown } | null = null,
) {
  const rows = Array.from({ length: total }, (_, index) => ({
    id: `t-${String(index).padStart(4, "0")}`,
    date: "2026-07-08",
    amount: 10,
    merchant_name: null,
    name: "Shop",
    pfc_primary: "GENERAL_MERCHANDISE",
    account_id: "acc-1",
  }));
  const ranges: Array<[number, number]> = [];
  const splitInArgs: unknown[][] = [];
  let pendingRange: [number, number] = [0, 999];
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    select: (columns: string) => {
      if (columns === "id, date, amount, merchant_name, name, pfc_primary, account_id") {
        chain._mode = "transactions";
      } else {
        chain._mode = "splits";
      }
      return chain;
    },
    eq: () => chain,
    gte: () => chain,
    lte: () => chain,
    order: () => chain,
    in: (_column: string, values: unknown[]) => {
      if (chain._mode === "splits") splitInArgs.push(values);
      return chain;
    },
    range: (from: number, to: number) => {
      ranges.push([from, to]);
      pendingRange = [from, to];
      return chain;
    },
    then: (resolve: (value: { data: unknown; error: unknown }) => unknown) =>
      resolve(
        chain._mode === "splits"
          ? (splitResult ?? { data: splitRows, error: null })
          : { data: rows.slice(pendingRange[0], pendingRange[1] + 1), error: null },
      ),
  });

  const dbStub = clientStub({
    accounts: { data: [{ id: "acc-1", name: "Checking", type: "depository", plaid_item_id: "p1" }] },
    plaid_items: { data: [{ id: "p1", institution_name: "Chase" }] },
    budgets: { data: [] },
    merchant_rules: { data: [] },
    linked_refunds: { data: [] },
    linked_duplicates: { data: [] },
  });
  const supabase = {
    ...dbStub,
    from: (table: string) => {
      if (table === "transactions") return chain;
      if (table === "transaction_splits") return chain;
      return dbStub.from(table);
    },
    auth: {
      admin: {
        getUserById: async () => ({
          data: { user: { email: "user@example.com" } },
          error: null,
        }),
      },
    },
  };
  return { supabase, ranges, splitInArgs };
}

describe("getWeeklyReportData", () => {
  const period = {
    start: "2026-07-06",
    end: "2026-07-12",
    previousStart: "2026-06-29",
    previousEnd: "2026-07-05",
    label: "Jul 6 – Jul 12, 2026",
  };

  it("pages past the 1,000-row response cap with an ordered range walk", async () => {
    const { supabase, ranges } = paginatedTransactionsClient(1501);
    const data = await getWeeklyReportData(supabase as never, "user-1", period);
    expect(ranges).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(data).not.toBeNull();
    // Every row landed in the model: two full 1,000-row pages + one row.
    expect(data!.totalSpend).toBe(15010);
  });

  it("chunks split lookups so no in() call receives the whole set or overruns the request line", async () => {
    const { supabase, splitInArgs } = paginatedTransactionsClient(1001);
    await getWeeklyReportData(supabase as never, "user-1", period);
    expect(splitInArgs).toHaveLength(5);
    expect(splitInArgs.map((chunk) => chunk.length)).toEqual([250, 250, 250, 250, 1]);
    for (const chunk of splitInArgs) {
      expect(chunk.length).toBeLessThanOrEqual(250);
    }
  });

  it("propagates a failed split chunk with context", async () => {
    const { supabase } = paginatedTransactionsClient(
      600,
      [],
      { data: null, error: { message: "split read failed" } },
    );
    await expect(
      getWeeklyReportData(supabase as never, "user-1", period),
    ).rejects.toThrow(
      "weekly report transaction splits: split read failed",
    );
  });

  it("propagates a failed transaction page with context", async () => {
    const { supabase } = paginatedTransactionsClient(1500);
    const failing = {
      ...supabase,
      from: (table: string) => {
        if (table === "transactions") {
          const chain: Record<string, unknown> = {};
          Object.assign(chain, {
            select: () => chain,
            eq: () => chain,
            gte: () => chain,
            lte: () => chain,
            order: () => chain,
            range: () => chain,
            then: (resolve: (value: { data: null; error: unknown }) => unknown) =>
              resolve({ data: null, error: { message: "range failed" } }),
          });
          return chain;
        }
        return supabase.from(table);
      },
    };
    await expect(
      getWeeklyReportData(failing as never, "user-1", period),
    ).rejects.toThrow("weekly report transactions: range failed");
  });

  it("returns null if user has no email", async () => {
    const supabase = {
      auth: {
        admin: {
          getUserById: async () => ({ data: { user: null }, error: null }),
        },
      },
    };

    const data = await getWeeklyReportData(supabase as never, "user-1", period);
    expect(data).toBeNull();
  });

  it("loads report data with splits, linked refunds, and duplicate decisions", async () => {
    const dbStub = clientStub({
      accounts: {
        data: [{ id: "acc-1", name: "Checking", type: "depository", plaid_item_id: "p1" }],
      },
      plaid_items: {
        data: [{ id: "p1", institution_name: "Chase" }],
      },
      budgets: {
        data: [{ category: "FOOD_AND_DRINK", monthly_limit: 500 }],
      },
      merchant_rules: {
        data: [
          {
            match_type: "merchant",
            pattern: "Coffee",
            display_name: "Coffee Shop",
            category: "FOOD_AND_DRINK",
            enabled: true,
          },
        ],
      },
      linked_refunds: {
        data: [{ charge_transaction_id: "t1", refund_transaction_id: "t2" }],
      },
      transaction_review_decisions: {
        data: [{ subject_id: "t1", kind: "duplicate", decision: "confirmed" }],
      },
      transactions: {
        data: [
          {
            id: "t1",
            date: "2026-07-08",
            amount: 50,
            merchant_name: "Coffee Shop",
            name: "COFFEE",
            pfc_primary: "FOOD_AND_DRINK",
            account_id: "acc-1",
          },
          {
            id: "t2",
            date: "2026-07-09",
            amount: -50,
            merchant_name: "Coffee Shop",
            name: "COFFEE REFUND",
            pfc_primary: "FOOD_AND_DRINK",
            account_id: "acc-1",
          },
        ],
      },
      transaction_splits: {
        data: [{ transaction_id: "t1", category: "Coffee", amount: 50 }],
      },
    });

    const supabase = {
      ...dbStub,
      auth: {
        admin: {
          getUserById: async () => ({
            data: { user: { email: "user@example.com" } },
            error: null,
          }),
        },
      },
    };

    const data = await getWeeklyReportData(supabase as never, "user-1", period);

    expect(data).not.toBeNull();
    expect(data?.userEmail).toBe("user@example.com");
    expect(data?.totalSpend).toBeDefined();
  });

  it("loads transaction classification overrides into the weekly report", async () => {
    const dbStub = clientStub({
      accounts: {
        data: [{ id: "acc-1", name: "Checking", type: "depository", plaid_item_id: "p1" }],
      },
      plaid_items: { data: [{ id: "p1", institution_name: "Chase" }] },
      budgets: { data: [] },
      merchant_rules: { data: [] },
      linked_refunds: { data: [] },
      linked_duplicates: { data: [] },
      transactions: {
        data: [{
          id: "t1",
          date: "2026-07-08",
          amount: 90,
          merchant_name: "Confirmed purchase",
          name: "CONFIRMED PURCHASE",
          pfc_primary: "LOAN_PAYMENTS",
          account_id: "acc-1",
        }],
      },
      transaction_splits: { data: [] },
      transaction_annotations: {
        data: [{
          transaction_id: "t1",
          display_category: null,
          cash_flow_classification: "expense",
        }],
      },
    });
    const supabase = {
      ...dbStub,
      auth: {
        admin: {
          getUserById: async () => ({
            data: { user: { email: "user@example.com" } },
            error: null,
          }),
        },
      },
    };

    const data = await getWeeklyReportData(supabase as never, "user-1", period);

    expect(data?.totalSpend).toBe(90);
    expect(supabase.callsOn("transaction_annotations")).toEqual(
      expect.arrayContaining([
        { method: "in", args: ["transaction_id", ["t1"]] },
        { method: "eq", args: ["user_id", "user-1"] },
      ]),
    );
  });

  it("throws error when query result has error", async () => {
    const dbStub = clientStub({
      accounts: { error: new Error("Accounts DB Error") },
    });

    const supabase = {
      ...dbStub,
      auth: {
        admin: {
          getUserById: async () => ({
            data: { user: { email: "user@example.com" } },
            error: null,
          }),
        },
      },
    };

    await expect(getWeeklyReportData(supabase as never, "user-1", period)).rejects.toThrow(
      "weekly report accounts: Accounts DB Error",
    );
  });

  it("throws error if admin.getUserById returns error", async () => {
    const supabase = {
      auth: {
        admin: {
          getUserById: async () => ({
            data: null,
            error: new Error("User lookup failed"),
          }),
        },
      },
    };

    await expect(getWeeklyReportData(supabase as never, "user-1", period)).rejects.toThrow(
      "weekly report user: User lookup failed",
    );
  });

  it("handles error without message and null table data", async () => {
    const supabaseErr = {
      auth: {
        admin: {
          getUserById: async () => ({
            data: null,
            error: {}, // No message property
          }),
        },
      },
    };

    await expect(getWeeklyReportData(supabaseErr as never, "user-1", period)).rejects.toThrow(
      "weekly report user: query failed",
    );

    // Empty / null table results
    const dbStub = clientStub({
      accounts: { data: null },
      plaid_items: { data: null },
      budgets: { data: null },
      merchant_rules: { data: null },
      linked_refunds: { data: null },
      linked_duplicates: { data: null },
      transactions: { data: null },
      transaction_splits: { data: null },
    });

    const supabase = {
      ...dbStub,
      auth: {
        admin: {
          getUserById: async () => ({
            data: { user: { email: "user@example.com" } },
            error: null,
          }),
        },
      },
    };

    const data = await getWeeklyReportData(supabase as never, "user-1", period);
    expect(data).toBeDefined();
    expect(data?.totalSpend).toBe(0);
    expect(data?.categories).toEqual([]);
  });
});
