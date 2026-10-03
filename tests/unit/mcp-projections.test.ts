import { describe, expect, it } from "vitest";
import {
  buildMcpAggregateRows,
  buildMcpNetWorthTrend,
  buildMcpRecurringRows,
} from "@/lib/mcp-projections";

const tx = (overrides: Record<string, unknown> = {}) => ({
  id: "internal-id",
  sourceTransactionId: "internal-id",
  date: "2026-01-10",
  signedAmount: 25,
  flow: "expense" as const,
  merchant: "Private merchant",
  groupKey: "FOOD_AND_DRINK",
  categoryKey: "FOOD_AND_DRINK",
  accountId: "account-id",
  manualAccountId: null,
  pending: false,
  source: "plaid" as const,
  ...overrides,
});

describe("MCP projections", () => {
  it("keeps only month/category totals and suppresses groups smaller than three rows", () => {
    const rows = buildMcpAggregateRows([
      tx(),
      tx({ id: "2", sourceTransactionId: "2", signedAmount: 30 }),
      tx({ id: "3", sourceTransactionId: "3", signedAmount: -5, flow: "expense" }),
      tx({ id: "4", sourceTransactionId: "4", date: "2026-02-02" }),
      tx({ id: "5", sourceTransactionId: "5", flow: "transfer", groupKey: "TRANSFER_OUT" }),
    ]);
    expect(rows).toEqual([
      {
        month: "2026-01-01",
        category: "FOOD_AND_DRINK",
        totalAmount: 50,
        outflowTotal: 55,
        inflowTotal: 0,
        transactionCount: 3,
      },
    ]);
    expect(JSON.stringify(rows)).not.toContain("Private merchant");
    expect(JSON.stringify(rows)).not.toContain("internal-id");
  });

  it("filters categories, preserves income totals, and normalizes uncategorized values", () => {
    const rows = buildMcpAggregateRows([
      tx({ categoryKey: "", signedAmount: -20, flow: "income" }),
      tx({ id: "2", sourceTransactionId: "2", categoryKey: "", signedAmount: -30, flow: "income" }),
      tx({ id: "3", sourceTransactionId: "3", categoryKey: "", signedAmount: -40, flow: "income" }),
      tx({ id: "4", sourceTransactionId: "4", categoryKey: "OTHER", signedAmount: 10 }),
      tx({ id: "5", sourceTransactionId: "5", categoryKey: "OTHER", signedAmount: 10 }),
      tx({ id: "6", sourceTransactionId: "6", categoryKey: "OTHER", signedAmount: 10 }),
    ], " uncategorized ");
    expect(rows).toEqual([{ month: "2026-01-01", category: "UNCATEGORIZED", totalAmount: -90, outflowTotal: 0, inflowTotal: 90, transactionCount: 3 }]);
  });

  it("collapses recurring rows and derives net worth", () => {
    expect(buildMcpRecurringRows([
      { amount: 50, frequency: "MONTHLY", category: "Utilities", itemType: "outflow" },
      { amount: 25, frequency: "MONTHLY", category: "Utilities", itemType: "expense" },
      { amount: 2, frequency: "MONTHLY", category: "Hidden", itemType: "expense", enabled: false },
    ])).toEqual([{ category: "Utilities", frequency: "monthly", kind: "expense", amount: 75, count: 2 }]);
    expect(buildMcpNetWorthTrend([{ snapshot_month: "2026-02-01", assets: "100", liabilities: 40 }])).toEqual([
      { month: "2026-02-01", assets: 100, liabilities: 40, netWorth: 60 },
    ]);
  });

  it("handles inactive recurring rows, income streams, and non-finite values", () => {
    expect(buildMcpRecurringRows([
      { amount: null, frequency: null, category: null, itemType: "income" },
      { amount: "not-a-number", frequency: "weekly", category: "Pay", itemType: null, streamType: "inflow" },
      { amount: 5, frequency: "weekly", category: "Hidden", itemType: "expense", isActive: false },
    ])).toEqual([
      { category: "Pay", frequency: "weekly", kind: "income", amount: 0, count: 1 },
      { category: "UNCATEGORIZED", frequency: "unknown", kind: "income", amount: 0, count: 1 },
    ]);
    expect(buildMcpNetWorthTrend([
      { snapshot_month: "2026-03-01", assets: null, liabilities: "bad" },
      { snapshot_month: "2026-01-01", assets: 10.126, liabilities: 2.125 },
    ])).toEqual([
      { month: "2026-01-01", assets: 10.13, liabilities: 2.13, netWorth: 8 },
      { month: "2026-03-01", assets: 0, liabilities: 0, netWorth: 0 },
    ]);
  });
});
