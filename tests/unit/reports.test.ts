import { describe, it, expect } from "vitest";
import { summarizeTransactions, buildCashFlowSankeyData } from "@/lib/reports";
import type { CanonicalFinanceTransaction } from "@/lib/finance-domain";

describe("lib/reports.ts", () => {
  const txns: CanonicalFinanceTransaction[] = [
    {
      id: "t1",
      date: "2026-07-01",
      signedAmount: -2000,
      flow: "income",
      merchant: "Workplace",
      groupKey: "INCOME",
      categoryKey: "SALARY",
      accountId: "acc-1",
      manualAccountId: null,
      pending: false,
      source: "plaid",
      sourceTransactionId: "t1",
    },
    {
      id: "t2",
      date: "2026-07-10",
      signedAmount: 500,
      flow: "expense",
      merchant: "Market",
      groupKey: "FOOD_AND_DRINK",
      categoryKey: "GROCERIES",
      accountId: "acc-1",
      manualAccountId: null,
      pending: false,
      source: "plaid",
      sourceTransactionId: "t2",
    },
  ];

  it("summarizes transaction metrics", () => {
    const summary = summarizeTransactions(txns);
    expect(summary.totalTransactions).toBe(2);
    expect(summary.totalIncome).toBe(2000);
    expect(summary.totalSpending).toBe(500);
    expect(summary.largest).toBe(2000);
  });

  it("builds Sankey nodes and links data", () => {
    const sankeyData = buildCashFlowSankeyData(txns);
    expect(sankeyData.nodes.length).toBeGreaterThanOrEqual(3);
    expect(sankeyData.links.length).toBeGreaterThanOrEqual(2);
  });
});
