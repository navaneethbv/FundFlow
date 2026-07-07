import { describe, expect, it } from "vitest";
import {
  goalMonthlyPace,
  goalRemainingAmount,
  goalStatus,
  goalSummary,
  type Goal,
} from "@/lib/goals";

const today = new Date("2026-07-07T12:00:00Z");

function goal(overrides: Partial<Goal>): Goal {
  return {
    id: "goal-1",
    name: "Emergency fund",
    target_amount: 10000,
    saved_amount: 2500,
    target_date: "2026-11-07",
    ...overrides,
  };
}

describe("goal planning helpers", () => {
  it("computes the amount remaining without going below zero", () => {
    expect(goalRemainingAmount(goal({ saved_amount: 2500, target_amount: 10000 }))).toBe(7500);
    expect(goalRemainingAmount(goal({ saved_amount: 12000, target_amount: 10000 }))).toBe(0);
  });

  it("computes the monthly pace needed to hit a target date", () => {
    expect(goalMonthlyPace(goal({ target_date: "2026-11-07" }), today)).toBe(1875);
    expect(goalMonthlyPace(goal({ target_date: null }), today)).toBeNull();
    expect(goalMonthlyPace(goal({ target_date: "2026-07-01" }), today)).toBeNull();
  });

  it("classifies completed, overdue, on-track, and no-date goals", () => {
    expect(goalStatus(goal({ saved_amount: 10000 }), today)).toBe("completed");
    expect(goalStatus(goal({ target_date: "2026-07-01" }), today)).toBe("overdue");
    expect(goalStatus(goal({ target_date: "2026-11-07" }), today)).toBe("on-track");
    expect(goalStatus(goal({ target_date: null }), today)).toBe("no-date");
  });

  it("sorts active dated goals before undated and completed goals", () => {
    const summary = goalSummary(
      [
        goal({ id: "done", name: "Done", saved_amount: 10000, target_date: "2026-08-01" }),
        goal({ id: "later", name: "Later", target_date: "2027-01-01" }),
        goal({ id: "none", name: "No date", target_date: null }),
        goal({ id: "soon", name: "Soon", target_date: "2026-08-01" }),
      ],
      today,
    );

    expect(summary.map((item) => item.goal.id)).toEqual(["soon", "later", "none", "done"]);
    expect(summary[0]).toMatchObject({
      remainingAmount: 7500,
      monthlyPace: 7500,
      status: "on-track",
      progressPct: 25,
    });
  });
});
