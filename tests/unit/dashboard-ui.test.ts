import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  computeNetWorth,
  computeSavingsRate,
  hasSmallSavingsRateBase,
  netWorthDeltaFromHistory,
} from "@/components/dashboard/metrics";

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
    expect(computeSavingsRate(0, 5200)).toBeNull();
    expect(computeSavingsRate(5000, 6200)).toBe(-24);
  });

  it("flags rates dominated by a very small income base without changing the rate", () => {
    expect(hasSmallSavingsRateBase(14.34, 6109.75)).toBe(true);
    expect(hasSmallSavingsRateBase(5000, 6200)).toBe(false);
    expect(hasSmallSavingsRateBase(0, 500)).toBe(false);
    expect(hasSmallSavingsRateBase(undefined, 500)).toBe(false);
    expect(hasSmallSavingsRateBase(10, undefined)).toBe(false);
  });

  it("compares live net worth with the previous snapshot, not the current one", () => {
    expect(
      netWorthDeltaFromHistory(175, [
        { month: "2026-06", netWorth: 100 },
        { month: "2026-07", netWorth: 150 },
      ]),
    ).toBe(75);
    expect(
      netWorthDeltaFromHistory(175, [{ month: "2026-07", netWorth: 150 }]),
    ).toBeUndefined();
  });

  it("extracts the dashboard into phase components", () => {
    for (const file of [
      "components/dashboard/DashboardToolbar.tsx",
      "components/dashboard/PriorityRail.tsx",
      "components/dashboard/CardCarousel.tsx",
      "components/dashboard/FreshnessBanner.tsx",
      "components/dashboard/MonthChips.tsx",
      "components/dashboard/MonitorView.tsx",
      "components/dashboard/PlanView.tsx",
      "components/dashboard/WealthView.tsx",
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

    // Every view is delegated to its own component; the page only chooses
    // between them. Phase 8 added a fourth (OverviewView) and, in the same
    // change, moved the view switcher out into DashboardViewTabs and the
    // widget-grid query into OverviewView — so the page delegates strictly
    // more than it used to. The budget moved from 240 to 260 to fit one more
    // view block of the same shape as the existing three, not to make room
    // for logic: if this needs raising again, extract instead.
    expect(source).toContain("OverviewView");
    expect(source).toContain("MonitorView");
    expect(source).toContain("PlanView");
    expect(source).toContain("WealthView");
    expect(source).toContain("resolveDashboardView");
    // The page must not grow a data layer: loaders live in lib/.
    expect(source).not.toContain("loadCanonicalProjection");
    expect(lineCount).toBeLessThanOrEqual(260);
  });
});
