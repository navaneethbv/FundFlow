import { describe, it, expect } from "vitest";
import {
  buildPlanningDepthView,
  buildRecurringStatuses,
  planDebtPayoff,
  suggestSinkingFunds,
} from "@/lib/planning-depth";
import { buildPayoffPlan } from "@/lib/debt";

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

  it("supports snowball strategy ordering lowest balance first", () => {
    const plan = buildPayoffPlan({
      debts: [
        { name: "Big Loan", balance: 10000, apr: 18, minPayment: 200 },
        { name: "Small Card", balance: 500, apr: 12, minPayment: 25 },
      ],
      extraMonthly: 100,
      strategy: "snowball",
    });
    expect(plan).not.toBeNull();
    expect(plan!.order[0]).toBe("Small Card");
  });

  it("sorts avalanche debts with missing APRs and equal-APR ties", () => {
    const plan = planDebtPayoff(
      [
        { id: "d1", name: "Card", balance: 1000, apr: null },
        { id: "d2", name: "Loan", balance: 200, apr: 20 },
        { id: "d3", name: "Other", balance: 100, apr: 20 },
      ],
      100,
      "avalanche",
    );
    expect(plan.order.map((d) => d.name)).toEqual(["Other", "Loan", "Card"]);
  });

  it("sorts snowball debts with equal balances by APR", () => {
    const plan = planDebtPayoff(
      [
        { id: "d1", name: "Card", balance: 500, apr: null },
        { id: "d2", name: "Loan", balance: 500, apr: 12 },
      ],
      100,
      "snowball",
    );
    expect(plan.order.map((d) => d.name)).toEqual(["Loan", "Card"]);
  });

  it("treats missing minimum payments as zero", () => {
    const plan = planDebtPayoff([{ id: "d1", name: "Card", balance: 1000, apr: 20 }], 50, "avalanche");
    expect(plan.steps[0]!.payoffMonth).toBeGreaterThan(0);
  });

  it("handles accounts missing types, names, and balances", () => {
    const view = buildPlanningDepthView({
      accounts: [
        { name: "Checking", type: "depository", balance: 2000 },
        { name: null, type: "credit", balance: 400 },
        { name: "Loan", type: "loan", balance: null },
        { name: "Pension", type: null, balance: 9000 },
      ],
      monthlyIncome: 3000,
      monthlySpend: 2000,
      goals: [],
    });
    expect(view.surplus).toBe(1000);
    expect(view.debtPayoff).not.toBeNull();
    expect(view.debtPayoff!.order.map((d) => d.name)).toEqual(["Debt"]);
  });

  it("skips fully-funded goals in sinking-fund suggestions", () => {
    const suggestions = suggestSinkingFunds({
      monthlyIncome: 3000,
      monthlySpend: 2000,
      existingGoalPace: 0,
      goals: [
        { id: "full", name: "Full", targetAmount: 500, currentAmount: 500, monthsRemaining: 3 },
        { id: "need", name: "Need", targetAmount: 1000, currentAmount: 0, monthsRemaining: 4 },
      ],
    });
    expect(suggestions).toEqual([{ goalId: "need", monthlyContribution: 250 }]);
  });

  it("handles partial dates and zero-amount items in recurring statuses", () => {
    const statuses = buildRecurringStatuses({
      asOf: "2026",
      unusualAmountPct: 0.1,
      items: [
        { id: "i1", name: "Thing", amount: 100, itemType: "expense", nextDate: "2026" },
        { id: "i2", name: "Electric", amount: 100, itemType: "expense", nextDate: "2026-07-15" },
        { id: "i3", name: "Free", amount: 0, itemType: "expense", nextDate: "2026-07-15" },
        { id: "i4", name: "Gym", amount: 50, itemType: "expense", nextDate: "2026-07-15" },
      ],
      transactions: [
        { id: "t1", date: "2026-07", merchant: "Electric", amount: 100 },
        { id: "t2", date: "2026-07-15", merchant: "Free", amount: 5 },
        { id: "t3", date: "2026-07-15", merchant: "Gym", amount: 50 },
      ],
    });
    expect(statuses[0]!.status).toBe("expected");
    expect(statuses[1]!.status).toBe("expected");
    expect(statuses[2]!.status).toBe("paid");
    expect(statuses[3]!.status).toBe("paid");
  });
});


