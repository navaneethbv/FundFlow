import { describe, it, expect } from "vitest";
import { buildBudgetPage, getMonthEndDate } from "@/lib/budget-page";
import type { CanonicalFinanceTransaction } from "@/lib/finance-domain";

describe("Phase 4 Budget Full Parity", () => {
  it("computes correct month end dates for standard months and leap years", () => {
    expect(getMonthEndDate("2026-07")).toBe("2026-07-31");
    expect(getMonthEndDate("2026-02")).toBe("2026-02-28");
    expect(getMonthEndDate("2028-02")).toBe("2028-02-29");
  });

  it("multiplies planned budget envelope limits by horizon multiplier", () => {
    const budgets = [
      { id: "b1", category: "GROCERIES", monthly_limit: 500, group_name: "flexible" },
    ];
    const txns: CanonicalFinanceTransaction[] = [];

    const monthlyData = buildBudgetPage({ month: "2026-07", horizon: "monthly", budgets, txns });
    const yearlyData = buildBudgetPage({ month: "2026-07", horizon: "yearly", budgets, txns });
    const decadeData = buildBudgetPage({ month: "2026-07", horizon: "decade", budgets, txns });

    expect(monthlyData.sections[2].lines[0].planned).toBe(500);
    expect(yearlyData.sections[2].lines[0].planned).toBe(6000);
    expect(decadeData.sections[2].lines[0].planned).toBe(60000);
  });
});
