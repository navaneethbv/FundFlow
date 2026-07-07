import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("planning feature UI", () => {
  it("renders the planning panels from dashboard data", () => {
    expect(existsSync("components/dashboard/PlanningInsights.tsx")).toBe(true);
    const source = readFileSync("components/dashboard/PlanningInsights.tsx", "utf8");

    expect(source).toContain("Budget envelopes");
    expect(source).toContain("Cash forecast");
    expect(source).toContain("Recurring calendar");
    expect(source).toContain("Net worth snapshot");
  });

  it("wires planning data into the overview tab", () => {
    const dashboard = readFileSync("lib/dashboard.ts", "utf8");
    const overview = readFileSync("components/dashboard/OverviewTab.tsx", "utf8");

    for (const field of [
      "budgetEnvelopes",
      "cashFlowForecast",
      "recurringWeeks",
      "spendingAnomalies",
      "netWorthSnapshot",
    ]) {
      expect(dashboard).toContain(field);
    }
    expect(overview).toContain("PlanningInsights");
  });
});
