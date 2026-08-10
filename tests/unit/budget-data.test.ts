import { describe, expect, it } from "vitest";
import { loadBudgetData } from "@/lib/budget-data";
import { clientStub } from "../fixtures/supabase-query";

const transactions = [
  {
    id: "usd-expense",
    user_id: "user-1",
    account_id: "usd-account",
    plaid_transaction_id: "plaid-usd",
    date: "2026-07-10",
    amount: 100,
    merchant_name: "Market",
    name: "MARKET",
    pfc_primary: "FOOD_AND_DRINK",
    pfc_detailed: "GROCERIES",
    pending: false,
  },
  {
    id: "cad-expense",
    user_id: "user-1",
    account_id: "cad-account",
    plaid_transaction_id: "plaid-cad",
    date: "2026-07-11",
    amount: 200,
    merchant_name: "Market",
    name: "MARKET",
    pfc_primary: "FOOD_AND_DRINK",
    pfc_detailed: "GROCERIES",
    pending: false,
  },
];

function makeClient(
  overrides: Record<string, { data?: unknown; error?: unknown }> = {},
) {
  return clientStub({
    households: { data: [{ id: "household-1" }] },
    budgets: {
      data: [
        {
          id: "budget-1",
          category: "GROCERIES",
          monthly_limit: 500,
          group_name: "flexible",
          rollover_enabled: false,
          sort_order: 0,
        },
      ],
    },
    budget_periods: { data: [] },
    sinking_funds: { data: [] },
    recurring_streams: { data: [] },
    sync_jobs: { data: { updated_at: "2026-07-29T10:00:00.000Z" } },
    transactions: { data: transactions },
    accounts: {
      data: [
        {
          id: "usd-account",
          name: "USD Checking",
          iso_currency_code: "usd",
        },
        {
          id: "cad-account",
          name: "CAD Checking",
          iso_currency_code: "cad",
        },
      ],
    },
    merchant_rules: { data: [] },
    category_overrides: { data: [] },
    transaction_splits: { data: [] },
    linked_refunds: { data: [] },
    ...overrides,
  });
}

describe("loadBudgetData", () => {
  it("loads Mine data with owner filters, a bounded window, and one selected currency", async () => {
    const supabase = makeClient();
    const result = await loadBudgetData(supabase as never, {
      userId: "user-1",
      anchorMonth: "2026-07",
      horizon: "monthly",
      rawScope: "mine",
      requestedCurrency: "CAD",
      now: new Date("2026-07-29T12:00:00.000Z"),
    });

    for (const table of [
      "budgets",
      "budget_periods",
      "sinking_funds",
      "recurring_streams",
      "sync_jobs",
      "transactions",
      "accounts",
      "merchant_rules",
      "category_overrides",
      "transaction_splits",
      "linked_refunds",
    ]) {
      expect(supabase.scopedToUser(table, "user-1")).toBe(true);
    }
    expect(supabase.callsOn("transactions")).toEqual(
      expect.arrayContaining([
        { method: "gte", args: ["date", "2026-04-01"] },
        { method: "lt", args: ["date", "2026-08-01"] },
      ]),
    );
    expect(result.visibleHouseholdIds).toEqual(["household-1"]);
    expect(result.currencies).toEqual(["CAD", "USD"]);
    expect(result.selectedCurrency).toBe("CAD");
    expect(result.view.horizon).toBe("monthly");
    if (result.view.horizon !== "monthly") throw new Error("wrong horizon");
    expect(result.view.month.totalExpenses.actual).toBe(200);
    expect(result.stale).toBe(false);
  });

  it("validates Household scope through visible ids and leaves visibility to RLS", async () => {
    const supabase = makeClient();
    await loadBudgetData(supabase as never, {
      userId: "user-1",
      anchorMonth: "2026-07",
      horizon: "yearly",
      rawScope: "household-1",
      now: new Date("2026-07-29T12:00:00.000Z"),
    });

    for (const table of [
      "budgets",
      "budget_periods",
      "transactions",
      "accounts",
      "merchant_rules",
      "category_overrides",
      "transaction_splits",
      "linked_refunds",
    ]) {
      expect(supabase.scopedToUser(table, "user-1")).toBe(false);
    }
    expect(supabase.callsOn("transactions")).toEqual(
      expect.arrayContaining([
        { method: "gte", args: ["date", "2025-12-01"] },
        { method: "lt", args: ["date", "2027-01-01"] },
      ]),
    );
  });

  it("falls back from guessed scope and currency values without combining currencies", async () => {
    const supabase = makeClient();
    const result = await loadBudgetData(supabase as never, {
      userId: "user-1",
      anchorMonth: "2026-07",
      horizon: "monthly",
      rawScope: "guessed-household",
      requestedCurrency: "EUR",
      now: new Date("2026-07-29T12:00:00.000Z"),
    });

    expect(supabase.scopedToUser("budgets", "user-1")).toBe(true);
    expect(result.selectedCurrency).toBe("CAD");
    expect(result.view.horizon).toBe("monthly");
    if (result.view.horizon !== "monthly") throw new Error("wrong horizon");
    expect(result.view.month.totalExpenses.actual).toBe(200);
  });

  it("reports missing sync metadata as stale and dependency failures safely", async () => {
    const staleClient = makeClient({
      sync_jobs: { data: null },
      transactions: { data: [] },
      accounts: { data: [] },
    });
    const result = await loadBudgetData(staleClient as never, {
      userId: "user-1",
      anchorMonth: "2026-07",
      horizon: "monthly",
      now: new Date("2026-07-29T12:00:00.000Z"),
    });
    expect(result.stale).toBe(true);

    const failedClient = makeClient({
      budgets: { data: null, error: { code: "42501" } },
      transactions: { data: [] },
      accounts: { data: [] },
    });

    await expect(
      loadBudgetData(failedClient as never, {
        userId: "user-1",
        anchorMonth: "2026-07",
        horizon: "monthly",
      }),
    ).rejects.toThrow("budget_query_failed:budgets:42501");
  });

  it("handles recurring categories matching trailing complete transactions", async () => {
    const supabase = makeClient({
      recurring_streams: { data: [{ category: "FOOD_AND_DRINK" }] },
      transactions: {
        data: [
          {
            id: "tx-trailing",
            user_id: "user-1",
            account_id: "usd-account",
            plaid_transaction_id: "p-tr",
            date: "2026-06-15",
            amount: 120,
            merchant_name: "Supermarket",
            name: "SUPERMARKET",
            pfc_primary: "FOOD_AND_DRINK",
            pfc_detailed: "GROCERIES",
            pending: false,
          },
        ],
      },
    });

    const result = await loadBudgetData(supabase as never, {
      userId: "user-1",
      anchorMonth: "2026-07",
      horizon: "monthly",
      requestedCurrency: "USD",
      now: new Date("2026-07-29T12:00:00.000Z"),
    });

    expect(result).toBeDefined();
  });

  it("loads recurrence fields and advances a past annual sinking fund", async () => {
    const supabase = makeClient({
      sinking_funds: {
        data: [{
          name: "Insurance",
          target_amount: 1200,
          due_date: "2025-01-31",
          cadence: "annual",
          custom_interval_months: null,
          cycle_anchor_date: "2025-01-31",
        }],
      },
    });

    const result = await loadBudgetData(supabase as never, {
      userId: "user-1",
      anchorMonth: "2026-02",
      horizon: "monthly",
      now: new Date("2026-02-01T12:00:00.000Z"),
    });

    expect(supabase.callsOn("sinking_funds")).toContainEqual({
      method: "select",
      args: [
        "name,target_amount,due_date,cadence,custom_interval_months,cycle_anchor_date",
      ],
    });
    expect(result.view.horizon).toBe("monthly");
    if (result.view.horizon !== "monthly") throw new Error("wrong horizon");
    expect(result.view.month.sinkingFundsTotal).toBe(100);
  });
});
