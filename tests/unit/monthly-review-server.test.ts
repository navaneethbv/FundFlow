import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ funded: vi.fn(), legacy: vi.fn(), flag: vi.fn() }));
vi.mock("@/lib/feature-flags", () => ({ isFeatureEnabled: mocks.flag }));
vi.mock("@/lib/goals-data", () => ({ loadGoalsPageData: mocks.funded }));
vi.mock("@/lib/goals", async (original) => ({ ...await original<object>(), getGoals: mocks.legacy }));
vi.mock("@/lib/supabase/server", () => ({ createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) } }) }));
vi.mock("@/lib/dashboard", () => ({ getDashboardData: async () => ({
  selectedMonth: "2026-08", currentMonthIncome: 0, currentMonthExpenses: 0,
  categoryBreakdown: [], budgetEnvelopes: [], spendingAnomalies: [],
}) }));
vi.mock("@/components/shell/AppShell", () => ({ default: ({ children }: { children: React.ReactNode }) => createElement("main", null, children) }));
vi.mock("@/components/review/ExportReportButton", () => ({ default: () => null }));

import MonthlyReviewPage from "@/app/review/page";
import { GOAL_BADGE_LABEL } from "@/lib/goals-v2";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.flag.mockReturnValue(true);
});

describe("Monthly review goal funding", () => {
  it("renders linked save-up and pay-down remaining amounts and real pace badges", async () => {
    mocks.funded.mockResolvedValue({ goals: [
      { id: "save", name: "Emergency reserve", remainingAmount: 1250, badge: "no-pace" },
      { id: "debt", name: "Pay off card", remainingAmount: 800, badge: "behind" },
    ] });
    const html = renderToStaticMarkup(await MonthlyReviewPage({ searchParams: Promise.resolve({ month: "2026-08" }) }));
    expect(mocks.funded).toHaveBeenCalledWith(expect.anything(), "owner");
    expect(mocks.legacy).not.toHaveBeenCalled();
    expect(html).toContain("$1,250.00");
    expect(html).toContain("$800.00");
    expect(html).toContain("No pace data");
    expect(html).toContain("Behind");
    expect(html).toContain("reflect current balances");
  });
  it("labels a badge with the same words the Goals page uses", async () => {
    // The audit's UI-11: one goal must not read "On track" on Goals and
    // "On Track" in Monthly review.
    mocks.funded.mockResolvedValue({ goals: [
      { id: "save", name: "Emergency reserve", remainingAmount: 10, badge: "on-track" },
      { id: "risk", name: "New roof", remainingAmount: 20, badge: "at-risk" },
    ] });
    const html = renderToStaticMarkup(await MonthlyReviewPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain(GOAL_BADGE_LABEL["on-track"]);
    expect(html).toContain(GOAL_BADGE_LABEL["at-risk"]);
    expect(html).not.toContain("On Track");
    expect(html).not.toContain("At Risk");
  });
  it("retains the legacy deployment fallback without querying funded-goal tables", async () => {
    mocks.flag.mockReturnValue(false);
    mocks.legacy.mockResolvedValue([]);
    const html = renderToStaticMarkup(await MonthlyReviewPage({ searchParams: Promise.resolve({}) }));
    expect(mocks.funded).not.toHaveBeenCalled();
    expect(html).toContain("No active goals yet.");
  });
});
