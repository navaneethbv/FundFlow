import { describe, expect, it } from "vitest";
import { cashFlowPeriodKey, computePeriodCashFlow } from "@/lib/cash-flow";
import type { CanonicalFinanceTransaction } from "@/lib/finance-domain";

function row(date: string, amount: number, flow: CanonicalFinanceTransaction["flow"] = "expense"): CanonicalFinanceTransaction {
  return { id: `${date}:${amount}`, sourceTransactionId: date, date, signedAmount: amount, flow,
    merchant: "Shop", groupKey: "FOOD_AND_DRINK", categoryKey: "GROCERIES", accountId: "account",
    manualAccountId: null, pending: false, source: "plaid" };
}

describe("report trend intervals", () => {
  it("keeps calendar days separate including leap day", () => {
    expect(cashFlowPeriodKey("2024-02-29", "daily")).toBe("2024-02-29");
    const periods = computePeriodCashFlow([row("2024-02-29", 40), row("2024-03-01", -10)], "daily");
    expect(periods.map(p => [p.key, p.expenses])).toEqual([["2024-02-29", 40], ["2024-03-01", -10]]);
    expect(periods[0]?.label).toBe("Feb 29, 2024");
  });

  it("uses Monday-start weeks across year boundaries and excludes transfers", () => {
    expect(cashFlowPeriodKey("2023-01-01", "weekly")).toBe("2022-12-26");
    expect(cashFlowPeriodKey("2023-01-02", "weekly")).toBe("2023-01-02");
    const periods = computePeriodCashFlow([
      row("2022-12-30", 30), row("2023-01-01", -5), row("2023-01-01", -100, "income"),
      row("2023-01-01", 900, "transfer"), row("2023-01-02", 10),
    ], "weekly");
    expect(periods).toHaveLength(2);
    expect(periods[0]).toEqual({ key: "2022-12-26", label: "Week of Dec 26, 2022", income: 100, expenses: 25, savings: 75, savingsRate: 75 });
  });
});
