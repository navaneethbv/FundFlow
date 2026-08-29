import { describe, expect, it } from "vitest";
import {
  parseMonarchGoals,
  buildGoalImportPlan,
  matchGoal,
  GOAL_IMPORT_VERSION,
} from "@/lib/goal-import";

const MONARCH_JSON = JSON.stringify({
  goals: [
    {
      id: "monarch-goal-1",
      name: "Emergency Fund",
      type: "save_up",
      target_amount: 15000,
      target_date: "2027-12-31",
      account_name: "Checking",
      monthly_contribution: 500,
    },
    { id: "monarch-goal-2", name: "Car Payoff", type: "pay_down", target_amount: 8000 },
  ],
});

const existing = [
  {
    id: "g-1",
    name: "Emergency Fund",
    goal_type: "save_up" as const,
    target_amount: 10000,
    target_date: "2028-06-30",
    import_source: "monarch" as const,
    import_ref: "monarch-goal-1",
  },
];

describe("parseMonarchGoals", () => {
  it("parses name, type, target, linked account, and contribution", () => {
    const { rows, errors } = parseMonarchGoals(MONARCH_JSON);
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({
      importedId: "monarch-goal-1",
      name: "Emergency Fund",
      goalType: "save_up",
      targetAmount: 15000,
      targetDate: "2027-12-31",
      linkedAccountName: "Checking",
      monthlyContribution: 500,
    });
  });

  it("reports malformed input", () => {
    const { rows, errors } = parseMonarchGoals("nope");
    expect(rows).toEqual([]);
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe("matchGoal", () => {
  it("matches by stable imported identifier when available", () => {
    const match = matchGoal(
      { importedId: "monarch-goal-1", name: "Emergency Fund", goalType: "save_up" },
      existing,
    );
    expect(match?.id).toBe("g-1");
  });

  it("never matches by name alone when the type differs", () => {
    const match = matchGoal(
      { importedId: null, name: "Emergency Fund", goalType: "pay_down" },
      existing,
    );
    expect(match).toBeNull();
  });

  it("matches an unambiguous name+type pair when no imported id exists", () => {
    const match = matchGoal(
      { importedId: null, name: "Emergency Fund", goalType: "save_up" },
      existing,
    );
    expect(match?.id).toBe("g-1");
  });
});

describe("buildGoalImportPlan", () => {
  it("flags conflicts on a matched goal whose target changed", () => {
    const plan = buildGoalImportPlan(parseMonarchGoals(MONARCH_JSON).rows, existing);
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0]).toMatchObject({
      existingGoalId: "g-1",
      name: "Emergency Fund",
      existingTarget: 10000,
      incomingTarget: 15000,
    });
  });

  it("is versioned", () => {
    expect(buildGoalImportPlan([], []).version).toBe(GOAL_IMPORT_VERSION);
  });
});
describe("goal import edge coverage", () => {
  it("skips a goal with no usable name and reports malformed amounts", () => {
    const result = parseMonarchGoals(
      JSON.stringify({ goals: [{ id: "g", name: "", type: "save_up" }] }),
    );
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.rows).toEqual([]);
  });

  it("parses a bare array and defaults unknown types to save_up", () => {
    const result = parseMonarchGoals(
      JSON.stringify([{ id: "g2", name: "Trip", target_amount: 5000 }]),
    );
    expect(result.rows[0]).toMatchObject({ goalType: "save_up", targetAmount: 5000, importedId: "g2" });
  });
});
