import { describe, expect, it } from "vitest";
import { parseBudgetHorizon, parseBudgetMonth, buildBudgetView, proposeBudgetFromHistory } from "@/lib/budget-page";

describe("budget-page extra helper unit tests", () => {
  it("parses horizon and month correctly with fallbacks", () => {
    expect(parseBudgetHorizon("yearly")).toBe("yearly");
    expect(parseBudgetHorizon("decade")).toBe("decade");
    expect(parseBudgetHorizon("invalid")).toBe("monthly");

    expect(parseBudgetMonth("2026-07", "2026-01")).toBe("2026-07");
    expect(parseBudgetMonth("invalid", "2026-01")).toBe("2026-01");
  });

  it("builds budget view with goal contributions", () => {
    const view = buildBudgetView({
      month: "2026-07",
      horizon: "monthly",
      budgets: [],
      periods: [],
      txns: [],
      sinkingFunds: [],
      goalContributions: [
        { name: "Emergency Fund", planned: 200, actual: 150 },
      ],
    });

    expect(view.horizon).toBe("monthly");
    if (view.horizon === "monthly") {
      expect(view.month.contributions.goals).toHaveLength(1);
      expect(view.month.contributions.goals[0].planned).toBe(200);
    }
  });

  it("proposes budget from history with income, expense, and sinking funds", () => {
    const proposals = proposeBudgetFromHistory({
      txnsLast3Months: [
        {
          date: "2026-04-15",
          signedAmount: -3000,
          flow: "income" as const,
          merchant: "Payroll",
          groupKey: "INCOME",
          categoryKey: "INCOME_WAGES",
          id: "t1",
          sourceTransactionId: "s1",
          accountId: "a1",
          manualAccountId: null,
          pending: false,
          source: "plaid" as const,
        },
        {
          date: "2026-05-01",
          signedAmount: 50,
          flow: "expense" as const,
          merchant: "Netflix",
          groupKey: "ENTERTAINMENT",
          categoryKey: "entertainment_streaming",
          id: "t2",
          sourceTransactionId: "s2",
          accountId: "a1",
          manualAccountId: null,
          pending: false,
          source: "plaid" as const,
        },
      ],
      recurringTransactionIds: new Set(["s2"]),
      sinkingFunds: [
        {
          name: "Car Insurance",
          targetAmount: 600,
          dueDate: "2026-12-31",
          monthsLeft: 6,
          monthlySetAside: 100,
          dueSoon: false,
        },
      ],
    });

    expect(proposals.length).toBeGreaterThanOrEqual(2);
    const incomeProposal = proposals.find(
      (p) => p.category === "income_wages",
    );
    expect(incomeProposal).toBeDefined();
    expect(incomeProposal!.group_name).toBe("income");
    expect(incomeProposal!.reason).toContain("income");

    const streamingProposal = proposals.find(
      (p) => p.category === "entertainment_streaming",
    );
    expect(streamingProposal).toBeDefined();
    expect(streamingProposal!.group_name).toBe("fixed");

    const sinkingProposal = proposals.find(
      (p) => p.category === "car insurance",
    );
    expect(sinkingProposal).toBeDefined();
    expect(sinkingProposal!.group_name).toBe("non_monthly");
    expect(sinkingProposal!.rollover_enabled).toBe(true);
  });

  it("skips transfer transactions and existing categories", () => {
    const proposals = proposeBudgetFromHistory({
      txnsLast3Months: [
        {
          date: "2026-06-01",
          signedAmount: 200,
          flow: "transfer" as const,
          merchant: "Transfer",
          groupKey: "TRANSFER",
          categoryKey: "transfer_internal",
          id: "t3",
          sourceTransactionId: "s3",
          accountId: "a1",
          manualAccountId: null,
          pending: false,
          source: "plaid" as const,
        },
        {
          date: "2026-06-02",
          signedAmount: 80,
          flow: "expense" as const,
          merchant: "Groceries",
          groupKey: "FOOD",
          categoryKey: "FOOD_GROCERIES",
          id: "t4",
          sourceTransactionId: "s4",
          accountId: "a1",
          manualAccountId: null,
          pending: false,
          source: "plaid" as const,
        },
      ],
      existingCategories: new Set(["food_groceries"]),
    });

    expect(proposals).toHaveLength(0);
  });

  it("filters out zero-amount proposals", () => {
    const proposals = proposeBudgetFromHistory({
      txnsLast3Months: [
        {
          date: "2026-06-01",
          signedAmount: 0,
          flow: "expense" as const,
          merchant: "Free Trial",
          groupKey: "MISC",
          categoryKey: "misc_free",
          id: "t5",
          sourceTransactionId: "s5",
          accountId: "a1",
          manualAccountId: null,
          pending: false,
          source: "plaid" as const,
        },
      ],
    });

    expect(proposals).toHaveLength(0);
  });
});
