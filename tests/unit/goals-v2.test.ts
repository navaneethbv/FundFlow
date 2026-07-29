import { describe, it, expect } from "vitest";
import { computeFundedGoals, type GoalV2Row, type GoalAccountRow } from "@/lib/goals-v2";

describe("lib/goals-v2.ts", () => {
  it("computes goal funding from manual progress and linked account balances", () => {
    const goals: GoalV2Row[] = [
      {
        id: "g1",
        name: "Emergency Fund",
        target_amount: 10000,
        saved_amount: 1000,
        target_date: "2026-12-31",
        goal_type: "save_up",
      },
    ];

    const links: GoalAccountRow[] = [
      { goal_id: "g1", account_id: "acc-1", allocated_amount: null, use_entire_balance: true },
    ];

    const accounts = [{ id: "acc-1", current_balance: 4000, type: "depository" }];

    const funded = computeFundedGoals(goals, links, accounts, new Date("2026-07-01"));

    expect(funded[0].funded_amount).toBe(5000); // 1000 saved + 4000 account
    expect(funded[0].badge).toBe("on-track");
    expect(funded[0].est_monthly).toBeGreaterThan(0);
  });
});
