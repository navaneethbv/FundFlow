import { describe, expect, it } from "vitest";
import {
  proposeBudgetFromHistory,
  buildBudgetView,
  parseBudgetHorizon,
} from "@/lib/budget-page";
import {
  computeForecastDefaults,
  computeForecastMilestones,
  parseForecastAssumptions,
} from "@/lib/forecasting";
import { goalTargetAmount, computeFundedGoals, goalContributionsForMonth } from "@/lib/goals-v2";
import {
  loadHoldings,
  loadHoldingSnapshots,
  loadInvestmentTransactions,
  loadHoldingAccountOptions,
} from "@/lib/investments-data";
import { loadAdvicePageData } from "@/lib/advice-data";
import { loadForecastPageData } from "@/lib/forecasting-data";
import { clientStub } from "../fixtures/supabase-query";
import type { GoalV2Row } from "@/lib/goals-v2";

describe("Budget Page Projections and Seed Proposals", () => {
  it("computes decade budget projection with transactions inside and outside decade range", () => {
    expect(parseBudgetHorizon("yearly")).toBe("yearly");
    expect(parseBudgetHorizon("decade")).toBe("decade");
    expect(parseBudgetHorizon("other")).toBe("monthly");

    const projection = buildBudgetView({
      horizon: "decade",
      month: "2026-08",
      txns: [
        {
          id: "t1",
          sourceTransactionId: "t1",
          date: "2025-05-10",
          signedAmount: 100,
          flow: "expense" as const,
          categoryKey: "Groceries",
          groupKey: "FOOD_AND_DRINK",
          merchant: "Store",
          accountId: null,
          manualAccountId: null,
          pending: false,
          source: "manual" as const,
        },
        {
          id: "t2",
          sourceTransactionId: "t2",
          date: "2019-12-31", // outside 2020-2029 decade
          signedAmount: 50,
          flow: "expense" as const,
          categoryKey: "Dining",
          groupKey: "FOOD_AND_DRINK",
          merchant: "Cafe",
          accountId: null,
          manualAccountId: null,
          pending: false,
          source: "manual" as const,
        },
      ],
      budgets: [{ id: "b-groc", category: "Groceries", monthly_limit: 500 }],
      periods: [{ budget_id: "b-groc", month: "2026-08", planned: 500 }],
    });
    expect(projection.horizon).toBe("decade");
    if (projection.horizon === "decade") {
      expect(projection.startYear).toBe(2020);
      expect(projection.years.length).toBeGreaterThan(0);
    }
  });

  it("handles history proposal generation with sinking funds and existing categories", () => {
    const proposals = proposeBudgetFromHistory({
      txnsLast3Months: [
        {
          id: "t1",
          sourceTransactionId: "t1",
          date: "2026-06-01",
          signedAmount: 150,
          flow: "expense" as const,
          categoryKey: "Groceries",
          groupKey: "FOOD_AND_DRINK",
          merchant: "Target",
          accountId: null,
          manualAccountId: null,
          pending: false,
          source: "manual" as const,
        },
        {
          id: "t2",
          sourceTransactionId: "t2",
          date: "2026-07-01",
          signedAmount: -2000,
          flow: "income" as const,
          categoryKey: "Salary",
          groupKey: "INCOME",
          merchant: "Acme",
          accountId: null,
          manualAccountId: null,
          pending: false,
          source: "manual" as const,
        },
        {
          id: "t3",
          sourceTransactionId: "t3",
          date: "2026-07-02",
          signedAmount: 100,
          flow: "transfer" as const, // skipped
          categoryKey: "Transfer",
          groupKey: "TRANSFER",
          merchant: "Bank",
          accountId: null,
          manualAccountId: null,
          pending: false,
          source: "manual" as const,
        },
        {
          id: "t4",
          sourceTransactionId: "t4",
          date: "2026-07-03",
          signedAmount: 75,
          flow: "expense" as const,
          categoryKey: "", // falls back to uncategorized
          groupKey: "GENERAL_SERVICES",
          merchant: "Shop",
          accountId: null,
          manualAccountId: null,
          pending: false,
          source: "manual" as const,
        },
      ],
      sinkingFunds: [
        {
          name: "Car Insurance",
          monthlySetAside: 100,
          dueDate: "2026-12-01",
          targetAmount: 600,
          monthsLeft: 4,
          dueSoon: true,
        },
        {
          name: "   ", // empty name ignored
          monthlySetAside: 50,
          dueDate: "2026-12-01",
          targetAmount: 300,
          monthsLeft: 4,
          dueSoon: false,
        },
      ],
      existingCategories: new Set(["salary"]),
    });
    expect(proposals.length).toBeGreaterThan(0);
    expect(proposals.some((p) => p.category === "groceries")).toBe(true);
    expect(proposals.some((p) => p.category === "car insurance")).toBe(true);
  });
});

describe("Forecasting Milestones and Assumptions", () => {
  it("computes forecast defaults with empty and non-empty months", () => {
    const emptyDefaults = computeForecastDefaults([], []);
    expect(emptyDefaults.monthlySavings).toBe(0);
    expect(emptyDefaults.monthlyDebtPayment).toBe(0);

    const defaults = computeForecastDefaults(
      [
        {
          id: "t1",
          sourceTransactionId: "t1",
          date: "2026-07-01",
          signedAmount: -3000,
          flow: "income" as const,
          categoryKey: "Income",
          groupKey: "INCOME",
          merchant: "Employer",
          accountId: null,
          manualAccountId: null,
          pending: false,
          source: "manual" as const,
        },
        {
          id: "t2",
          sourceTransactionId: "t2",
          date: "2026-07-02",
          signedAmount: 500,
          flow: "expense" as const,
          categoryKey: "Loan",
          groupKey: "LOAN_PAYMENTS",
          merchant: "Lender",
          accountId: null,
          manualAccountId: null,
          pending: false,
          source: "manual" as const,
        },
      ],
      ["2026-07"],
    );
    expect(defaults.monthlySavings).toBeGreaterThan(0);
    expect(defaults.monthlyDebtPayment).toBe(500);
  });

  it("parses forecast assumptions with various URL query params", () => {
    const defaults = { monthlySavings: 1000, monthlyDebtPayment: 200 };
    const assumptions = parseForecastAssumptions(
      {
        horizon: "60",
        monthlySavings: "1500",
        annualReturnPct: "7",
        annualCashYieldPct: "3",
        monthlyDebtPayment: "300",
      },
      defaults,
    );
    expect(assumptions.horizonMonths).toBe(60);
    expect(assumptions.monthlySavings).toBe(1500);
    expect(assumptions.annualReturnPct).toBe(7);
    expect(assumptions.annualCashYieldPct).toBe(3);
    expect(assumptions.monthlyDebtPayment).toBe(300);

    const fallbackAssumptions = parseForecastAssumptions({ horizon: "invalid" }, defaults);
    expect(fallbackAssumptions.horizonMonths).toBe(12);
  });

  it("evaluates milestones when cash already exceeds emergency fund and net worth exceeds targets", () => {
    const highStartingState = {
      cash: 50000,
      investments: 2000000,
      liabilities: 0,
      monthlyIncome: 10000,
      monthlyExpenses: 2000,
    };
    const assumptions = {
      horizonMonths: 12 as const,
      monthlySavings: 5000,
      annualReturnPct: 5,
      annualCashYieldPct: 0,
      monthlyDebtPayment: 0,
    };
    const milestones = computeForecastMilestones(highStartingState, assumptions, 2000);
    // EF milestones should be reached at month 0
    const ef3 = milestones.find((m) => m.id === "ef-3mo");
    expect(ef3?.reachedMonth).toBe(0);
    // No debt-free milestone if liabilities is 0
    expect(milestones.find((m) => m.id === "debt-free")).toBeUndefined();
  });
});

describe("Goals V2 Edge Cases", () => {
  it("calculates goalTargetAmount for pay-down goals with entered vs fallback balance", () => {
    const payDownWithTarget: GoalV2Row = {
      id: "g1",
      name: "Pay Card",
      target_amount: 1500,
      saved_amount: 0,
      monthly_contribution: 200,
      target_date: "2026-12-31",
      goal_type: "pay_down",
      image_slug: null,
      spending_reduces: false,
      starting_balance: 2000,
      target_balance: 500,
    };
    expect(goalTargetAmount(payDownWithTarget)).toBe(1500);

    const payDownFallback: GoalV2Row = {
      ...payDownWithTarget,
      target_amount: 0,
      starting_balance: null,
      target_balance: null,
    };
    expect(goalTargetAmount(payDownFallback)).toBe(0);
  });

  it("sorts funded goals by target date presence, completion status, and name tie-breakers", () => {
    const goals: GoalV2Row[] = [
      {
        id: "g1",
        name: "Goal Without Date B",
        target_amount: 1000,
        saved_amount: 100,
        monthly_contribution: 50,
        target_date: null,
        goal_type: "save_up",
        image_slug: null,
        spending_reduces: false,
        starting_balance: null,
        target_balance: null,
      },
      {
        id: "g1-a",
        name: "Goal Without Date A",
        target_amount: 1000,
        saved_amount: 100,
        monthly_contribution: 50,
        target_date: null,
        goal_type: "save_up",
        image_slug: null,
        spending_reduces: false,
        starting_balance: null,
        target_balance: null,
      },
      {
        id: "g2-b",
        name: "Goal With Soon Date B",
        target_amount: 1000,
        saved_amount: 100,
        monthly_contribution: 50,
        target_date: "2026-09-01",
        goal_type: "save_up",
        image_slug: null,
        spending_reduces: false,
        starting_balance: null,
        target_balance: null,
      },
      {
        id: "g2-a",
        name: "Goal With Soon Date A",
        target_amount: 1000,
        saved_amount: 100,
        monthly_contribution: 50,
        target_date: "2026-09-01",
        goal_type: "save_up",
        image_slug: null,
        spending_reduces: false,
        starting_balance: null,
        target_balance: null,
      },
    ];

    const funded = computeFundedGoals(
      goals,
      [{ goal_id: "g1", account_id: "non-existent-account", allocated_amount: 100, use_entire_balance: false }],
      [],
      [],
      new Date("2026-08-01"),
    );
    expect(funded[0]?.name).toBe("Goal With Soon Date A");
    expect(funded[1]?.name).toBe("Goal With Soon Date B");
    expect(funded[2]?.name).toBe("Goal Without Date A");
    expect(funded[3]?.name).toBe("Goal Without Date B");

    // goalContributionsForMonth with tie-breaker
    const lines = goalContributionsForMonth(
      [
        { id: "g-b", name: "Goal B", monthly_contribution: 100 },
        { id: "g-a", name: "Goal A", monthly_contribution: 100 },
      ],
      [],
      "2026-08",
    );
    expect(lines[0]?.name).toBe("Goal A");
    expect(lines[1]?.name).toBe("Goal B");
  });
});

describe("Investments Data Loader Branches", () => {
  it("loads holdings with manual account joins and fallback security values", async () => {
    const client = clientStub({
      holdings: {
        data: [
          {
            id: "h1",
            account_id: null,
            manual_account_id: "m1",
            quantity: 50,
            institution_price: null,
            institution_value: 500,
            source: "manual",
            is_active: true,
            securities: {
              name: "Custom Asset",
              ticker: null,
              security_type: "crypto",
              close_price: 10,
            },
          },
          {
            id: "h2",
            account_id: "a1",
            manual_account_id: null,
            quantity: 10,
            institution_price: 100,
            institution_value: 1000,
            source: "plaid",
            is_active: true,
            securities: null,
          },
        ],
      },
      accounts: { data: [{ id: "a1", name: null }] },
      manual_accounts: { data: [{ id: "m1", name: "Offline Vault" }] },
    });

    const holdings = await loadHoldings(client as never);
    expect(holdings).toHaveLength(2);
    expect(holdings[0]?.accountName).toBe("Offline Vault");
    expect(holdings[0]?.price).toBe(10);
    expect(holdings[1]?.accountName).toBe("Account");
    expect(holdings[1]?.securityName).toBe("Unnamed security");
  });

  it("loads snapshots and investment transactions", async () => {
    const client = clientStub({
      holding_snapshots: {
        data: [{ holding_id: "h1", snapshot_date: "2026-08-01", quantity: 5, price: 20, value: 100 }],
      },
      investment_transactions: {
        data: [{ date: "2026-08-01", amount: -50, txn_subtype: "dividend" }],
      },
    });

    const snapshots = await loadHoldingSnapshots(client as never, { since: "2026-07-01" });
    expect(snapshots).toHaveLength(1);

    const txns = await loadInvestmentTransactions(client as never);
    expect(txns).toHaveLength(1);
  });

  it("loads holding account options with null account names", async () => {
    const client = clientStub({
      accounts: { data: [{ id: "a1", name: null }] },
      manual_accounts: { data: [{ id: "m1", name: "Manual Wallet" }] },
    });

    const options = await loadHoldingAccountOptions(client as never, "u-1");
    expect(options).toHaveLength(2);
    expect(options[0]?.name).toBe("Account");
    expect(options[1]?.name).toBe("Manual Wallet");
  });

  it("loads advice page data with cash, credit carry, and manual investment accounts", async () => {
    const client = clientStub({
      accounts: {
        data: [
          { type: "depository", subtype: "checking", current_balance: 5000 },
          { type: "credit", subtype: "credit card", current_balance: 200 },
        ],
      },
      manual_accounts: {
        data: [{ account_type: "investment", balance: 10000 }],
      },
      budgets: { data: [{ id: "b-1" }] },
      goals: { data: [{ id: "g-1" }] },
      profiles: {
        data: {
          advice_priorities: ["emergency-fund"],
          advice_profile: { hasDependents: true },
        },
      },
      advice_progress: { data: [{ advice_id: "emergency-fund", task_id: "compare" }] },
      transactions: {
        data: [
          { date: "2026-06-01", amount: 500, pfc_primary: "FOOD_AND_DRINK" },
          { date: "2026-07-01", amount: 600, pfc_primary: "FOOD_AND_DRINK" },
        ],
      },
    });

    const adviceData = await loadAdvicePageData(client as never, "u-1", "2026-08-15");
    expect(adviceData.ctx.creditCardCarry).toBe(true);
    expect(adviceData.ctx.hasInvestments).toBe(true);
    expect(adviceData.ctx.hasBudget).toBe(true);
    expect(adviceData.ctx.hasGoals).toBe(true);
    expect(adviceData.priorities).toEqual(["emergency-fund"]);
  });

  it("loads forecast page data with starting state and trailing projection defaults", async () => {
    const client = clientStub({
      accounts: {
        data: [
          { type: "depository", subtype: "checking", current_balance: 10000 },
          { type: "credit", subtype: "credit card", current_balance: 500 },
        ],
      },
      manual_accounts: {
        data: [
          { account_type: "investment", balance: 50000 },
          { account_type: "liability", balance: 20000 },
        ],
      },
      transactions: {
        data: [
          { date: "2026-05-01", amount: -4000, pfc_primary: "INCOME" },
          { date: "2026-05-10", amount: 1500, pfc_primary: "GENERAL_SERVICES" },
        ],
      },
    });

    const forecastData = await loadForecastPageData(client as never, "u-1", "2026-08-15");
    expect(forecastData.startingState.cash).toBe(10000);
    expect(forecastData.startingState.investments).toBe(50000);
    expect(forecastData.startingState.liabilities).toBe(20500);
  });

  it("handles investments data loaders with empty data and database errors", async () => {
    const emptyClient = clientStub({
      holdings: { data: null },
      holding_snapshots: { data: null },
      investment_transactions: { data: null },
      accounts: { data: null },
      manual_accounts: { data: null },
    });

    expect(await loadHoldings(emptyClient as never)).toEqual([]);
    expect(await loadHoldingSnapshots(emptyClient as never)).toEqual([]);
    expect(await loadInvestmentTransactions(emptyClient as never)).toEqual([]);
    expect(await loadHoldingAccountOptions(emptyClient as never, "u-1")).toEqual([]);

    const errClient = clientStub({
      accounts: { data: [] },
      manual_accounts: { error: new Error("Manual accounts table error") },
    });
    await expect(loadHoldingAccountOptions(errClient as never, "u-1")).rejects.toThrow("Manual accounts table error");
  });
});
