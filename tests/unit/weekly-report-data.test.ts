import { describe, expect, it } from "vitest";
import { getWeeklyReportData } from "@/lib/weekly-report-data";
import { clientStub } from "../fixtures/supabase-query";

describe("getWeeklyReportData", () => {
  const period = {
    start: "2026-07-06",
    end: "2026-07-12",
    previousStart: "2026-06-29",
    previousEnd: "2026-07-05",
    label: "Jul 6 – Jul 12, 2026",
  };

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
