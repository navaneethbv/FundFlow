import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  dashboardHref,
  resolveDashboardView,
} from "@/components/dashboard/dashboard-view";
import { buildPrioritySignals } from "@/components/dashboard/PriorityRail";
import { getPlanSetupItems } from "@/components/dashboard/PlanView";

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
      budgetCount: 1,
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
      budgetCount: 2,
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

    const withoutBudgets = buildPrioritySignals({
      brokenBankCount: 0,
      isStale: false,
      lastSyncAgoMinutes: 8,
      lowBalanceRisk: false,
      budgetCount: 0,
      budgetRiskCount: 0,
      anomalyCount: 0,
    });
    expect(withoutBudgets[3]).toEqual({
      label: "Budgets not set",
      tone: "neutral",
      href: "/settings#budgets",
    });
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

  it("keeps daily monitoring content ahead of secondary detail", () => {
    expect(existsSync("components/dashboard/MonitorView.tsx")).toBe(true);
    const source = readFileSync("components/dashboard/MonitorView.tsx", "utf8");

    expect(source.indexOf("Recent activity")).toBeLessThan(
      source.indexOf("Spending by category"),
    );
    expect(source.indexOf("Top merchants")).toBeLessThan(
      source.indexOf("Recurring streams"),
    );
    expect(source).toContain("Nothing needs attention right now.");
    expect(source).toContain("CategoryDrilldownPanel");
    expect(source).toContain("MerchantDrilldownPanel");
    expect(source).not.toContain("PlanningDepth");
    expect(source).not.toContain("CardCarousel");
  });

  it("groups missing planning data into one setup list", () => {
    const items = getPlanSetupItems(
      {
        budgetEnvelopes: [],
        recurringWeeks: [],
        recurringStatuses: [],
      },
      [],
    );

    expect(items).toEqual([
      { label: "Create a monthly budget", href: "/settings#budgets" },
      { label: "Add a savings goal", href: "/goals" },
      { label: "Refresh recurring transactions", href: "/settings" },
    ]);
  });

  it("does not render empty planning-depth panels", () => {
    const source = readFileSync(
      "components/dashboard/PlanningDepth.tsx",
      "utf8",
    );

    expect(source).toContain(
      "if (!view.debtPayoff && view.sinkingFunds.length === 0) return null;",
    );
    expect(source).toContain("{view.debtPayoff && (");
    expect(source).toContain("{view.sinkingFunds.length > 0 && (");
  });

  it("keeps account and balance-sheet content in Wealth", () => {
    expect(existsSync("components/dashboard/WealthView.tsx")).toBe(true);
    const wealth = readFileSync("components/dashboard/WealthView.tsx", "utf8");
    const cards = readFileSync("components/dashboard/CardCarousel.tsx", "utf8");

    expect(wealth.indexOf("Net worth")).toBeLessThan(
      wealth.indexOf("Spend by card"),
    );
    expect(wealth).toContain("Balance sheet");
    expect(wealth).toContain("Cash flow history");
    expect(wealth).toContain("CardCarousel");
    expect(wealth).toContain("dashboardUrl");
    expect(cards).toContain("activeView");
    expect(cards).toContain("dashboardHref");
  });

  it("wires exactly one command-center view from the dashboard page", () => {
    const page = readFileSync("app/dashboard/page.tsx", "utf8");

    for (const component of [
      "DashboardToolbar",
      "PriorityRail",
      "MonitorView",
      "PlanView",
      "WealthView",
      "resolveDashboardView",
    ]) {
      expect(page).toContain(component);
    }
    expect(page).not.toContain("OverviewTab");
    expect(page).not.toContain("BreakdownsTab");
    expect(page).not.toContain("CashflowTab");
  });

  it("uses the restrained financial operations visual system", () => {
    const globals = readFileSync("app/globals.css", "utf8");
    const statTile = readFileSync("components/charts/StatTile.tsx", "utf8");

    for (const token of [
      "--background: #f5f7fa",
      "--foreground: #101828",
      "--muted: #667085",
      "--accent: #175cd3",
      "--success: #067647",
      "--warning: #b54708",
      "--danger: #b42318",
    ]) {
      expect(globals).toContain(token);
    }
    expect(globals).toContain(".metric-value");
    expect(globals).not.toContain("radial-gradient(circle at 16% -4%");
    expect(statTile).toContain("metric-value");
    expect(statTile).not.toContain("hover:-translate-y-0.5");

    const priorityRail = readFileSync(
      "components/dashboard/PriorityRail.tsx",
      "utf8",
    );
    expect(priorityRail).not.toContain("overflow-x-auto");
    expect(priorityRail).toContain("xl:grid-cols-5");
  });
});
