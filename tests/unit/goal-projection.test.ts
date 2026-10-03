import { describe, expect, it } from "vitest";
import { buildGoalProjection } from "@/lib/goal-projection";
import type { FundedGoal } from "@/lib/goals-v2";

function goal(overrides: Partial<FundedGoal> = {}): FundedGoal {
  return {
    id: "goal-1",
    name: "Emergency fund",
    target_amount: 1200,
    saved_amount: 200,
    target_date: "2026-06-01",
    household_id: null,
    goal_type: "save_up",
    image_slug: null,
    monthly_contribution: 100,
    spending_reduces: false,
    starting_balance: null,
    target_balance: null,
    funded_amount: 200,
    est_monthly: 200,
    badge: "on-track",
    progressPct: 17,
    remainingAmount: 1000,
    allocatedFromAccounts: 0,
    eventTotal: 0,
    linkedAccountBalance: 0,
    trailingMonthlyPace: 0,
    ...overrides,
  };
}

describe("buildGoalProjection", () => {
  it("starts at the observed funding and caps the final point at the target", () => {
    const result = buildGoalProjection(goal(), "2026-01");
    expect(result?.points).toEqual([
      { month: "2026-01", funded: 200, target: 1200, isTargetMonth: false },
      { month: "2026-02", funded: 400, target: 1200, isTargetMonth: false },
      { month: "2026-03", funded: 600, target: 1200, isTargetMonth: false },
      { month: "2026-04", funded: 800, target: 1200, isTargetMonth: false },
      { month: "2026-05", funded: 1000, target: 1200, isTargetMonth: false },
      { month: "2026-06", funded: 1200, target: 1200, isTargetMonth: true },
    ]);
    expect(result?.capped).toBe(false);
  });

  it("returns no projection when the target date or pace is missing", () => {
    expect(buildGoalProjection(goal({ target_date: null }), "2026-01")).toBeNull();
    expect(buildGoalProjection(goal({ est_monthly: null, monthly_contribution: null }), "2026-01")).toBeNull();
    expect(buildGoalProjection(goal({ remainingAmount: 0, progressPct: 100 }), "2026-01")).toBeNull();
  });

  it("caps long projections at the bounded horizon", () => {
    const result = buildGoalProjection(goal({ target_date: "2032-01-01" }), "2026-01", 12);
    expect(result?.points).toHaveLength(13);
    expect(result?.capped).toBe(true);
    expect(result?.points.at(-1)?.month).toBe("2027-01");
  });
});
