import { describe, it, expect } from "vitest";
import { buildBudgetPage, proposeBudgetFromHistory } from "@/lib/budget-page";
import type { CanonicalFinanceTransaction } from "@/lib/finance-domain";

describe("lib/budget-page.ts", () => {
  const sampleTxns: CanonicalFinanceTransaction[] = [
    {
      id: "t1",
      date: "2026-07-05",
      signedAmount: -3000,
      flow: "income",
      merchant: "Employer Inc",
      groupKey: "INCOME",
      categoryKey: "PAYCHECK",
      accountId: "acc-1",
      manualAccountId: null,
      pending: false,
      source: "plaid",
      sourceTransactionId: "t1",
    },
    {
      id: "t2",
      date: "2026-07-10",
      signedAmount: 1200,
      flow: "expense",
      merchant: "Landlord",
      groupKey: "HOUSING",
      categoryKey: "RENT",
      accountId: "acc-1",
      manualAccountId: null,
      pending: false,
      source: "plaid",
      sourceTransactionId: "t2",
    },
    {
      id: "t3",
      date: "2026-07-15",
      signedAmount: 150,
      flow: "expense",
      merchant: "Trader Joes",
      groupKey: "FOOD_AND_DRINK",
      categoryKey: "GROCERIES",
      accountId: "acc-1",
      manualAccountId: null,
      pending: false,
      source: "plaid",
      sourceTransactionId: "t3",
    },
  ];

  it("builds budget page data with period limits and unbudgeted spend", () => {
    const pageData = buildBudgetPage({
      month: "2026-07",
      budgets: [
        { id: "b1", category: "PAYCHECK", monthly_limit: 2800, group_name: "income" },
        { id: "b2", category: "RENT", monthly_limit: 1200, group_name: "fixed" },
      ],
      periods: [{ budget_id: "b1", month: "2026-07-01", planned: 3000 }],
      txns: sampleTxns,
    });

    expect(pageData.month).toBe("2026-07");
    expect(pageData.totalIncome.planned).toBe(3000);
    expect(pageData.totalIncome.actual).toBe(3000);
    expect(pageData.totalExpenses.planned).toBe(1200);
    expect(pageData.totalExpenses.actual).toBe(1350); // 1200 rent + 150 unbudgeted groceries
    expect(pageData.leftToBudget).toBe(1800); // 3000 - 1200
  });

  it("proposes budget suggestions from 3-month history", () => {
    const proposals = proposeBudgetFromHistory({
      txnsLast3Months: sampleTxns,
      recurringTransactionIds: new Set(["t2"]),
    });

    expect(proposals.length).toBeGreaterThan(0);
    const rentProposal = proposals.find((p) => p.category === "rent");
    expect(rentProposal?.group_name).toBe("fixed");
    expect(rentProposal?.suggested_amount).toBe(400); // 1200 / 3
  });
});
