import { describe, expect, it } from "vitest";
import { assessBudgetAllocation } from "@/lib/budget-allocation";

describe("assessBudgetAllocation", () => {
  it("warns when planned spending and contributions exceed planned income", () => {
    expect(assessBudgetAllocation({ incomePlanned: 5000, expensesPlanned: 4800, contributionsPlanned: 400 })).toEqual({
      status: "over",
      expectedIncome: 5000,
      allocated: 5200,
      overBy: 200,
    });
  });

  it("treats an exactly allocated budget as within income", () => {
    expect(assessBudgetAllocation({ incomePlanned: 5000, expensesPlanned: 4600, contributionsPlanned: 400 }).status).toBe("within");
  });

  it("ignores sub-cent rounding noise", () => {
    expect(assessBudgetAllocation({ incomePlanned: 100, expensesPlanned: 100.004, contributionsPlanned: 0 }).status).toBe("within");
  });

  it("reports unknown instead of guessing when no income is budgeted", () => {
    expect(assessBudgetAllocation({ incomePlanned: 0, expensesPlanned: 300, contributionsPlanned: 0 })).toEqual({
      status: "no_income",
      expectedIncome: 0,
      allocated: 300,
      overBy: 0,
    });
  });

  it("rejects non-finite totals rather than warning on bad data", () => {
    expect(assessBudgetAllocation({ incomePlanned: Number.NaN, expensesPlanned: 1, contributionsPlanned: 0 }).status).toBe("no_income");
    expect(assessBudgetAllocation({ incomePlanned: 100, expensesPlanned: Number.POSITIVE_INFINITY, contributionsPlanned: 0 }).status).toBe("within");
  });
});
