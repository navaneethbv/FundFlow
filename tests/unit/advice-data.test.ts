import { describe, expect, it } from "vitest";
import { loadAdvicePageData } from "@/lib/advice-data";
import { clientStub } from "../fixtures/supabase-query";

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
});
