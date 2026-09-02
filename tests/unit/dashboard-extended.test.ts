import { describe, it, expect, vi, beforeEach } from "vitest";
import { getDashboardData } from "@/lib/dashboard";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("lib/dashboard extended features", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calculates spendPerPerson for household scope and debt payoff plan for credit accounts", async () => {
    const rawAccounts = [
      {
        id: "acc-1",
        user_id: "user-1",
        plaid_account_id: "p-acc-1",
        name: "Freedom Unlimited",
        official_name: "Chase Freedom",
        mask: "9999",
        type: "credit",
        subtype: "credit card",
        current_balance: 1500,
        available_balance: 3500,
        credit_limit: 5000,
        iso_currency_code: "USD",
        apr: null,
      },
    ];

    const rawTxns = [
      {
        id: "t-1",
        user_id: "user-1",
        account_id: "acc-1",
        plaid_transaction_id: "pt-1",
        amount: 150,
        iso_currency_code: "USD",
        date: "2026-07-15",
        name: "Grocery Store",
        merchant_name: "Trader Joes",
        pfc_primary: "FOOD_AND_DRINK",
        pfc_detailed: "FOOD_AND_DRINK_GROCERIES",
        payment_channel: "in store",
        pending: false,
      },
      {
        id: "t-2",
        user_id: "partner-2",
        account_id: "acc-1",
        plaid_transaction_id: "pt-2",
        amount: 250,
        iso_currency_code: "USD",
        date: "2026-07-18",
        name: "Partner Spend",
        merchant_name: "Target",
        pfc_primary: "SHOPS",
        pfc_detailed: "SHOPS_SUPERSTORE",
        payment_channel: "in store",
        pending: false,
      },
      {
        id: "t-3",
        user_id: "user-1",
        account_id: "acc-1",
        plaid_transaction_id: "pt-3",
        amount: 100,
        iso_currency_code: "USD",
        date: "2026-06-15",
        name: "Trader Joes",
        merchant_name: "Trader Joes",
        pfc_primary: "FOOD_AND_DRINK",
        pfc_detailed: "FOOD_AND_DRINK_GROCERIES",
        payment_channel: "in store",
        pending: false,
      },
      {
        id: "t-4",
        user_id: "user-1",
        account_id: "acc-1",
        plaid_transaction_id: "pt-4",
        amount: 110,
        iso_currency_code: "USD",
        date: "2026-05-15",
        name: "Trader Joes",
        merchant_name: "Trader Joes",
        pfc_primary: "FOOD_AND_DRINK",
        pfc_detailed: "FOOD_AND_DRINK_GROCERIES",
        payment_channel: "in store",
        pending: false,
      },
    ];

    const createChainableMock = (resolvedData: unknown = []) => {
      const chain: Record<string, unknown> = {};
      const returnSelf = () => chain;
      const resolveData = () => Promise.resolve({ data: resolvedData, error: null });

      chain.select = returnSelf;
      chain.eq = returnSelf;
      chain.gte = returnSelf;
      chain.lt = returnSelf;
      chain.in = returnSelf;
      chain.order = returnSelf;
      chain.range = returnSelf;
      chain.limit = returnSelf;
      chain.maybeSingle = () =>
        Promise.resolve({
          data: Array.isArray(resolvedData) ? resolvedData[0] ?? null : resolvedData,
          error: null,
        });
      chain.single = chain.maybeSingle;
      chain.then = (onfulfilled: (res: { data: unknown; error: null }) => unknown) =>
        resolveData().then(onfulfilled);
      return chain;
    };

    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "accounts") return createChainableMock(rawAccounts);
        if (table === "transactions") return createChainableMock(rawTxns);
        if (table === "recurring_streams") {
          return createChainableMock([
            {
              stream_id: "r-1",
              description: "Trader Joes",
              merchant_name: "Trader Joes",
              last_amount: 100,
              frequency: "MONTHLY",
              is_active: true,
            },
          ]);
        }
        return createChainableMock([]);
      }),
    } as unknown as SupabaseClient;

    const data = await getDashboardData(
      mockSupabase,
      undefined,
      "2026-07",
      "user-1",
      { scope: "household" },
    );

    expect(data).toBeDefined();
    expect(data.spendPerPerson).toEqual({ mine: 150, household: 250 });
    expect(data.insights.debt).not.toBeNull();
    expect(data.insights.debt?.usesAssumedApr).toBe(true);
  });

  it("handles account filter, manual accounts, and sinking funds in getDashboardData", async () => {
    const rawAccounts = [
      {
        id: "acc-1",
        user_id: "user-1",
        plaid_account_id: "p-acc-1",
        name: "Checking",
        official_name: "Chase Checking",
        mask: "1234",
        type: "depository",
        subtype: "checking",
        current_balance: 5000,
        available_balance: 5000,
        credit_limit: null,
        iso_currency_code: "USD",
        apr: null,
      },
    ];

    const rawManualAccounts = [
      {
        id: "macc-1",
        user_id: "user-1",
        name: "Crypto Wallet",
        account_type: "investment",
        balance: 10000,
        currency: "USD",
        apr: null,
      },
    ];

    const rawManualTxns = [
      {
        id: "mt-1",
        user_id: "user-1",
        manual_account_id: "macc-1",
        amount: -2000,
        date: "2026-07-01",
        name: "Salary",
        category: "INCOME",
      },
    ];

    const createChainableMock = (resolvedData: unknown = []) => {
      const chain: Record<string, unknown> = {};
      const returnSelf = () => chain;
      const resolveData = () => Promise.resolve({ data: resolvedData, error: null });

      chain.select = returnSelf;
      chain.eq = returnSelf;
      chain.gte = returnSelf;
      chain.lt = returnSelf;
      chain.in = returnSelf;
      chain.order = returnSelf;
      chain.range = returnSelf;
      chain.limit = returnSelf;
      chain.maybeSingle = () =>
        Promise.resolve({
          data: Array.isArray(resolvedData) ? resolvedData[0] ?? null : resolvedData,
          error: null,
        });
      chain.single = chain.maybeSingle;
      chain.then = (onfulfilled: (res: { data: unknown; error: null }) => unknown) =>
        resolveData().then(onfulfilled);
      return chain;
    };

    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "accounts") return createChainableMock(rawAccounts);
        if (table === "manual_accounts") return createChainableMock(rawManualAccounts);
        if (table === "manual_transactions") return createChainableMock(rawManualTxns);
        if (table === "goals") {
          return createChainableMock([
            { id: "g-1", name: "Emergency Fund", target_amount: 10000, current_amount: 4000, target_date: "2026-12-31" },
          ]);
        }
        if (table === "account_snapshots") {
          return createChainableMock([
            { snapshot_month: "2026-06-01", assets: 10000, liabilities: 2000 },
            { snapshot_month: "2026-07-01", assets: 12000, liabilities: 1500 },
          ]);
        }
        if (table === "budget_targets" || table === "budget_envelopes") {
          return createChainableMock([
            { category: "FOOD_AND_DRINK", amount: 500 },
          ]);
        }
        if (table === "sinking_funds") {
          return createChainableMock([{
            name: "Insurance",
            target_amount: 1200,
            due_date: "2025-01-31",
            cadence: "annual",
            custom_interval_months: null,
            cycle_anchor_date: "2025-01-31",
          }]);
        }
        return createChainableMock([]);
      }),
    } as unknown as SupabaseClient;

    const data = await getDashboardData(
      mockSupabase,
      "acc-1",
      "2026-07",
      "user-1",
      { scope: "mine" },
    );

    expect(data).toBeDefined();
    expect(data.accounts).toHaveLength(1);
    expect(data.insights.sinkingFunds).toBeDefined();
    expect(data.insights.sinkingFunds.items[0]).toMatchObject({
      dueDate: "2027-01-31",
      monthlySetAside: expect.any(Number),
    });
    expect(data.insights.sinkingFunds.items[0]!.monthlySetAside).toBeGreaterThan(0);
    expect(data.insights.runwayMonths).toBeDefined();
  });

  it("handles category and merchant drilldown options in getDashboardData", async () => {
    const rawAccounts = [
      {
        id: "acc-1",
        user_id: "user-1",
        plaid_account_id: "p-acc-1",
        name: "Checking",
        type: "depository",
        subtype: "checking",
        current_balance: 5000,
        available_balance: 5000,
        credit_limit: null,
        iso_currency_code: "USD",
        apr: null,
      },
    ];

    const rawTxns = [
      {
        id: "t-1",
        user_id: "user-1",
        account_id: "acc-1",
        plaid_transaction_id: "pt-1",
        amount: 150,
        iso_currency_code: "USD",
        date: "2026-07-15",
        name: "Trader Joes",
        merchant_name: "Trader Joes",
        pfc_primary: "FOOD_AND_DRINK",
        pfc_detailed: "FOOD_AND_DRINK_GROCERIES",
        pending: false,
      },
    ];

    const createChainableMock = (resolvedData: unknown = []) => {
      const chain: Record<string, unknown> = {};
      const returnSelf = () => chain;
      const resolveData = () => Promise.resolve({ data: resolvedData, error: null });

      chain.select = returnSelf;
      chain.eq = returnSelf;
      chain.gte = returnSelf;
      chain.lt = returnSelf;
      chain.in = returnSelf;
      chain.order = returnSelf;
      chain.range = returnSelf;
      chain.limit = returnSelf;
      chain.maybeSingle = () =>
        Promise.resolve({
          data: Array.isArray(resolvedData) ? resolvedData[0] ?? null : resolvedData,
          error: null,
        });
      chain.single = chain.maybeSingle;
      chain.then = (onfulfilled: (res: { data: unknown; error: null }) => unknown) =>
        resolveData().then(onfulfilled);
      return chain;
    };

    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "accounts") return createChainableMock(rawAccounts);
        if (table === "transactions") return createChainableMock(rawTxns);
        return createChainableMock([]);
      }),
    } as unknown as SupabaseClient;

    const catData = await getDashboardData(
      mockSupabase,
      undefined,
      "2026-07",
      "user-1",
      { drill: { category: "FOOD_AND_DRINK", sub: "FOOD_AND_DRINK_GROCERIES" } },
    );
    expect(catData.drilldown).toBeDefined();

    const merchData = await getDashboardData(
      mockSupabase,
      undefined,
      "2026-07",
      "user-1",
      { drill: { merchant: "Trader Joes" } },
    );
    expect(merchData.drilldown).toBeDefined();
  });

  it("handles itemId option, manual accounts, stream description fallbacks, and sync job metrics", async () => {
    const rawAccounts = [
      {
        id: "acc-1",
        user_id: "user-1",
        plaid_account_id: "p-acc-1",
        name: "Card",
        type: "credit",
        subtype: "credit card",
        current_balance: 1200,
        available_balance: 3800,
        credit_limit: 5000,
        iso_currency_code: "USD",
        apr: 21.99,
        mask: "4321",
        item_id: "item-1",
      },
    ];

    const rawManualAccounts = [
      {
        id: "macc-1",
        user_id: "user-1",
        name: "Custom Investment",
        account_type: "investment",
        balance: 15000,
        currency: "USD",
      },
    ];

    const rawManualTxns = [
      {
        id: "mt-1",
        user_id: "user-1",
        manual_account_id: "macc-1",
        amount: 250,
        date: "2026-07-10",
        name: "Stock Dividend",
        merchant_name: null,
        category: null,
      },
    ];

    const rawStreams = [
      {
        id: "s-1",
        user_id: "user-1",
        merchant_name: null,
        description: "Cloud Hosting",
        average_amount: null,
        last_amount: 45,
        frequency: "MONTHLY",
        stream_type: "outflow",
        is_active: true,
        account_id: "acc-1",
      },
    ];

    const rawSyncJob = {
      id: "job-1",
      updated_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    };

    const createChainableMock = (resolvedData: unknown = []) => {
      const chain: Record<string, unknown> = {};
      const returnSelf = () => chain;
      const resolveData = () => Promise.resolve({ data: resolvedData, error: null });

      chain.select = returnSelf;
      chain.eq = returnSelf;
      chain.gte = returnSelf;
      chain.lt = returnSelf;
      chain.in = returnSelf;
      chain.order = returnSelf;
      chain.range = returnSelf;
      chain.limit = returnSelf;
      chain.maybeSingle = () =>
        Promise.resolve({
          data: Array.isArray(resolvedData) ? resolvedData[0] ?? null : resolvedData,
          error: null,
        });
      chain.single = chain.maybeSingle;
      chain.then = (onfulfilled: (res: { data: unknown; error: null }) => unknown) =>
        resolveData().then(onfulfilled);
      return chain;
    };

    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "accounts") return createChainableMock(rawAccounts);
        if (table === "manual_accounts") return createChainableMock(rawManualAccounts);
        if (table === "manual_transactions") return createChainableMock(rawManualTxns);
        if (table === "recurring_streams") return createChainableMock(rawStreams);
        if (table === "sync_jobs") return createChainableMock([rawSyncJob]);
        return createChainableMock([]);
      }),
    } as unknown as SupabaseClient;

    const data = await getDashboardData(
      mockSupabase,
      undefined,
      "2026-07",
      "user-1",
      { itemId: "item-1" },
    );

    expect(data.lastSyncAgoMinutes).toBeLessThan(15);
    expect(data.insights.debt?.usesAssumedApr).toBe(false);
  });
});
