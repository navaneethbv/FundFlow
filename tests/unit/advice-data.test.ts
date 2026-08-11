import { describe, expect, it } from "vitest";
import { loadAdvicePageData } from "@/lib/advice-data";
import { clientStub } from "../fixtures/supabase-query";

const baseSeed = {
  accounts: { data: [] },
  manual_accounts: { data: [] },
  budgets: { data: [] },
  goals: { data: [] },
  profiles: { data: null },
  advice_progress: { data: [] },
  transactions: { data: [] },
  merchant_rules: { data: [] },
  category_overrides: { data: [] },
  transaction_splits: { data: [] },
  linked_refunds: { data: [] },
};

describe("loadAdvicePageData", () => {
  it("loads advice context, progress, priorities, and profile for user", async () => {
    const supabase = clientStub({
      accounts: {
        data: [
          { type: "depository", subtype: "checking", current_balance: 5000 },
          { type: "credit", subtype: "credit card", current_balance: 200 },
        ],
      },
      manual_accounts: {
        data: [{ account_type: "investment" }],
      },
      budgets: { data: [{ id: "b1" }] },
      goals: { data: [{ id: "g1" }] },
      profiles: {
        data: {
          advice_priorities: ["emergency_fund", "debt_payoff"],
          advice_profile: { emergency_fund_months: 6 },
        },
      },
      advice_progress: {
        data: [{ advice_id: "a1", task_id: "t1" }],
      },
      transactions: {
        data: [
          {
            id: "t1",
            user_id: "user-1",
            account_id: "acc-1",
            date: "2026-06-15",
            amount: 1000,
            pfc_primary: "FOOD_AND_DRINK",
            pending: false,
          },
        ],
      },
      merchant_rules: { data: [] },
      category_overrides: { data: [] },
      transaction_splits: { data: [] },
      linked_refunds: { data: [] },
    });

    const data = await loadAdvicePageData(supabase as never, "user-1", "2026-07-15");

    expect(data.ctx.hasBudget).toBe(true);
    expect(data.ctx.hasGoals).toBe(true);
    expect(data.ctx.creditCardCarry).toBe(true);
    expect(data.ctx.hasInvestments).toBe(true);
    expect(data.priorities).toEqual(["emergency_fund", "debt_payoff"]);
    expect(data.profile).toEqual({ emergency_fund_months: 6 });
    expect(data.progress).toEqual([{ advice_id: "a1", task_id: "t1" }]);
  });

  it("throws if any database query returns an error", async () => {
    const supabase = clientStub({
      accounts: { error: new Error("DB Error") },
      manual_accounts: { data: [] },
      budgets: { data: [] },
      goals: { data: [] },
      profiles: { data: null },
      advice_progress: { data: [] },
      transactions: { data: [] },
      merchant_rules: { data: [] },
      category_overrides: { data: [] },
      transaction_splits: { data: [] },
      linked_refunds: { data: [] },
    });

    await expect(loadAdvicePageData(supabase as never, "user-1", "2026-07-15")).rejects.toThrow();
  });

  it.each([
    ["manual_accounts"],
    ["budgets"],
    ["goals"],
    ["profiles"],
    ["advice_progress"],
  ])("throws when the %s query fails", async (table) => {
    const supabase = clientStub({
      ...baseSeed,
      [table]: { error: new Error(`${table} DB Error`) },
    });

    await expect(loadAdvicePageData(supabase as never, "user-1", "2026-07-15")).rejects.toThrow(
      `${table} DB Error`,
    );
  });

  it("computes runway from essential spending and defaults missing result data", async () => {
    const supabase = clientStub({
      accounts: {
        data: [
          { type: "depository", subtype: "checking", current_balance: null },
          { type: "investment", subtype: "brokerage", current_balance: 3000 },
          { type: "credit", subtype: "credit card", current_balance: 0 },
        ],
      },
      manual_accounts: { data: null },
      budgets: { data: null },
      goals: { data: null },
      profiles: { data: { advice_priorities: "emergency_fund", advice_profile: null } },
      advice_progress: { data: null },
      transactions: {
        data: [
          { id: "e1", date: "2026-06-15", amount: 1000, pfc_primary: "RENT_AND_UTILITIES", pending: false },
          { id: "e2", date: "2026-06-20", amount: 200, pfc_primary: "RENT_AND_UTILITIES", pending: false },
          { id: "e3", date: "2026-07-10", amount: 300, pfc_primary: "RENT_AND_UTILITIES", pending: false },
          { id: "ne", date: "2026-06-10", amount: 50, pfc_primary: "FOOD_AND_DRINK", pending: false },
          { id: "inc", date: "2026-06-05", amount: -500, pfc_primary: "INCOME", pending: false },
        ],
      },
      merchant_rules: { data: [] },
      category_overrides: { data: [] },
      transaction_splits: { data: [] },
      linked_refunds: { data: [] },
    });

    const data = await loadAdvicePageData(supabase as never, "user-1", "2026-07-15");

    expect(data.ctx.hasBudget).toBe(false);
    expect(data.ctx.hasGoals).toBe(false);
    expect(data.ctx.creditCardCarry).toBe(false);
    expect(data.ctx.hasInvestments).toBe(true);
    expect(data.priorities).toBeNull();
    expect(data.profile).toBeNull();
    expect(data.progress).toEqual([]);
  });

  it("handles missing accounts rows and reports investments from manual accounts", async () => {
    const supabase = clientStub({
      ...baseSeed,
      accounts: { data: null },
      manual_accounts: { data: [{ account_type: "investment" }] },
    });

    const data = await loadAdvicePageData(supabase as never, "user-1", "2026-07-15");

    expect(data.ctx.creditCardCarry).toBe(false);
    expect(data.ctx.hasInvestments).toBe(true);
    expect(data.profile).toBeNull();
  });
});
