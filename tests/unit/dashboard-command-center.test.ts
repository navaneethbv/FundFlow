import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  dashboardHref,
  resolveDashboardView,
} from "@/components/dashboard/dashboard-view";
import { buildPrioritySignals } from "@/components/dashboard/PriorityRail";

describe("dashboard command center", () => {
  it("defaults to Monitor and maps legacy analysis tabs to Wealth", () => {
    expect(resolveDashboardView({})).toBe("monitor");
    expect(resolveDashboardView({ view: "monitor" })).toBe("monitor");
    expect(resolveDashboardView({ view: "plan" })).toBe("plan");
    expect(resolveDashboardView({ view: "wealth" })).toBe("wealth");
    expect(resolveDashboardView({ view: "unknown" })).toBe("monitor");
    expect(resolveDashboardView({ tab: "breakdowns" })).toBe("wealth");
    expect(resolveDashboardView({ tab: "cashflow" })).toBe("wealth");
  });

  it("preserves account and month filters in dashboard links", () => {
    expect(
      dashboardHref({
        view: "plan",
        accountId: "account-1",
        month: "2026-07",
      }),
    ).toBe("/dashboard?view=plan&accountId=account-1&month=2026-07");
  });

  it("summarizes healthy and actionable financial states", () => {
    const healthy = buildPrioritySignals({
      brokenBankCount: 0,
      isStale: false,
      lastSyncAgoMinutes: 8,
      lowBalanceRisk: false,
      budgetRiskCount: 0,
      anomalyCount: 0,
    });

    expect(healthy.map((signal) => signal.label)).toEqual([
      "Banks healthy",
      "Synced 8m ago",
      "Cash outlook stable",
      "Budgets on track",
      "No unusual activity",
    ]);

    const attention = buildPrioritySignals({
      brokenBankCount: 1,
      isStale: true,
      lastSyncAgoMinutes: 3010,
      lowBalanceRisk: true,
      budgetRiskCount: 2,
      anomalyCount: 3,
    });

    expect(attention.map((signal) => signal.tone)).toEqual([
      "danger",
      "warning",
      "danger",
      "warning",
      "warning",
    ]);
    expect(attention[0]?.href).toBe("/settings");
    expect(attention[3]?.href).toBe("/settings#budgets");
  });

  it("keeps dashboard controls in one filter-preserving toolbar", () => {
    expect(existsSync("components/dashboard/DashboardToolbar.tsx")).toBe(true);
    const toolbar = readFileSync(
      "components/dashboard/DashboardToolbar.tsx",
      "utf8",
    );
    const months = readFileSync("components/dashboard/MonthChips.tsx", "utf8");

    expect(toolbar).toContain("ConnectBankButton");
    expect(toolbar).toContain("RefreshButton");
    expect(toolbar).toContain("Monthly review");
    expect(toolbar).toContain("dashboardHref");
    expect(toolbar).toContain('aria-label="Account filter"');
    expect(months).toContain("activeView");
    expect(months).toContain("dashboardHref");
  });
});
