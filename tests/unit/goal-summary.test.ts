import { describe, expect, it } from "vitest";
import { toGoalSummaryItem } from "@/lib/goal-summary";
import type { FundedGoal } from "@/lib/goals-v2";

function fundedGoal(overrides: Partial<FundedGoal> = {}): FundedGoal {
  return {
    id: "goal-1",
    name: "Payoff",
    target_amount: 0,
    saved_amount: 0,
    target_date: null,
    household_id: null,
    goal_type: "pay_down",
    image_slug: null,
    monthly_contribution: null,
    spending_reduces: false,
    starting_balance: 5000,
    target_balance: 0,
    funded_amount: 1000,
    est_monthly: null,
    badge: "on-track",
    progressPct: 20,
    remainingAmount: 4000,
    allocatedFromAccounts: 0,
    eventTotal: 0,
    linkedAccountBalance: 4000,
    trailingMonthlyPace: 0,
    ...overrides,
  };
}

describe("toGoalSummaryItem", () => {
  it("uses the funded model target when legacy target_amount is zero", () => {
    expect(toGoalSummaryItem(fundedGoal()).targetAmount).toBe(5000);
  });
});
