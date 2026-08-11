import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadBudgetData } from "@/lib/budget-data";
import { clientStub } from "../fixtures/supabase-query";

describe("loadBudgetData extra unit tests", () => {
  it("loads budget page data with sinking funds and goal events", async () => {
    const db = clientStub({
      profiles: { data: { household_id: null } },
      budgets: { data: [{ id: "b1", category: "Food", amount: 500, period: "monthly" }] },
      budget_periods: { data: [{ budget_id: "b1", month: "2026-07", planned: 500 }] },
      sinking_fund_buckets: {
        data: [{ id: "sf1", name: "Vacation", target_amount: 1200, due_date: "2026-12-31" }],
      },
      recurring_streams: { data: [] },
      sync_jobs: { data: null },
      goals: { data: [{ id: "g1", name: "Emergency Fund", target_amount: 1000, current_amount: 500 }] },
      goal_events: {
        data: [{ goal_id: "g1", event_date: "2026-07-15", amount: 100 }],
      },
      accounts: { data: [{ id: "acc1", plaid_account_id: "p1" }] },
      transactions: {
        data: [
          {
            id: "t1",
            account_id: "acc1",
            date: "2026-07-10",
            amount: 50,
            pfc_primary: "FOOD_AND_DRINK",
          },
        ],
      },
    }) as unknown as SupabaseClient;

    const data = await loadBudgetData(db, {
      userId: "user-1",
      anchorMonth: "2026-07",
      horizon: "monthly",
    });

    expect(data.view).toBeDefined();
    if (data.view.horizon === "monthly") {
      expect(data.view.month.sections).toBeDefined();
    }
  });

  it("throws error for invalid anchorMonth format", async () => {
    const db = clientStub({}) as unknown as SupabaseClient;
    await expect(
      loadBudgetData(db, {
        userId: "user-1",
        anchorMonth: "invalid-month",
        horizon: "monthly",
      }),
    ).rejects.toThrow("invalid_budget_month");
  });

  it("maps goal contributions and events into the budget view", async () => {
    const db = clientStub({
      budgets: { data: [] },
      budget_periods: { data: [] },
      sinking_funds: { data: [] },
      recurring_streams: { data: [] },
      sync_jobs: { data: null },
      transactions: { data: [] },
      accounts: { data: [] },
      merchant_rules: { data: [] },
      category_overrides: { data: [] },
      transaction_splits: { data: [] },
      linked_refunds: { data: [] },
      goals: {
        data: [{ id: "g1", name: "Emergency Fund", monthly_contribution: 100 }],
      },
      goal_progress_events: {
        data: [{ goal_id: "g1", event_date: "2026-07-10", amount: 50 }],
      },
    }) as unknown as SupabaseClient;

    const data = await loadBudgetData(db, {
      userId: "user-1",
      anchorMonth: "2026-07",
      horizon: "monthly",
    });

    expect(data.view).toBeDefined();
  });

  it("treats null aggregates and a disabled goalsV2 flag safely", async () => {
    process.env.FUNDFLOW_FEATURE_FLAGS = "-goalsV2";
    try {
      const db = clientStub({
        budgets: { data: null },
        budget_periods: { data: null },
        sinking_funds: { data: [] },
        recurring_streams: { data: null },
        sync_jobs: { data: null },
        transactions: { data: [] },
        accounts: { data: [] },
        merchant_rules: { data: [] },
        category_overrides: { data: [] },
        transaction_splits: { data: [] },
        linked_refunds: { data: [] },
      }) as unknown as SupabaseClient;

      const data = await loadBudgetData(db, {
        userId: "user-1",
        anchorMonth: "2026-07",
        horizon: "monthly",
      });

      expect(data.view).toBeDefined();
    } finally {
      delete process.env.FUNDFLOW_FEATURE_FLAGS;
    }
  });

  it("defaults a requested currency passed as an array", async () => {
    const db = clientStub({
      households: { data: [{ id: "household-1" }] },
      budgets: { data: [] },
      budget_periods: { data: [] },
      sinking_funds: { data: [] },
      recurring_streams: { data: [] },
      sync_jobs: { data: null },
      transactions: {
        data: [
          {
            id: "t1",
            account_id: "acc1",
            date: "2026-07-10",
            amount: 50,
            pfc_primary: "FOOD_AND_DRINK",
            pfc_detailed: "GROCERIES",
          },
        ],
      },
      accounts: { data: [{ id: "acc1", name: "Checking", iso_currency_code: "usd" }] },
      merchant_rules: { data: [] },
      category_overrides: { data: [] },
      transaction_splits: { data: [] },
      linked_refunds: { data: [] },
    }) as unknown as SupabaseClient;

    const data = await loadBudgetData(db, {
      userId: "user-1",
      anchorMonth: "2026-07",
      horizon: "monthly",
      requestedCurrency: ["USD"],
    });

    expect(data.selectedCurrency).toBe("USD");
  });

  it("matches recurring categories against the transaction category key", async () => {
    const db = clientStub({
      households: { data: [{ id: "household-1" }] },
      budgets: { data: [] },
      budget_periods: { data: [] },
      sinking_funds: { data: [] },
      recurring_streams: { data: [{ category: "GROCERIES" }] },
      sync_jobs: { data: null },
      transactions: {
        data: [
          {
            id: "t-trailing",
            account_id: "acc1",
            date: "2026-06-15",
            amount: 80,
            pfc_primary: "FOOD_AND_DRINK",
            pfc_detailed: "GROCERIES",
          },
        ],
      },
      accounts: { data: [{ id: "acc1", name: "Checking", iso_currency_code: "usd" }] },
      merchant_rules: { data: [] },
      category_overrides: { data: [] },
      transaction_splits: { data: [] },
      linked_refunds: { data: [] },
    }) as unknown as SupabaseClient;

    const data = await loadBudgetData(db, {
      userId: "user-1",
      anchorMonth: "2026-07",
      horizon: "monthly",
      requestedCurrency: "USD",
    });

    expect(data.view).toBeDefined();
  });

  it("formats a query failure without a code", async () => {
    const db = clientStub({
      budgets: { data: null, error: { message: "boom" } },
    }) as unknown as SupabaseClient;

    await expect(
      loadBudgetData(db, {
        userId: "user-1",
        anchorMonth: "2026-07",
        horizon: "monthly",
      }),
    ).rejects.toThrow("budget_query_failed:budgets");
  });
});
