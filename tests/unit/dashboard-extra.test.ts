import { describe, expect, it, vi } from "vitest";
import { getDashboardData, shiftMonthKey } from "@/lib/dashboard";

describe("getDashboardData", () => {
  it("loads full dashboard data with recurring stream matches and net worth snapshots", async () => {
    const mockFrom = vi.fn((table: string) => {
      const chain: Record<string, unknown> = {};
      const methods = [
        "select", "eq", "order", "limit", "gte", "lt", "in", "single",
      ];
      for (const m of methods) {
        chain[m] = () => chain;
      }

      let data: unknown = [];
      if (table === "accounts") {
        data = [
          {
            id: "acc-1",
            name: "Checking",
            official_name: "Chase Checking",
            mask: "1234",
            type: "depository",
            subtype: "checking",
            current_balance: 5000,
            available_balance: 4800,
            credit_limit: null,
            iso_currency_code: "USD",
            plaid_item_id: "item-1",
            apr: null,
          },
        ];
      } else if (table === "recurring_streams") {
        data = [
          {
            merchant_name: "Netflix",
            description: "Netflix Subscription",
            average_amount: 15.99,
            frequency: "monthly",
            category: "ENTERTAINMENT",
            stream_type: "outflow",
            is_active: true,
            plaid_item_id: "item-1",
          },
          {
            merchant_name: "Employer Payroll",
            description: "Biweekly Paycheck",
            average_amount: 2500,
            frequency: "biweekly",
            category: "INCOME",
            stream_type: "inflow",
            is_active: true,
            plaid_item_id: "item-1",
          },
        ];
      } else if (table === "sinking_fund_buckets") {
        data = [
          {
            name: "Auto Insurance",
            target_amount: 600,
            due_date: "2026-07-25",
          },
        ];
      } else if (table === "plaid_items") {
        data = [{ id: "item-1", institution_name: "Chase" }];
      } else if (table === "budgets") {
        data = [{ category: "ENTERTAINMENT", monthly_limit: 100, rollover_enabled: false }];
      } else if (table === "sync_jobs") {
        chain.maybeSingle = () => Promise.resolve({ data: { updated_at: "2026-07-15T10:00:00.000Z" } });
        chain.then = (res: (v: unknown) => unknown) => res({ data: { updated_at: "2026-07-15T10:00:00.000Z" } });
        return chain;
      } else if (table === "net_worth_snapshots") {
        data = [{ snapshot_month: "2026-06-01", assets: 10000, liabilities: 2000 }];
      } else if (table === "transactions") {
        chain.maybeSingle = () => Promise.resolve({ data: { date: "2026-07-01" } });
        data = [
          {
            id: "t1",
            date: "2026-07-05",
            amount: 15.99,
            merchant_name: "Netflix",
            name: "NETFLIX",
            pfc_primary: "ENTERTAINMENT",
            pfc_detailed: "ENTERTAINMENT_SUBSCRIPTION",
            account_id: "acc-1",
            user_id: "user-1",
            plaid_transaction_id: "p1",
          },
          {
            id: "t2",
            date: "2026-07-01",
            amount: -2500,
            merchant_name: "Employer Payroll",
            name: "PAYROLL",
            pfc_primary: "INCOME",
            pfc_detailed: "INCOME_WAGES",
            account_id: "acc-1",
            user_id: "user-1",
            plaid_transaction_id: "p2",
          },
        ];
      }

      chain.then = (res: (v: unknown) => unknown) => res({ data });
      chain.maybeSingle = () => Promise.resolve({ data: Array.isArray(data) ? data[0] : data });
      return chain;
    });

    const supabase = { from: mockFrom };

    const data = await getDashboardData(
      supabase as never,
      undefined,
      "2026-07",
      "user-1",
    );

    expect(data.accounts).toHaveLength(1);
    expect(data.netWorthHistory).toHaveLength(1);
    expect(data.subscriptions.length).toBeGreaterThan(0);
  });

  it("handles empty database responses gracefully", async () => {
    const mockFrom = vi.fn(() => {
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order", "limit", "gte", "lt", "in", "single"]) {
        chain[m] = () => chain;
      }
      chain.then = (res: (v: unknown) => unknown) => res({ data: [] });
      chain.maybeSingle = () => Promise.resolve({ data: null });
      return chain;
    });

    const supabase = { from: mockFrom };

    const data = await getDashboardData(
      supabase as never,
      undefined,
      "2026-07",
      "user-1",
    );

    expect(data.accounts).toEqual([]);
    expect(data.netWorthHistory).toEqual([]);
  });
});

describe("shiftMonthKey", () => {
  it("shifts forward by one month", () => {
    expect(shiftMonthKey("2026-07", 1)).toBe("2026-08");
  });

  it("shifts backward by one month", () => {
    expect(shiftMonthKey("2026-01", -1)).toBe("2025-12");
  });

  it("shifts across year boundaries forward", () => {
    expect(shiftMonthKey("2026-11", 3)).toBe("2027-02");
  });

  it("shifts by zero", () => {
    expect(shiftMonthKey("2026-06", 0)).toBe("2026-06");
  });

  it("shifts by a full year", () => {
    expect(shiftMonthKey("2025-03", 12)).toBe("2026-03");
  });
});
