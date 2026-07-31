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
    expect(data.insights.runwayMonths).toBeDefined();
  });
});
