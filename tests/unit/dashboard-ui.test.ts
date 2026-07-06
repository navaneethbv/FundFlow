import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { computeNetWorth, computeSavingsRate } from "@/components/dashboard/metrics";

describe("dashboard UI overhaul", () => {
  it("computes dashboard-only net worth from fetched account balances", () => {
    const accounts = [
      { type: "depository", current_balance: 1250 },
      { type: "credit", current_balance: 225 },
      { type: "investment", current_balance: 5000 },
    ];

    expect(computeNetWorth(accounts)).toBe(6025);
  });

  it("computes savings rate from already fetched income and spending", () => {
    expect(computeSavingsRate(8000, 5200)).toBe(35);
    expect(computeSavingsRate(0, 5200)).toBe(0);
    expect(computeSavingsRate(5000, 6200)).toBe(0);
  });

  it("extracts the dashboard into phase components", () => {
    for (const file of [
      "components/dashboard/ActionBar.tsx",
      "components/dashboard/CardCarousel.tsx",
      "components/dashboard/FreshnessBanner.tsx",
      "components/dashboard/MonthChips.tsx",
      "components/dashboard/OverviewTab.tsx",
      "components/dashboard/BreakdownsTab.tsx",
      "components/dashboard/CashflowTab.tsx",
      "components/dashboard/RecentActivity.tsx",
      "components/charts/RadialGauge.tsx",
      "components/charts/MiniBars.tsx",
      "components/charts/AreaSparkline.tsx",
    ]) {
      expect(existsSync(file), `${file} should exist`).toBe(true);
    }
  });

  it("keeps app dashboard as an orchestrator", () => {
    const source = readFileSync("app/dashboard/page.tsx", "utf8");
    const lineCount = source.split("\n").length;

    expect(source).toContain("OverviewTab");
    expect(source).toContain("RecentActivity");
    expect(lineCount).toBeLessThanOrEqual(230);
  });
});
