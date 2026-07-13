import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("planning feature UI", () => {
  it("keeps planning and wealth panels in separate views", () => {
    expect(existsSync("components/dashboard/PlanView.tsx")).toBe(true);
    expect(existsSync("components/dashboard/WealthView.tsx")).toBe(true);
    const plan = readFileSync("components/dashboard/PlanView.tsx", "utf8");
    const wealth = readFileSync("components/dashboard/WealthView.tsx", "utf8");

    expect(plan).toContain("Budget pace");
    expect(plan).toContain("Cash forecast");
    expect(plan).toContain("Recurring calendar");
    expect(plan).toContain("PlanningDepth");
    expect(wealth).toContain("Net worth");
    expect(plan).not.toContain("Net worth");
  });

  it("wires planning data into the Plan view", () => {
    const dashboard = readFileSync("lib/dashboard.ts", "utf8");
    const plan = readFileSync("components/dashboard/PlanView.tsx", "utf8");

    for (const field of [
      "budgetEnvelopes",
      "cashFlowForecast",
      "recurringWeeks",
      "spendingAnomalies",
      "netWorthSnapshot",
    ]) {
      expect(dashboard).toContain(field);
    }
    expect(plan).toContain("budgetEnvelopes");
    expect(plan).toContain("cashFlowForecast");
    expect(plan).toContain("recurringWeeks");
  });
});
