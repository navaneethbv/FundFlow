import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { goalProgressPct } from "@/lib/goals";

describe("goals feature", () => {
  it("computes clamped progress percentage", () => {
    expect(goalProgressPct(3200, 10000)).toBe(32);
    expect(goalProgressPct(0, 10000)).toBe(0);
    expect(goalProgressPct(10000, 10000)).toBe(100);
    expect(goalProgressPct(15000, 10000)).toBe(100); // over target clamps to 100
    expect(goalProgressPct(50, 0)).toBe(0); // guards divide-by-zero
  });

  it("ships the goals page, manager, and summary components", () => {
    for (const file of [
      "lib/goals.ts",
      "app/goals/page.tsx",
      "components/goals/GoalsManager.tsx",
      "components/dashboard/GoalsSummary.tsx",
      "supabase/migrations/0004_goals.sql",
    ]) {
      expect(existsSync(file), `${file} should exist`).toBe(true);
    }
  });

  it("keeps the goals page dynamic and mounts the manager", () => {
    const page = readFileSync("app/goals/page.tsx", "utf8");
    expect(page).toContain('export const dynamic = "force-dynamic"');
    expect(page).toContain("GoalsManager");
  });

  it("surfaces goals on the dashboard overview", () => {
    expect(readFileSync("components/dashboard/PlanView.tsx", "utf8")).toContain("GoalsSummary");
  });

  it("supports editing goals with rollback-aware actions", () => {
    const manager = readFileSync("components/goals/GoalsManager.tsx", "utf8");

    expect(manager).toContain("editingGoalId");
    expect(manager).toContain("Edit goal");
    expect(manager).toContain("Save changes");
    expect(manager).toContain("restoreGoals");
    expect(manager).toContain("Goal complete");
  });

  it("shows remaining amount and monthly pace in the dashboard summary", () => {
    const summary = readFileSync("components/dashboard/GoalsSummary.tsx", "utf8");

    expect(summary).toContain("goalSummary");
    expect(summary).toContain("remainingAmount");
    expect(summary).toContain("monthlyPace");
    expect(summary).toContain("needed monthly");
  });

  it("writes goals directly under owner-only RLS", () => {
    const migration = readFileSync("supabase/migrations/0004_goals.sql", "utf8");
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("goals_insert_own");
    expect(migration).toContain("auth.uid()");
  });
});
