import { describe, expect, it } from "vitest";
import { monthsRemainingFor } from "@/components/dashboard/PlanningDepth";
import type { GoalSummaryItem } from "@/lib/goal-summary";

function goal(overrides: Partial<GoalSummaryItem> = {}): GoalSummaryItem {
  return {
    id: "goal-1",
    name: "Emergency fund",
    targetAmount: 1200,
    fundedAmount: 0,
    remainingAmount: 1200,
    progressPct: 0,
    monthlyPace: null,
    targetDate: null,
    complete: false,
    ...overrides,
  };
}

describe("monthsRemainingFor", () => {
  it("keeps the neutral one-year runway for goals without a deadline", () => {
    expect(monthsRemainingFor(goal())).toBe(12);
  });

  it("gives overdue goals one month instead of hiding urgency", () => {
    expect(monthsRemainingFor(goal({ targetDate: "2026-07-01" }))).toBe(1);
  });

  it("derives the remaining months from an active monthly pace", () => {
    expect(
      monthsRemainingFor(
        goal({ remainingAmount: 1000, monthlyPace: 300, targetDate: "2026-12-31" }),
      ),
    ).toBe(4);
  });
});
