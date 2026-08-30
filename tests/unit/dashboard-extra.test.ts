import { describe, expect, it, vi } from "vitest";
import {
  computeCumulativeSpendByDay,
  getDashboardData,
  shiftMonthKey,
} from "@/lib/dashboard";
import type { CanonicalFinanceTransaction } from "@/lib/finance-domain";
import { withinNextSevenDays } from "@/components/dashboard/widgets/RecurringWidget";

function makeSupabase(seeds: Record<string, unknown> = {}) {
  const mockFrom = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order", "limit", "gte", "lt", "in", "range", "single"]) {
      chain[m] = () => chain;
    }
    const seed = seeds[table];
    const single = Array.isArray(seed) ? (seed[0] ?? null) : (seed ?? null);
    chain.maybeSingle = () => Promise.resolve({ data: single });
    chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: seed ?? null });
    return chain;
  });
  return { from: mockFrom };
}

describe("getDashboardData", () => {
  it("loads full dashboard data with recurring stream matches and net worth snapshots", async () => {
    const mockFrom = vi.fn((table: string) => {
      const chain: Record<string, unknown> = {};
      const methods = [
        "select", "eq", "order", "limit", "gte", "lt", "in", "range", "single",
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
          {
            name: "Past Fund",
            target_amount: 300,
            due_date: "2026-06-01",
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
          {
            id: "t3",
            date: "2026-07-10",
            amount: 45.0,
            merchant_name: null,
            name: "Local Cafe",
            pfc_primary: "FOOD_AND_DRINK",
            pfc_detailed: "COFFEE",
            account_id: "acc-1",
            user_id: "user-1",
            plaid_transaction_id: "p3",
          },
          {
            id: "t4",
            date: "2026-07-11",
            amount: 550.0,
            merchant_name: null,
            name: null,
            pfc_primary: "GENERAL_MERCHANDISE",
            pfc_detailed: "OTHER",
            account_id: "acc-1",
            user_id: "user-1",
            plaid_transaction_id: "p4",
          },
          {
            id: "t5",
            date: "2026-06-10",
            amount: 45.0,
            merchant_name: null,
            name: "Local Cafe",
            pfc_primary: "FOOD_AND_DRINK",
            pfc_detailed: "COFFEE",
            account_id: "acc-1",
            user_id: "user-1",
            plaid_transaction_id: "p5",
          },
          {
            id: "t6",
            date: "2026-05-10",
            amount: 45.0,
            merchant_name: null,
            name: "Local Cafe",
            pfc_primary: "FOOD_AND_DRINK",
            pfc_detailed: "COFFEE",
            account_id: "acc-1",
            user_id: "user-1",
            plaid_transaction_id: "p6",
          },
          {
            id: "t7",
            date: "2026-06-15",
            amount: 20.0,
            merchant_name: null,
            name: null,
            pfc_primary: "GENERAL_SERVICES",
            pfc_detailed: "OTHER",
            account_id: "acc-1",
            user_id: "user-1",
            plaid_transaction_id: "p7",
          },
          {
            id: "t8",
            date: "2026-05-15",
            amount: 20.0,
            merchant_name: null,
            name: null,
            pfc_primary: "GENERAL_SERVICES",
            pfc_detailed: "OTHER",
            account_id: "acc-1",
            user_id: "user-1",
            plaid_transaction_id: "p8",
          },
          {
            id: "t9",
            date: "2026-07-20",
            amount: 20.0,
            merchant_name: "OnlyMerchant",
            name: null,
            pfc_primary: "GENERAL_SERVICES",
            pfc_detailed: "OTHER",
            account_id: "acc-1",
            user_id: "user-1",
            plaid_transaction_id: "p9",
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

  it("skips explicit user scoping when no userId is passed and tolerates missing tables", async () => {
    const supabase = makeSupabase();
    const data = await getDashboardData(supabase as never, undefined, "2026-07");

    expect(data.accounts).toEqual([]);
    expect(data.subscriptions).toEqual([]);
    expect(data.incomeStreams).toEqual([]);
    expect(data.netWorthHistory).toEqual([]);
    expect(data.lastSyncAt).toBeNull();
    expect(data.lastSyncAgoMinutes).toBeNull();
    expect(data.syncIsStale).toBe(false);
    expect(data.spendPerPerson).toBeNull();
    expect(data.insights.debt).toBeNull();
    expect(data.insights.priceDrift.items).toEqual([]);
    expect(data.billPeriods.weekly).toEqual([]);
    expect(data.billPeriods.monthly).toEqual([]);
  });

  it("uses Plaid's predicted next date for a stream due tomorrow in the recurring widget", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-29T12:00:00.000Z"));
    try {
      const supabase = makeSupabase({
        accounts: [
          {
            id: "acc-1",
            name: "Checking",
            official_name: null,
            mask: null,
            type: "depository",
            subtype: "checking",
            current_balance: 1000,
            available_balance: 1000,
            credit_limit: null,
            iso_currency_code: "USD",
            plaid_item_id: "item-1",
            apr: null,
          },
        ],
        recurring_streams: [
          {
            merchant_name: "Electric Co",
            description: "Electric Co",
            average_amount: 90,
            frequency: "MONTHLY",
            category: "UTILITIES",
            stream_type: "outflow",
            is_active: true,
            plaid_item_id: "item-1",
            predicted_next_date: "2026-08-30",
          },
        ],
        transactions: [
          {
            id: "previous-electric-charge",
            date: "2026-07-30",
            amount: 90,
            merchant_name: "Electric Co",
            name: "Electric Co",
            pfc_primary: "UTILITIES",
            pfc_detailed: null,
            account_id: "acc-1",
            user_id: "user-1",
          },
        ],
      });

      const data = await getDashboardData(supabase as never, undefined, "2026-08", "user-1");

      expect(data.recurringStatuses).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "Electric Co", nextDate: "2026-08-30" }),
        ]),
      );
      expect(withinNextSevenDays(data.recurringStatuses, "2026-08-29")).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "Electric Co", nextDate: "2026-08-30" }),
        ]),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("aggregates household-scope spend per person with stream and merchant fallbacks", async () => {
    const supabase = makeSupabase({
      accounts: [
        {
          id: "acc-1",
          name: null,
          official_name: null,
          mask: null,
          type: "depository",
          subtype: "checking",
          current_balance: 1000,
          available_balance: 1000,
          credit_limit: null,
          iso_currency_code: "USD",
          plaid_item_id: "item-1",
          apr: null,
        },
        {
          id: "acc-2",
          name: "Card",
          official_name: null,
          mask: "1111",
          type: "credit",
          subtype: "credit card",
          current_balance: 500,
          available_balance: 0,
          credit_limit: 1000,
          iso_currency_code: "USD",
          plaid_item_id: "item-2",
          apr: null,
        },
        {
          id: "acc-3",
          name: "Invest",
          official_name: null,
          mask: null,
          type: "investment",
          subtype: null,
          current_balance: 2000,
          available_balance: null,
          credit_limit: null,
          iso_currency_code: "USD",
          plaid_item_id: "item-1",
          apr: null,
        },
        {
          id: "acc-4",
          name: "No Item",
          official_name: null,
          mask: null,
          type: "depository",
          subtype: "savings",
          current_balance: 300,
          available_balance: 300,
          credit_limit: null,
          iso_currency_code: "USD",
          plaid_item_id: null,
          apr: null,
        },
        {
          id: "acc-5",
          name: "Orphan Bank",
          official_name: null,
          mask: "2222",
          type: "depository",
          subtype: "checking",
          current_balance: 400,
          available_balance: 400,
          credit_limit: null,
          iso_currency_code: "USD",
          plaid_item_id: "item-999",
          apr: null,
        },
        {
          id: "acc-6",
          name: "Null Balance",
          official_name: null,
          mask: null,
          type: "depository",
          subtype: "savings",
          current_balance: null,
          available_balance: null,
          credit_limit: null,
          iso_currency_code: "USD",
          plaid_item_id: "item-1",
          apr: null,
        },
      ],
      recurring_streams: [
        {
          merchant_name: "Netflix",
          description: "Netflix",
          average_amount: 15.99,
          frequency: "monthly",
          category: "ENTERTAINMENT",
          stream_type: "outflow",
          is_active: true,
          plaid_item_id: "item-1",
        },
        {
          merchant_name: null,
          description: "Cloud Hosting",
          average_amount: null,
          frequency: "biweekly",
          category: "TECHNOLOGY",
          stream_type: "outflow",
          is_active: true,
          plaid_item_id: "item-2",
        },
        {
          merchant_name: null,
          description: null,
          average_amount: 7,
          frequency: "weekly",
          category: null,
          stream_type: "outflow",
          is_active: true,
          plaid_item_id: "item-1",
        },
        {
          merchant_name: "Payroll",
          description: null,
          average_amount: 2000,
          frequency: "yearly",
          category: "INCOME",
          stream_type: "inflow",
          is_active: true,
          plaid_item_id: "item-1",
        },
        {
          merchant_name: null,
          description: "Freelance",
          average_amount: 100,
          frequency: "quarterly",
          category: "INCOME",
          stream_type: "inflow",
          is_active: true,
          plaid_item_id: "item-1",
        },
        {
          merchant_name: null,
          description: null,
          average_amount: null,
          frequency: null,
          category: "INCOME",
          stream_type: "inflow",
          is_active: true,
          plaid_item_id: "item-1",
        },
        {
          merchant_name: "Coffee",
          description: null,
          average_amount: 25,
          frequency: "monthly",
          category: "FOOD_AND_DRINK",
          stream_type: "outflow",
          is_active: true,
          plaid_item_id: "item-1",
        },
      ],
      plaid_items: [
        { id: "item-1", institution_name: "Chase" },
        { id: "item-2", institution_name: "Citi" },
      ],
      budgets: [
        {
          category: "ENTERTAINMENT",
          monthly_limit: 100,
          group_name: "fixed",
          rollover_enabled: false,
        },
      ],
      net_worth_snapshots: [
        { snapshot_month: "2026-03-01", assets: null, liabilities: "2000" },
        { snapshot_month: "2026-04-01", assets: "10000", liabilities: null },
      ],
      sinking_funds: [
        {
          name: "Auto",
          target_amount: 600,
          due_date: "2026-11-01",
          cadence: "annual",
          custom_interval_months: null,
          cycle_anchor_date: "2025-11-01",
        },
        {
          name: "Soon",
          target_amount: 100,
          due_date: "2026-06-10",
        },
        {
          name: "Overdue",
          target_amount: 50,
          due_date: "2026-05-01",
        },
      ],
      category_overrides: [
        { source_category: "OLD_CAT", display_category: "NEW_CAT" },
      ],
      linked_refunds: [
        { charge_transaction_id: "none", refund_transaction_id: "none2" },
      ],
      linked_duplicates: [{ excluded_transaction_id: "none" }],
      transactions: [
        {
          id: "t1",
          date: "2026-05-03",
          amount: 100,
          merchant_name: "Netflix",
          name: null,
          pfc_primary: "ENTERTAINMENT",
          pfc_detailed: "ENTERTAINMENT_SUBSCRIPTION",
          account_id: "acc-1",
          user_id: "user-1",
        },
        {
          id: "t2",
          date: "2026-05-10",
          amount: 200,
          merchant_name: null,
          name: "GROCERY",
          pfc_primary: "FOOD_AND_DRINK",
          pfc_detailed: "FOOD_AND_DRINK_GROCERIES",
          account_id: "acc-2",
          user_id: "partner-2",
        },
        {
          id: "t3",
          date: "2026-05-15",
          amount: 50,
          merchant_name: null,
          name: null,
          pfc_primary: null,
          pfc_detailed: null,
          account_id: "acc-3",
          user_id: "user-1",
        },
        {
          id: "t4",
          date: "2026-05-20",
          amount: -500,
          merchant_name: "Refund",
          name: null,
          pfc_primary: "INCOME",
          pfc_detailed: "INCOME_WAGES",
          account_id: "acc-4",
          user_id: "user-1",
        },
        {
          id: "t5",
          date: "2026-05-25",
          amount: 25,
          merchant_name: "Coffee",
          name: null,
          pfc_primary: "FOOD_AND_DRINK",
          pfc_detailed: "FOOD_AND_DRINK_COFFEE",
          account_id: "acc-1",
          user_id: "partner-2",
        },
        {
          id: "t6",
          date: "2026-05-28",
          amount: 700,
          merchant_name: "Laptop",
          name: null,
          pfc_primary: "GENERAL_MERCHANDISE",
          pfc_detailed: "GENERAL_MERCHANDISE_OTHER",
          account_id: "acc-1",
          user_id: "user-1",
        },
        {
          id: "t7",
          date: "2026-04-02",
          amount: 90,
          merchant_name: "Coffee",
          name: null,
          pfc_primary: "FOOD_AND_DRINK",
          pfc_detailed: null,
          account_id: "acc-1",
          user_id: "user-1",
        },
        {
          id: "t8",
          date: "2026-04-09",
          amount: 85,
          merchant_name: "Coffee",
          name: null,
          pfc_primary: "FOOD_AND_DRINK",
          pfc_detailed: null,
          account_id: "acc-1",
          user_id: "user-1",
        },
        {
          id: "t9",
          date: "2026-04-15",
          amount: 60,
          merchant_name: "One Off",
          name: null,
          pfc_primary: "GENERAL_MERCHANDISE",
          pfc_detailed: null,
          account_id: "acc-1",
          user_id: "user-1",
        },
        {
          id: "t10",
          date: "2026-05-12",
          amount: 45,
          merchant_name: "Gas",
          name: null,
          pfc_primary: "TRANSPORTATION",
          pfc_detailed: null,
          account_id: "ghost",
          user_id: "user-1",
        },
        {
          id: "t11",
          date: "2026-05-18",
          amount: 30,
          merchant_name: "Orphan",
          name: null,
          pfc_primary: "FOOD_AND_DRINK",
          pfc_detailed: null,
          account_id: "acc-5",
          user_id: "user-1",
        },
        {
          id: "t12",
          date: "2026-05-08",
          amount: 22,
          merchant_name: "NullAcct",
          name: null,
          pfc_primary: "ENTERTAINMENT",
          pfc_detailed: null,
          account_id: null,
          user_id: "user-1",
        },
        {
          id: "t13",
          date: "2026-05-05",
          amount: 20,
          merchant_name: "Coffee",
          name: null,
          pfc_primary: "FOOD_AND_DRINK",
          pfc_detailed: "FOOD_AND_DRINK_COFFEE",
          account_id: "acc-1",
          user_id: "user-1",
        },
        {
          id: "t14",
          date: "2026-05-22",
          amount: 900,
          merchant_name: "Card Payment",
          name: null,
          pfc_primary: "LOAN_PAYMENTS",
          pfc_detailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
          account_id: "acc-1",
          user_id: "user-1",
        },
        {
          id: "t15",
          date: "2026-05-25",
          amount: 25,
          merchant_name: "Coffee",
          name: null,
          pfc_primary: "FOOD_AND_DRINK",
          pfc_detailed: "FOOD_AND_DRINK_COFFEE",
          account_id: "acc-1",
          user_id: "user-1",
        },
      ],
    });

    const data = await getDashboardData(
      supabase as never,
      undefined,
      "2026-05",
      "user-1",
      { scope: "household" },
    );

    expect(data.spendPerPerson).toEqual({ mine: 992, household: 225 });
    expect(data.currentMonthExpenses).toBe(1217);
    expect(data.currentMonthIncome).toBe(500);
    expect(data.cashFlow).toEqual({ deposits: 500, withdrawals: 1800, net: -1300 });
    expect(data.subscriptions.some((s) => s.merchant === "Netflix")).toBe(true);
    expect(data.subscriptions.some((s) => s.merchant === "Cloud Hosting")).toBe(true);
    expect(data.subscriptions.some((s) => s.merchant === "Unknown")).toBe(true);
    expect(data.subscriptions.some((s) => s.merchant === "Coffee")).toBe(true);
    expect(data.subscriptions.some((s) => s.amount === 0)).toBe(true);
    expect(data.incomeStreams.some((s) => s.merchant === "Payroll")).toBe(true);
    expect(data.incomeStreams.some((s) => s.merchant === "Freelance")).toBe(true);
    expect(data.incomeStreams.some((s) => s.merchant === "Unknown")).toBe(true);
    expect(data.spendPerCard.some((c) => c.name === "Unknown Account")).toBe(true);
    expect(data.spendPerCard.some((c) => c.name === "Card ••1111")).toBe(true);
    expect(data.spendPerCard.some((c) => c.name === "Account")).toBe(true);
    expect(data.spendPerBank.some((b) => b.name === "Unknown Bank")).toBe(true);
    expect(data.spendPerBank.some((b) => b.name === "Other Bank")).toBe(true);
    expect(data.spendPerBank.some((b) => b.name === "Chase")).toBe(true);
    expect(data.netWorthHistory).toEqual([
      { month: "2026-03", assets: 0, liabilities: 2000, netWorth: -2000 },
      { month: "2026-04", assets: 10000, liabilities: 0, netWorth: 10000 },
    ]);
    expect(data.syncIsStale).toBe(true);
    expect(data.lastSyncAgoMinutes).toBeNull();
    expect(data.insights.debt).not.toBeNull();
    expect(data.insights.debt?.usesAssumedApr).toBe(true);
    expect(data.insights.debt?.plan?.order).toEqual(["Card ••1111"]);
    expect(data.recurringStatuses.some((s) => s.name === "Coffee" && s.status === "paid")).toBe(true);
  });

  it("keeps spendPerPerson null in household scope when only the user's rows exist", async () => {
    const supabase = makeSupabase({
      accounts: [
        {
          id: "acc-1",
          name: "Checking",
          official_name: null,
          mask: null,
          type: "depository",
          subtype: "checking",
          current_balance: 1000,
          available_balance: 1000,
          credit_limit: null,
          iso_currency_code: "USD",
          plaid_item_id: "item-1",
          apr: null,
        },
      ],
      plaid_items: [{ id: "item-1", institution_name: "Chase" }],
      transactions: [
        {
          id: "t1",
          date: "2026-05-03",
          amount: 100,
          merchant_name: "Netflix",
          name: null,
          pfc_primary: "ENTERTAINMENT",
          pfc_detailed: null,
          account_id: "acc-1",
          user_id: "user-1",
        },
      ],
    });

    const data = await getDashboardData(
      supabase as never,
      undefined,
      "2026-05",
      "user-1",
      { scope: "household" },
    );

    expect(data.spendPerPerson).toBeNull();
  });

  it("builds debt plans with mask and name fallbacks and assumed APR", async () => {
    const supabase = makeSupabase({
      accounts: [
        {
          id: "acc-1",
          name: null,
          official_name: null,
          mask: null,
          type: "credit",
          subtype: "credit card",
          current_balance: 300,
          available_balance: 0,
          credit_limit: 2000,
          iso_currency_code: "USD",
          plaid_item_id: "item-1",
          apr: null,
        },
        {
          id: "acc-2",
          name: "Clear Card",
          official_name: null,
          mask: null,
          type: "credit",
          subtype: "credit card",
          current_balance: 0,
          available_balance: 1000,
          credit_limit: 2000,
          iso_currency_code: "USD",
          plaid_item_id: "item-1",
          apr: null,
        },
        {
          id: "acc-3",
          name: "No Mask",
          official_name: null,
          mask: null,
          type: "credit",
          subtype: "credit card",
          current_balance: 150,
          available_balance: 0,
          credit_limit: 2000,
          iso_currency_code: "USD",
          plaid_item_id: "item-1",
          apr: 18,
        },
      ],
      plaid_items: [{ id: "item-1", institution_name: "Chase" }],
      transactions: [],
    });

    const data = await getDashboardData(
      supabase as never,
      undefined,
      "2026-05",
      "user-1",
    );

    expect(data.insights.debt?.usesAssumedApr).toBe(true);
    expect(data.insights.debt?.plan?.order).toEqual(["Card", "No Mask"]);
    expect(data.creditAccounts).toHaveLength(3);
  });

  it("applies itemId and selectedAccountId filters and stale sync detection", async () => {
    const now = new Date();
    const currentMonth = now.toISOString().slice(0, 7);
    const today = now.getDate();
    const lastMonth = shiftMonthKey(currentMonth, -1);
    const staleSync = new Date(Date.now() - 49 * 3600 * 1000).toISOString();

    const supabase = makeSupabase({
      accounts: [
        {
          id: "acc-1",
          name: "Checking",
          official_name: null,
          mask: "1234",
          type: "depository",
          subtype: "checking",
          current_balance: 5000,
          available_balance: 5000,
          credit_limit: null,
          iso_currency_code: "USD",
          plaid_item_id: "item-1",
          apr: null,
        },
        {
          id: "acc-2",
          name: "Card",
          official_name: null,
          mask: "9999",
          type: "credit",
          subtype: "credit card",
          current_balance: 800,
          available_balance: 200,
          credit_limit: 5000,
          iso_currency_code: "USD",
          plaid_item_id: "item-2",
          apr: 21.99,
        },
        {
          id: "acc-3",
          name: "Zero Card",
          official_name: null,
          mask: null,
          type: "credit",
          subtype: "credit card",
          current_balance: 0,
          available_balance: 1000,
          credit_limit: 5000,
          iso_currency_code: "USD",
          plaid_item_id: "item-2",
          apr: null,
        },
        {
          id: "acc-4",
          name: "Null Card",
          official_name: null,
          mask: null,
          type: "credit",
          subtype: "credit card",
          current_balance: null,
          available_balance: null,
          credit_limit: null,
          iso_currency_code: "USD",
          plaid_item_id: "item-2",
          apr: null,
        },
      ],
      recurring_streams: [
        {
          merchant_name: "Netflix",
          description: "Netflix",
          average_amount: 15.99,
          frequency: "monthly",
          category: "ENTERTAINMENT",
          stream_type: "outflow",
          is_active: true,
          plaid_item_id: "item-1",
        },
        {
          merchant_name: "Hulu",
          description: "Hulu",
          average_amount: 12,
          frequency: "monthly",
          category: "ENTERTAINMENT",
          stream_type: "outflow",
          is_active: true,
          plaid_item_id: "item-2",
        },
      ],
      plaid_items: [{ id: "item-1", institution_name: "Chase" }],
      sync_jobs: [{ updated_at: staleSync }],
      transactions: [
        {
          id: "t1",
          date: `${currentMonth}-05`,
          amount: 15.99,
          merchant_name: "Netflix",
          name: null,
          pfc_primary: "ENTERTAINMENT",
          pfc_detailed: null,
          account_id: "acc-1",
          user_id: "user-1",
        },
        {
          id: "t2",
          date: `${lastMonth}-01`,
          amount: 100,
          merchant_name: "Prior",
          name: null,
          pfc_primary: "FOOD_AND_DRINK",
          pfc_detailed: null,
          account_id: "acc-1",
          user_id: "user-1",
        },
        {
          id: "t3",
          date: `${lastMonth}-${String(today + 2).padStart(2, "0")}`,
          amount: 200,
          merchant_name: "Later",
          name: null,
          pfc_primary: "FOOD_AND_DRINK",
          pfc_detailed: null,
          account_id: "acc-1",
          user_id: "user-1",
        },
        {
          id: "t4",
          date: `${currentMonth}-10`,
          amount: 50,
          merchant_name: "Card Spend",
          name: null,
          pfc_primary: "GENERAL_MERCHANDISE",
          pfc_detailed: null,
          account_id: "acc-2",
          user_id: "user-1",
        },
      ],
    });

    const data = await getDashboardData(
      supabase as never,
      "acc-1",
      currentMonth,
      "user-1",
      { itemId: "item-1" },
    );

    expect(data.subscriptions.map((s) => s.merchant)).toEqual(["Netflix"]);
    expect(data.spendPerBank[0]?.name).toBe("Chase");
    expect(data.syncIsStale).toBe(true);
    expect(data.lastSyncAgoMinutes).toBeGreaterThan(2800);
    expect(data.insights.debt?.usesAssumedApr).toBe(false);
    expect(data.insights.debt?.plan?.order).toEqual(["Card ••9999"]);
  });

  it("builds category and merchant drilldowns and drops unknown drills", async () => {
    const mk = (seeds: Record<string, unknown>) => makeSupabase(seeds);
    const base = {
      accounts: [
        {
          id: "acc-1",
          name: "Checking",
          official_name: null,
          mask: null,
          type: "depository",
          subtype: "checking",
          current_balance: 1000,
          available_balance: 1000,
          credit_limit: null,
          iso_currency_code: "USD",
          plaid_item_id: "item-1",
          apr: null,
        },
      ],
      plaid_items: [{ id: "item-1", institution_name: "Chase" }],
      transaction_splits: [
        { transaction_id: "t1", category: "GROCERIES", amount: 150 },
      ],
      transactions: [
        {
          id: "t1",
          date: "2026-05-15",
          amount: 150,
          merchant_name: "Trader Joes",
          name: null,
          pfc_primary: "FOOD_AND_DRINK",
          pfc_detailed: "FOOD_AND_DRINK_GROCERIES",
          account_id: "acc-1",
          user_id: "user-1",
        },
        {
          id: "t2",
          date: "2026-05-20",
          amount: 40,
          merchant_name: "Misc",
          name: null,
          pfc_primary: null,
          pfc_detailed: null,
          account_id: "acc-1",
          user_id: "user-1",
        },
        {
          id: "t3",
          date: "2026-04-10",
          amount: 120,
          merchant_name: "Trader Joes",
          name: null,
          pfc_primary: "FOOD_AND_DRINK",
          pfc_detailed: "FOOD_AND_DRINK_GROCERIES",
          account_id: "acc-1",
          user_id: "user-1",
        },
      ],
    };

    const byCategory = await getDashboardData(
      mk(base) as never,
      undefined,
      "2026-05",
      "user-1",
      { drill: { category: "FOOD_AND_DRINK", sub: "FOOD_AND_DRINK_GROCERIES" } },
    );
    expect(byCategory.drilldown?.kind).toBe("category");

    const uncategorized = await getDashboardData(
      mk(base) as never,
      undefined,
      "2026-05",
      "user-1",
      { drill: { category: "UNCATEGORIZED" } },
    );
    expect(uncategorized.drilldown?.kind).toBe("category");

    const byMerchant = await getDashboardData(
      mk(base) as never,
      undefined,
      "2026-05",
      "user-1",
      { drill: { merchant: "Trader Joes" } },
    );
    expect(byMerchant.drilldown?.kind).toBe("merchant");
    expect(byMerchant.drillableMerchants).toContain("trader joes");

    const unknown = await getDashboardData(
      mk(base) as never,
      undefined,
      "2026-05",
      "user-1",
      { drill: { merchant: "No Such Merchant" } },
    );
    expect(unknown.drilldown).toBeUndefined();

    const otherCategory = await getDashboardData(
      mk(base) as never,
      undefined,
      "2026-05",
      "user-1",
      { drill: { category: "_other" } },
    );
    expect(otherCategory.drilldown).toBeUndefined();
  });
});

describe("computeCumulativeSpendByDay", () => {
  function canon(
    date: string,
    amount: number,
    flow: "expense" | "income" | "transfer" = "expense",
  ): CanonicalFinanceTransaction {
    return {
      id: `id-${date}-${amount}-${flow}`,
      sourceTransactionId: `s-${date}-${amount}`,
      date,
      signedAmount: amount,
      flow,
      merchant: "Merchant",
      groupKey: "FOOD_AND_DRINK",
      categoryKey: "food_and_drink",
      accountId: "acct-1",
      manualAccountId: null,
      pending: false,
      source: "plaid",
    };
  }

  it("accumulates spending day by day and caps thisMonth at today", () => {
    const days = computeCumulativeSpendByDay(
      [canon("2026-07-01", 10), canon("2026-07-03", 20), canon("2026-07-05", 5)],
      "2026-07",
      "2026-07-31",
    );
    expect(days[0]!.thisMonth).toBe(10);
    expect(days[2]!.thisMonth).toBe(30);
    expect(days[4]!.thisMonth).toBe(35);
    expect(days[30]!.thisMonth).toBe(35);
    expect(days[30]!.lastMonth).toBeNull();
    expect(days[29]!.lastMonth).toBe(0);
  });

  it("ignores income, transfers, and out-of-month rows", () => {
    const days = computeCumulativeSpendByDay(
      [
        canon("2026-07-02", -100, "income"),
        canon("2026-07-03", 50, "transfer"),
        canon("2026-06-30", 500),
        canon("2026-08-01", 500),
      ],
      "2026-07",
      "2026-07-31",
    );
    expect(days.at(-1)!.thisMonth).toBe(0);
  });

  it("skips invalid day numbers including day 0, day 32, and non-integers", () => {
    const days = computeCumulativeSpendByDay(
      [
        canon("2026-07-00", 10),
        canon("2026-07-32", 20),
        canon("2026-07-1a", 30),
        canon("2026-07-05", 100),
      ],
      "2026-07",
      "2026-07-31",
    );
    expect(days.at(-1)!.thisMonth).toBe(100);
  });

  it("nulls thisMonth after today and lastMonth past the previous month's end", () => {
    const days = computeCumulativeSpendByDay(
      [canon("2026-03-01", 10), canon("2026-03-03", 20)],
      "2026-03",
      "2026-03-05",
    );
    expect(days[0]!.thisMonth).toBe(10);
    expect(days[2]!.thisMonth).toBe(30);
    expect(days[4]!.thisMonth).toBe(30);
    expect(days[5]!.thisMonth).toBeNull();
    expect(days[27]!.lastMonth).toBe(0);
    expect(days[28]!.lastMonth).toBeNull();
    expect(days[30]!.lastMonth).toBeNull();
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

  it("handles null merchant_name and null name fallback across income and spending streams", async () => {
    const supabase = makeSupabase({
      accounts: [
        { id: "a1", name: "Checking", type: "depository", current_balance: 1000, iso_currency_code: "USD" },
      ],
      transactions: [
        // Income with name but no merchant_name
        { id: "t1", date: "2026-08-05", amount: -3000, name: "Payroll Direct", merchant_name: null, pfc_primary: "INCOME" },
        // Income with neither name nor merchant_name
        { id: "t2", date: "2026-08-10", amount: -500, name: null, merchant_name: null, pfc_primary: "INCOME" },
        // Spending with name but no merchant_name
        { id: "t3", date: "2026-08-12", amount: 150, name: "Coffee Shop", merchant_name: null, pfc_primary: "FOOD_AND_DRINK" },
        // Spending with neither name nor merchant_name
        { id: "t4", date: "2026-08-14", amount: 80, name: null, merchant_name: null, pfc_primary: "GENERAL_MERCHANDISE" },
        // Spending with merchant_name but no name (tests t.name ?? t.merchant_name ?? "txn")
        { id: "t5", date: "2026-08-15", amount: 600, name: null, merchant_name: "Hardware Store", pfc_primary: "HOME_IMPROVEMENT" },
        // Prior month spending with name only
        { id: "t6", date: "2026-07-10", amount: 140, name: "Coffee Shop", merchant_name: null, pfc_primary: "FOOD_AND_DRINK" },
        // Prior month spending with neither
        { id: "t7", date: "2026-07-15", amount: 75, name: null, merchant_name: null, pfc_primary: "GENERAL_MERCHANDISE" },
      ],
    });

    const data = await getDashboardData(supabase as never, undefined, "2026-08", "u-1");
    expect(data.accounts).toHaveLength(1);
    expect(data.currentMonthIncome).toBe(3500);
    expect(data.currentMonthExpenses).toBe(830);
    expect(data.spendingAnomalies).toBeDefined();

    // Verify 6-month window ends on active month (2026-08) and never includes next month (2026-09)
    const monthKeys = data.monthlySpending.map((m) => m.month);
    expect(monthKeys).toEqual([
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
    ]);
  });
});
