import { describe, expect, it } from "vitest";
import {
  budgetWindow,
  buildBudgetPage,
  buildBudgetView,
  proposeBudgetFromHistory,
} from "@/lib/budget-page";
import type { CanonicalFinanceTransaction } from "@/lib/finance-domain";
import type { SinkingFundPlan } from "@/lib/insights";

function transaction(
  id: string,
  date: string,
  amount: number,
  category: string,
  flow: "income" | "expense" | "transfer" = "expense",
  sourceTransactionId = id,
): CanonicalFinanceTransaction {
  return {
    id,
    sourceTransactionId,
    date,
    signedAmount: amount,
    flow,
    merchant: "Merchant",
    groupKey: flow === "income" ? "INCOME" : "EXPENSE",
    categoryKey: category,
    accountId: "account-1",
    manualAccountId: null,
    pending: false,
    source: "plaid",
  };
}

const budgets = [
  {
    id: "income",
    category: "PAYCHECK",
    monthly_limit: 3000,
    group_name: "income",
    rollover_enabled: false,
    sort_order: 0,
  },
  {
    id: "rent",
    category: "RENT",
    monthly_limit: 1200,
    group_name: "fixed",
    rollover_enabled: false,
    sort_order: 0,
  },
  {
    id: "groceries",
    category: "GROCERIES",
    monthly_limit: 500,
    group_name: "flexible",
    rollover_enabled: true,
    sort_order: 1,
  },
];

describe("budgetWindow", () => {
  it("uses inclusive starts and exclusive ends at calendar boundaries", () => {
    expect(budgetWindow("2026-12", "monthly")).toEqual({
      start: "2026-12-01",
      endExclusive: "2027-01-01",
    });
    expect(budgetWindow("2028-02", "monthly")).toEqual({
      start: "2028-02-01",
      endExclusive: "2028-03-01",
    });
    expect(budgetWindow("2026-07", "yearly")).toEqual({
      start: "2026-01-01",
      endExclusive: "2027-01-01",
    });
    expect(budgetWindow("2026-07", "decade")).toEqual({
      start: "2020-01-01",
      endExclusive: "2030-01-01",
    });
  });

  it("rejects malformed anchor months", () => {
    expect(() => budgetWindow("2026-7", "monthly")).toThrow(
      "invalid_budget_month",
    );
    expect(() => budgetWindow("2026-13", "monthly")).toThrow(
      "invalid_budget_month",
    );
  });
});

describe("buildBudgetPage", () => {
  it("uses a period override, canonical signs, and unbudgeted spending", () => {
    const page = buildBudgetPage({
      month: "2026-07",
      budgets: budgets.map((budget) => ({
        ...budget,
        rollover_enabled: false,
      })),
      periods: [
        { budget_id: "income", month: "2026-07-01", planned: 3200 },
      ],
      txns: [
        transaction("pay", "2026-07-05", -3100, "PAYCHECK", "income"),
        transaction("rent", "2026-07-10", 1200, "RENT"),
        transaction("food", "2026-07-15", 150, "GROCERIES"),
        transaction("fun", "2026-07-20", 25, "ENTERTAINMENT"),
        transaction("move", "2026-07-21", 500, "TRANSFER", "transfer"),
      ],
    });

    expect(page.totalIncome).toEqual({ planned: 3200, actual: 3100 });
    expect(page.totalExpenses).toEqual({
      planned: 1700,
      actual: 1375,
      remaining: 325,
    });
    expect(page.leftToBudget).toBe(1500);
    expect(page.sections.find((section) => section.key === "flexible"))
      .toMatchObject({ unbudgetedCount: 1 });
  });

  it("carries the prior month remainder for rollover budgets and floors at zero", () => {
    const positive = buildBudgetPage({
      month: "2026-07",
      budgets,
      txns: [
        transaction("june-food", "2026-06-10", 300, "GROCERIES"),
        transaction("july-food", "2026-07-10", 100, "GROCERIES"),
      ],
    });
    const negative = buildBudgetPage({
      month: "2026-07",
      budgets,
      txns: [
        transaction("june-food", "2026-06-10", 1200, "GROCERIES"),
        transaction("july-food", "2026-07-10", 10, "GROCERIES"),
      ],
    });

    const positiveLine = positive.sections
      .flatMap((section) => section.lines)
      .find((line) => line.budgetId === "groceries");
    const negativeLine = negative.sections
      .flatMap((section) => section.lines)
      .find((line) => line.budgetId === "groceries");
    expect(positiveLine).toMatchObject({
      planned: 700,
      rolloverCarry: 200,
      remaining: 600,
    });
    expect(negativeLine).toMatchObject({
      planned: 0,
      rolloverCarry: -700,
      remaining: -10,
    });
  });

  it("uses computed sinking-fund set-asides instead of unspent envelopes", () => {
    const funds: SinkingFundPlan[] = [
      {
        name: "Insurance",
        targetAmount: 600,
        dueDate: "2027-01-01",
        monthsLeft: 6,
        monthlySetAside: 100,
        dueSoon: false,
      },
    ];
    const page = buildBudgetPage({
      month: "2026-07",
      budgets,
      txns: [],
      sinkingFunds: funds,
    });

    expect(page.sinkingFundsTotal).toBe(100);
  });
});

describe("buildBudgetView", () => {
  it("builds a Year from 12 distinct monthly calculations", () => {
    const view = buildBudgetView({
      month: "2026-07",
      horizon: "yearly",
      budgets: budgets.map((budget) => ({
        ...budget,
        rollover_enabled: false,
      })),
      periods: [
        { budget_id: "groceries", month: "2026-02-01", planned: 700 },
      ],
      txns: [
        transaction("jan", "2026-01-10", 100, "GROCERIES"),
        transaction("feb", "2026-02-10", 200, "GROCERIES"),
      ],
    });

    expect(view.horizon).toBe("yearly");
    if (view.horizon !== "yearly") throw new Error("wrong horizon");
    expect(view.months).toHaveLength(12);
    expect(view.months[0]?.month).toBe("2026-01");
    expect(view.months[0]?.totalExpenses.actual).toBe(100);
    expect(view.months[1]?.totalExpenses).toMatchObject({
      planned: 1900,
      actual: 200,
    });
    expect(view.months[2]?.totalExpenses.actual).toBe(0);
  });

  it("builds Decade annual rollups only for years with actuals or overrides", () => {
    const view = buildBudgetView({
      month: "2026-07",
      horizon: "decade",
      budgets,
      periods: [
        { budget_id: "groceries", month: "2028-04-01", planned: 650 },
      ],
      txns: [
        transaction("old", "2024-01-10", 100, "GROCERIES"),
        transaction("new", "2026-02-10", 200, "GROCERIES"),
      ],
    });

    expect(view.horizon).toBe("decade");
    if (view.horizon !== "decade") throw new Error("wrong horizon");
    expect(view.years.map((year) => year.year)).toEqual([2024, 2026, 2028]);
    expect(view.years[0]).toMatchObject({ actual: 100 });
    expect(view.years[1]).toMatchObject({ actual: 200 });
  });
});

describe("proposeBudgetFromHistory", () => {
  it("uses source transaction ids and recurring spend share for classification", () => {
    const proposals = proposeBudgetFromHistory({
      txnsLast3Months: [
        transaction("rent::0", "2026-05-01", 700, "RENT", "expense", "rent-1"),
        transaction("rent::1", "2026-05-01", 500, "RENT", "expense", "rent-1"),
        transaction("rent-2", "2026-06-01", 1200, "RENT"),
        transaction("rent-3", "2026-07-01", 1200, "RENT"),
      ],
      recurringTransactionIds: new Set(["rent-1", "rent-2"]),
    });

    expect(proposals).toContainEqual(
      expect.objectContaining({
        category: "rent",
        group_name: "fixed",
        suggested_amount: 1200,
      }),
    );
  });

  it("turns existing sinking funds into deterministic Non-Monthly proposals", () => {
    const proposals = proposeBudgetFromHistory({
      txnsLast3Months: [],
      sinkingFunds: [
        {
          name: "Annual Insurance",
          targetAmount: 600,
          dueDate: "2027-01-01",
          monthsLeft: 6,
          monthlySetAside: 100,
          dueSoon: false,
        },
      ],
    });

    expect(proposals).toEqual([
      expect.objectContaining({
        category: "annual insurance",
        group_name: "non_monthly",
        suggested_amount: 100,
      }),
    ]);
  });

  it("proposes income and flexible expense groups from history and skips existing budgets", () => {
    const proposals = proposeBudgetFromHistory({
      txnsLast3Months: [
        transaction("pay-1", "2026-05-01", -3000, "PAYCHECK", "income"),
        transaction("pay-2", "2026-06-01", -3000, "PAYCHECK", "income"),
        transaction("coffee-1", "2026-05-10", 15, "COFFEE"),
        transaction("coffee-2", "2026-06-10", 20, "COFFEE"),
      ],
      existingCategories: new Set(["paycheck"]),
    });

    expect(proposals).toContainEqual(
      expect.objectContaining({
        category: "coffee",
        group_name: "flexible",
      }),
    );
    expect(proposals.some((p) => p.category === "paycheck")).toBe(false);
  });
});
