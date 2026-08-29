import { describe, expect, it } from "vitest";
import {
  forecastNetWorthWithLifeEvents,
  type ForecastAssumptions,
  type LifeEvent,
} from "@/lib/forecasting";

describe("Phase 6: Life Event Forecasting", () => {
  const current = {
    cash: 20000,
    investments: 50000,
    liabilities: 10000,
  };

  const assumptions: ForecastAssumptions = {
    monthlySavings: 1000,
    annualReturnPct: 7,
    annualCashYieldPct: 4,
    monthlyDebtPayment: 500,
    horizonMonths: 12,
  };

  it("projects net worth without events matching standard forecast", () => {
    const points = forecastNetWorthWithLifeEvents(current, assumptions, []);
    expect(points).toHaveLength(12);
    expect(points[0]?.base).toBeGreaterThan(60000);
  });

  it("applies a one-time cash impact for a home purchase down payment", () => {
    const events: LifeEvent[] = [
      {
        id: "ev-downpayment",
        name: "Home Down Payment",
        type: "home_purchase",
        monthOffset: 6,
        oneTimeCashImpact: -15000,
      },
    ];

    const baseline = forecastNetWorthWithLifeEvents(current, assumptions, []);
    const withEvent = forecastNetWorthWithLifeEvents(current, assumptions, events);

    // Month 5 is unaffected
    expect(withEvent[4]?.base).toEqual(baseline[4]?.base);
    // Month 6 reflects the one-time cash deduction plus yield delta
    expect(withEvent[5]!.base).toBeLessThan(baseline[5]!.base);
    expect(baseline[5]!.base - withEvent[5]!.base).toBeGreaterThanOrEqual(15000);
    expect(baseline[5]!.base - withEvent[5]!.base).toBeLessThan(15100);
  });

  it("applies monthly recurring income/expense adjustments from a career change or new child", () => {
    const events: LifeEvent[] = [
      {
        id: "ev-career",
        name: "Promotion",
        type: "career_change",
        monthOffset: 3,
        monthlyIncomeDelta: 500,
      },
    ];

    const baseline = forecastNetWorthWithLifeEvents(current, assumptions, []);
    const withPromotion = forecastNetWorthWithLifeEvents(current, assumptions, events);

    // Month 2 unchanged
    expect(withPromotion[1]?.base).toEqual(baseline[1]?.base);
    // Month 12 has accumulated extra savings
    expect(withPromotion[11]!.base).toBeGreaterThan(baseline[11]!.base);
  });
});
