import { describe, it, expect } from "vitest";
import { forecastNetWorth } from "@/lib/forecasting";

describe("lib/forecasting.ts", () => {
  it("projects net worth over horizon months with conservative, base, and optimistic curves", () => {
    const points = forecastNetWorth(
      { cash: 10000, investments: 20000, liabilities: 5000 },
      {
        monthlySavings: 500,
        annualReturnPct: 7,
        annualCashYieldPct: 2,
        monthlyDebtPayment: 200,
        horizonMonths: 12,
      },
      "2026-07",
    );

    expect(points.length).toBe(12);
    expect(points[0].month).toBe("2026-08");

    const finalPoint = points[11];
    expect(finalPoint.optimistic).toBeGreaterThan(finalPoint.base);
    expect(finalPoint.base).toBeGreaterThan(finalPoint.conservative);
  });
});
