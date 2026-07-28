import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Source-level wiring checks (same convention as dashboard-command-center):
 * the pure math in lib/insights.ts is unit-tested directly; these assert the
 * dashboard actually computes and renders it.
 */
describe("insights wiring", () => {
  const dashboard = readFileSync("lib/dashboard.ts", "utf8");
  const monitorView = readFileSync("components/dashboard/MonitorView.tsx", "utf8");

  it("dashboard aggregation computes the new insight metrics", () => {
    expect(dashboard).toContain("splitEssentialsByMonth");
    expect(dashboard).toContain("computeSavingsRateSeries");
    expect(dashboard).toContain("computeRunwayMonths");
    expect(dashboard).toContain("detectPaychecks");
    expect(dashboard).toContain("computeSafeToSpend");
    expect(dashboard).toMatch(/insights:\s*\{/);
  });

  it("dashboard feeds merchant medians into anomaly detection", () => {
    expect(dashboard).toContain("priorMerchantMedians");
  });

  it("monitor view renders the safe-to-spend, runway, and paycheck tiles", () => {
    expect(monitorView).toContain("Safe to spend");
    expect(monitorView).toContain("Emergency runway");
    expect(monitorView).toContain("Next paycheck");
    expect(monitorView).toContain("data.insights");
  });

  it("settings computes budget suggestions and the budgets section offers them", () => {
    const settings = readFileSync("app/settings/page.tsx", "utf8");
    const budgetsSection = readFileSync(
      "components/settings/BudgetsSection.tsx",
      "utf8",
    );
    expect(settings).toContain("suggestBudgets");
    expect(settings).toContain("EXCLUDED_PFC");
    expect(budgetsSection).toContain("Suggested budgets");
    expect(budgetsSection).toContain("suggestions");
  });
});
