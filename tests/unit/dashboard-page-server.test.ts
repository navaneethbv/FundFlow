import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

let featureFlagMap: Record<string, boolean> = {
  dashboardWidgets: true,
  goalsV2: false,
};

vi.mock("@/lib/feature-flags", () => ({
  isFeatureEnabled: (flag: string) => featureFlagMap[flag] ?? true,
}));

vi.mock("@/components/shell/AppShell", () => ({
  default: ({ active, children }: { active: string; children: React.ReactNode }) =>
    createElement("div", { "data-testid": "app-shell", "data-active-view": active }, children),
}));

vi.mock("@/components/shell/PageHeader", () => ({
  default: ({ title, actions }: { title: string; actions?: React.ReactNode }) =>
    createElement("header", { "data-testid": "page-header" }, title, actions),
}));

vi.mock("@/components/AutoRefresh", () => ({
  default: () => createElement("div", { "data-testid": "auto-refresh" }),
}));

vi.mock("@/components/ConnectBankButton", () => ({
  default: () => createElement("button", null, "Connect bank"),
}));

vi.mock("@/components/dashboard/DashboardHeaderActions", () => ({
  default: () => createElement("div", { "data-testid": "header-actions" }),
}));

vi.mock("@/components/dashboard/DashboardToolbar", () => ({
  default: () => createElement("div", { "data-testid": "dashboard-toolbar" }),
}));

vi.mock("@/components/dashboard/DashboardViewTabs", () => ({
  default: ({ activeView }: { activeView: string }) =>
    createElement("div", { "data-testid": "dashboard-view-tabs", "data-tab": activeView }),
}));

vi.mock("@/components/dashboard/FreshnessBanner", () => ({
  default: ({ brokenBanks, isStale }: { brokenBanks: unknown[]; isStale: boolean }) =>
    createElement(
      "div",
      {
        "data-testid": "freshness-banner",
        "data-broken": brokenBanks.length,
        "data-stale": String(isStale),
      },
    ),
}));

vi.mock("@/components/dashboard/ScopeChips", () => ({
  default: ({ dashboardScope }: { dashboardScope: string }) =>
    createElement("div", { "data-testid": "scope-chips", "data-scope": dashboardScope }),
}));

vi.mock("@/components/dashboard/PriorityRail", () => ({
  default: () => createElement("div", { "data-testid": "priority-rail" }),
}));

vi.mock("@/components/dashboard/OverviewView", () => ({
  default: () => createElement("div", { "data-testid": "overview-view" }),
}));

vi.mock("@/components/dashboard/MonitorView", () => ({
  default: () => createElement("div", { "data-testid": "monitor-view" }),
}));

vi.mock("@/components/dashboard/PlanView", () => ({
  default: ({
    billsGrouping,
    weeklyReport,
  }: {
    billsGrouping: string;
    weeklyReport?: unknown;
  }) =>
    createElement(
      "div",
      {
        "data-testid": "plan-view",
        "data-bills-grouping": billsGrouping,
        "data-has-weekly-report": String(Boolean(weeklyReport)),
      },
    ),
}));

vi.mock("@/components/dashboard/WealthView", () => ({
  default: () => createElement("div", { "data-testid": "wealth-view" }),
}));

const { mockDashboardData } = vi.hoisted(() => ({
  mockDashboardData: {
    accounts: [{ id: "acc-1", name: "Checking", mask: "1234", type: "depository", current_balance: 1000 }],
    availableMonths: ["2026-08", "2026-09"],
    selectedMonth: "2026-09",
    currentMonthIncome: 5000,
    currentMonthExpenses: 3000,
    budgetEnvelopes: [{ id: "b1", status: "ok" }],
    spendingAnomalies: [],
    cashFlowForecast: { lowBalanceRisk: false },
    syncIsStale: false,
    lastSyncAgoMinutes: 5,
    spendPerPerson: [],
  },
}));

vi.mock("@/lib/dashboard-cache", () => ({
  getCachedDashboardData: vi.fn().mockResolvedValue(mockDashboardData),
}));

vi.mock("@/lib/dashboard", () => ({
  getDashboardData: vi.fn().mockResolvedValue(mockDashboardData),
}));

vi.mock("@/lib/recent-transactions", () => ({
  getRecentTransactions: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/goals", () => ({
  getGoals: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/goals-data", () => ({
  loadGoalsPageData: vi.fn().mockResolvedValue({ goals: [] }),
}));

vi.mock("@/lib/weekly-delivery-history", () => ({
  loadLatestWeeklyDelivery: vi.fn().mockResolvedValue({ id: "rep-1", created_at: "2026-09-01" }),
}));

let mockItems: Array<{ id: string; institution_name: string | null; status: string | null }> = [
  { id: "item-1", institution_name: "Chase", status: "ok" },
];
let mockHouseholds: Array<{ id: string }> = [{ id: "hh-1" }];

function createChainableQuery(resolvedData: unknown = []) {
  const chain: Record<string, unknown> = {};
  const methods = ["select", "eq", "neq", "order", "limit", "filter", "range", "in", "is"];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: resolvedData });
  chain.single = vi.fn().mockResolvedValue({ data: resolvedData });
  chain.then = (resolve: (value: { data: unknown; error: null }) => unknown) =>
    Promise.resolve({ data: resolvedData, error: null }).then(resolve);
  return chain;
}

let mockSupabase: ReturnType<typeof createMockSupabase>;

function createMockSupabase() {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: "user-1", email: "user@example.com" } },
      }),
    },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "plaid_items") {
        return createChainableQuery(mockItems);
      }
      if (table === "households") {
        return createChainableQuery(mockHouseholds);
      }
      if (table === "profiles") {
        return createChainableQuery({
          full_name: "Alex Smith",
          display_name: "Alex",
          dashboard_prefs: {},
        });
      }
      return createChainableQuery([]);
    }),
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve(mockSupabase),
}));

import DashboardPage from "@/app/dashboard/page";

beforeEach(() => {
  featureFlagMap = { dashboardWidgets: true, goalsV2: false };
  mockItems = [{ id: "item-1", institution_name: "Chase", status: "ok" }];
  mockHouseholds = [{ id: "hh-1" }];
  mockSupabase = createMockSupabase();
});

describe("DashboardPage Server Component", () => {
  it("renders overview view by default when widgets are enabled", async () => {
    const element = await DashboardPage({
      searchParams: Promise.resolve({}),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('data-active-view="overview"');
    expect(html).toContain('data-testid="overview-view"');
    expect(html).toContain('data-testid="scope-chips"');
    expect(html).toContain("Good");
    expect(html).toContain("Alex");
  });

  it("renders empty state when no banks are connected", async () => {
    mockItems = [];

    const element = await DashboardPage({
      searchParams: Promise.resolve({}),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("No banks connected");
    expect(html).toContain("Connect bank");
    expect(html).not.toContain('data-testid="overview-view"');
  });

  it("renders monitor view when view=monitor or tab=cashflow", async () => {
    const element = await DashboardPage({
      searchParams: Promise.resolve({ view: "monitor" }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('data-active-view="monitor"');
    expect(html).toContain('data-testid="monitor-view"');
  });

  it("renders plan view with weekly report and monthly bills grouping", async () => {
    const element = await DashboardPage({
      searchParams: Promise.resolve({ view: "plan", bills: "monthly" }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('data-active-view="plan"');
    expect(html).toContain('data-testid="plan-view"');
    expect(html).toContain('data-bills-grouping="monthly"');
    expect(html).toContain('data-has-weekly-report="true"');
  });

  it("renders wealth view when view=wealth or tab=income", async () => {
    const element = await DashboardPage({
      searchParams: Promise.resolve({ view: "wealth" }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('data-active-view="wealth"');
    expect(html).toContain('data-testid="wealth-view"');
  });

  it("handles multi-value search parameters safely via firstSearchParam", async () => {
    const element = await DashboardPage({
      searchParams: Promise.resolve({
        view: ["plan", "monitor"],
        accountId: ["acc-1", "acc-2"],
        scope: ["household", "mine"],
      }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('data-active-view="plan"');
    expect(html).toContain('data-testid="plan-view"');
    expect(html).toContain('data-scope="household"');
  });

  it("supports goalsV2 feature flag pathway", async () => {
    featureFlagMap = { dashboardWidgets: true, goalsV2: true };

    const element = await DashboardPage({
      searchParams: Promise.resolve({ view: "plan" }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('data-active-view="plan"');
    expect(html).toContain('data-testid="plan-view"');
  });
});
