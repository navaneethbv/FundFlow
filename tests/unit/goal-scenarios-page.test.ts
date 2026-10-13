import { beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactNode } from "react";
const mocks = vi.hoisted(() => ({ enabled: false, legacy: vi.fn(), funded: vi.fn(), today: vi.fn(), client: { auth: { getUser: vi.fn() }, from: vi.fn() } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => mocks.client }));
vi.mock("@/lib/feature-flags", () => ({ isFeatureEnabled: (flag: string) => flag === "goalsV2" && mocks.enabled }));
vi.mock("@/lib/goals", () => ({ getGoals: mocks.legacy }));
vi.mock("@/lib/goals-data", () => ({ loadGoalsPageData: mocks.funded }));
vi.mock("@/lib/report-period", () => ({ resolveViewerToday: mocks.today }));
vi.mock("@/lib/dashboard", () => ({ getDashboardData: async () => ({ currentMonthIncome: 9999, currentMonthExpenses: 1 }) }));
vi.mock("@/components/shell/AppShell", () => ({ default: "app-shell" }));
vi.mock("@/components/goals/GoalsManager", () => ({ default: "goals-manager" }));
vi.mock("@/components/goals/GoalWizard", () => ({ default: "goal-wizard" }));
vi.mock("@/components/goals/GoalCardMenu", () => ({ default: "goal-menu" }));
vi.mock("@/components/goals/GoalAllocationPanel", () => ({ default: "goal-allocation" }));
vi.mock("@/components/goals/GoalScenarioPlanner", () => ({ default: "scenario-planner" }));
import GoalsPage from "@/app/goals/page";
function scenarioProps(node: ReactNode): Record<string, unknown> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) { const found = scenarioProps(child); if (found) return found; }
    return undefined;
  }
  if (!isValidElement<{ children?: ReactNode }>(node)) return undefined;
  if (node.type === "scenario-planner") return node.props;
  return scenarioProps(node.props.children);
}
beforeEach(() => {
  mocks.enabled = false;
  mocks.client.auth.getUser.mockResolvedValue({ data: { user: { id: "viewer" } } });
  mocks.client.from.mockReturnValue({ select: () => ({ limit: async () => ({ data: [] }) }) });
  mocks.today.mockResolvedValue("2028-01-31");
  mocks.legacy.mockResolvedValue([{ id: "legacy", name: "Savings", target_amount: 2000, saved_amount: 300, target_date: null }]);
  mocks.funded.mockResolvedValue({ goals: [
    { id: "saving", name: "Travel", goal_type: "save_up", target_amount: 1000, saved_amount: 999, funded_amount: 400, target_date: "2028-12-31" },
    { id: "debt", name: "Loan", goal_type: "pay_down", target_amount: 5000, funded_amount: 1500, target_date: null },
  ], accounts: [], linksByGoal: new Map(), accountNames: new Map() });
});
describe("goal scenario page normalization", () => {
  it("uses legacy saved balances and explicit viewer today without inferring income contributions", async () => {
    const result = scenarioProps(await GoalsPage({ searchParams: Promise.resolve({}) }));
    expect(result).toEqual({ today: "2028-01-31", goals: [{ id: "legacy", name: "Savings", targetAmount: 2000, fundedAmount: 300, targetDate: null }] });
    expect(mocks.today).toHaveBeenCalledWith(mocks.client, "viewer");
  });
  it("uses v2 funded balances and only savings goals", async () => {
    mocks.enabled = true;
    const result = scenarioProps(await GoalsPage({ searchParams: Promise.resolve({}) }));
    expect(result).toEqual({ today: "2028-01-31", goals: [{ id: "saving", name: "Travel", targetAmount: 1000, fundedAmount: 400, targetDate: "2028-12-31" }] });
  });
  it("does not show savings scenarios on the pay-down tab", async () => {
    mocks.enabled = true;
    expect(scenarioProps(await GoalsPage({ searchParams: Promise.resolve({ tab: "pay_down" }) }))).toBeUndefined();
  });
});
