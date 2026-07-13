import { describe, expect, it } from "vitest";
import {
  dashboardHref,
  resolveDashboardView,
} from "@/components/dashboard/dashboard-view";

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
});
