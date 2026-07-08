import { describe, it, expect } from "vitest";
import { buildPlanningDepthView } from "@/lib/planning-depth";

const goals = [
  { id: "g1", name: "Emergency", targetAmount: 6000, currentAmount: 1000, monthsRemaining: 10 },
  { id: "g2", name: "Trip", targetAmount: 2000, currentAmount: 0, monthsRemaining: 4 },
];

describe("buildPlanningDepthView", () => {
  it("plans avalanche payoff from surplus and orders by APR", () => {
    const view = buildPlanningDepthView({
      accounts: [
        { name: "Visa", type: "credit", balance: 1200, apr: 0.24 },
        { name: "Loan", type: "loan", balance: 5000, apr: 0.06 },
        { name: "Checking", type: "depository", balance: 3000 },
      ],
      monthlyIncome: 4000,
      monthlySpend: 3000,
      goals: [],
    });
    expect(view.surplus).toBe(1000);
    expect(view.debtPayoff).not.toBeNull();
    // Highest APR first (avalanche).
    expect(view.debtPayoff!.order[0]!.name).toBe("Visa");
    expect(view.debtPayoff!.order.map((d) => d.name)).not.toContain("Checking");
  });

  it("returns no payoff plan when there is no surplus", () => {
    const view = buildPlanningDepthView({
      accounts: [{ name: "Visa", type: "credit", balance: 1200 }],
      monthlyIncome: 2000,
      monthlySpend: 2500,
      goals: [],
    });
    expect(view.surplus).toBeLessThanOrEqual(0);
    expect(view.debtPayoff).toBeNull();
  });

  it("returns no payoff plan when there are no liabilities", () => {
    const view = buildPlanningDepthView({
      accounts: [{ name: "Checking", type: "depository", balance: 3000 }],
      monthlyIncome: 4000,
      monthlySpend: 3000,
      goals: [],
    });
    expect(view.debtPayoff).toBeNull();
  });

  it("suggests sinking-fund contributions that never exceed the surplus", () => {
    const view = buildPlanningDepthView({
      accounts: [],
      monthlyIncome: 4000,
      monthlySpend: 3700,
      goals,
    });
    const total = view.sinkingFunds.reduce((sum, s) => sum + s.monthlyContribution, 0);
    expect(view.surplus).toBe(300);
    expect(total).toBeLessThanOrEqual(view.surplus + 0.001);
    expect(view.sinkingFunds.length).toBeGreaterThan(0);
  });

  it("suggests nothing when the month runs a deficit", () => {
    const view = buildPlanningDepthView({
      accounts: [],
      monthlyIncome: 3000,
      monthlySpend: 3200,
      goals,
    });
    expect(view.sinkingFunds).toEqual([]);
  });
});
