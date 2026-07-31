import { describe, it, expect } from "vitest";
import {
  computeForecastDefaults,
  computeForecastStartingState,
  computeWhatIfProjection,
  forecastNetWorth,
  parseForecastAssumptions,
} from "@/lib/forecasting";
import type { CanonicalFinanceTransaction } from "@/lib/finance-domain";

describe("computeWhatIfProjection", () => {
  it("computes monthly surplus from income and spend deltas", () => {
    const result = computeWhatIfProjection({
      cashBalance: 5000,
      monthlyIncome: 4000,
      monthlySpend: 3000,
      monthlyEssentials: [1000, 1200],
      debts: [],
      incomeDelta: 500,
      spendDelta: -200,
      extraDebt: 0,
    });
    expect(result.surplus).toBe(4000 + 500 - (3000 - 200));
  });

  it("floors an essential category at 0 rather than letting a spend cut go negative", () => {
    const result = computeWhatIfProjection({
      cashBalance: 1000,
      monthlyIncome: 3000,
      monthlySpend: 2000,
      monthlyEssentials: [100, 1000],
      debts: [],
      incomeDelta: 0,
      spendDelta: -500,
      extraDebt: 0,
    });
    // The 100 category floors at 0 instead of going to -400 (which would
    // otherwise drag the median essential below zero); the 1000 category
    // still nets a sensible 500, so runway is 1000/500 = 2 months, not a
    // number distorted by a negative essential in the mix.
    expect(result.runwayMonths).toBe(2);
  });

  it("returns null runway with no essentials to measure against", () => {
    const result = computeWhatIfProjection({
      cashBalance: 1000,
      monthlyIncome: 3000,
      monthlySpend: 2000,
      monthlyEssentials: [],
      debts: [],
      incomeDelta: 0,
      spendDelta: 0,
      extraDebt: 0,
    });
    expect(result.runwayMonths).toBeNull();
  });

  it("returns a null plan with no debts", () => {
    const result = computeWhatIfProjection({
      cashBalance: 1000,
      monthlyIncome: 3000,
      monthlySpend: 2000,
      monthlyEssentials: [500],
      debts: [],
      incomeDelta: 0,
      spendDelta: 0,
      extraDebt: 100,
    });
    expect(result.plan).toBeNull();
  });

  it("builds a payoff plan when debts are present", () => {
    const result = computeWhatIfProjection({
      cashBalance: 1000,
      monthlyIncome: 3000,
      monthlySpend: 2000,
      monthlyEssentials: [500],
      debts: [{ name: "Card", balance: 1000, apr: 20 }],
      incomeDelta: 0,
      spendDelta: 0,
      extraDebt: 100,
    });
    expect(result.plan).not.toBeNull();
    expect(result.plan!.months).toBeGreaterThan(0);
  });
});

describe("forecastNetWorth", () => {
  const BASE_ASSUMPTIONS = {
    monthlySavings: 0,
    annualReturnPct: 0,
    annualCashYieldPct: 0,
    monthlyDebtPayment: 0,
    horizonMonths: 12 as const,
  };

  it("returns one point per month of the horizon", () => {
    const points = forecastNetWorth({ cash: 1000, investments: 0, liabilities: 0 }, BASE_ASSUMPTIONS);
    expect(points).toHaveLength(12);
    expect(points[0].month).toBe("Month 1");
    expect(points[11].month).toBe("Month 12");
  });

  it("compounds monthly savings into cash with no growth", () => {
    const points = forecastNetWorth(
      { cash: 0, investments: 0, liabilities: 0 },
      { ...BASE_ASSUMPTIONS, monthlySavings: 100, horizonMonths: 12 },
    );
    expect(points[11].base).toBe(1200);
  });

  it("compounds investment growth monthly, not linearly", () => {
    const points = forecastNetWorth(
      { cash: 0, investments: 1000, liabilities: 0 },
      { ...BASE_ASSUMPTIONS, annualReturnPct: 12, horizonMonths: 12 },
    );
    // 1% monthly compounded 12 times beats a naive 12% flat add.
    expect(points[11].base).toBeGreaterThan(1120);
  });

  it("applies a cash yield separately from investment return", () => {
    const points = forecastNetWorth(
      { cash: 1000, investments: 0, liabilities: 0 },
      { ...BASE_ASSUMPTIONS, annualCashYieldPct: 12, horizonMonths: 12 },
    );
    expect(points[11].base).toBeGreaterThan(1000);
  });

  it("treats negative monthly savings as a drawdown", () => {
    const points = forecastNetWorth(
      { cash: 1000, investments: 0, liabilities: 0 },
      { ...BASE_ASSUMPTIONS, monthlySavings: -100, horizonMonths: 12 },
    );
    expect(points[4].base).toBe(500); // month 5: 1000 - 100*5
  });

  it("reduces liabilities by the monthly debt payment, flooring at zero", () => {
    const points = forecastNetWorth(
      { cash: 0, investments: 0, liabilities: 300 },
      { ...BASE_ASSUMPTIONS, monthlyDebtPayment: 100, horizonMonths: 12 },
    );
    // Paid off after 3 months; never goes negative from there.
    expect(points[2].base).toBe(0);
    expect(points[11].base).toBe(0);
  });

  it("rounds every point to the currency's minor unit", () => {
    const points = forecastNetWorth(
      { cash: 1000.005, investments: 0, liabilities: 0 },
      { ...BASE_ASSUMPTIONS, horizonMonths: 12 },
    );
    expect(Number.isInteger(points[0].base * 100)).toBe(true);
  });

  it("orders conservative <= base <= optimistic with a positive return", () => {
    const points = forecastNetWorth(
      { cash: 0, investments: 10000, liabilities: 0 },
      { ...BASE_ASSUMPTIONS, annualReturnPct: 5, horizonMonths: 60 },
    );
    for (const p of points) {
      expect(p.conservative).toBeLessThanOrEqual(p.base);
      expect(p.base).toBeLessThanOrEqual(p.optimistic);
    }
  });

  it("keeps the same ordering with a negative assumed return", () => {
    const points = forecastNetWorth(
      { cash: 0, investments: 10000, liabilities: 0 },
      { ...BASE_ASSUMPTIONS, annualReturnPct: -5, horizonMonths: 12 },
    );
    for (const p of points) {
      expect(p.conservative).toBeLessThanOrEqual(p.base);
      expect(p.base).toBeLessThanOrEqual(p.optimistic);
    }
  });

  it("supports all three horizon lengths", () => {
    for (const horizonMonths of [12, 60, 120] as const) {
      const points = forecastNetWorth({ cash: 0, investments: 0, liabilities: 0 }, { ...BASE_ASSUMPTIONS, horizonMonths });
      expect(points).toHaveLength(horizonMonths);
    }
  });
});

describe("computeForecastStartingState", () => {
  it("buckets accounts into cash, investments, and liabilities using the accounts-page classification", () => {
    const state = computeForecastStartingState(
      [
        { type: "depository", subtype: "checking", balance: 5000 },
        { type: "investment", subtype: "brokerage", balance: 20000 },
        { type: "credit", subtype: "credit card", balance: 1500 },
      ],
      [],
    );
    expect(state).toEqual({ cash: 5000, investments: 20000, liabilities: 1500 });
  });

  it("takes a liability balance as positive regardless of its stored sign", () => {
    const state = computeForecastStartingState(
      [{ type: "loan", subtype: "student", balance: -1000 }],
      [],
    );
    expect(state.liabilities).toBe(1000);
  });

  it("includes manual accounts alongside Plaid ones", () => {
    const state = computeForecastStartingState(
      [],
      [
        { accountType: "cash", balance: 200 },
        { accountType: "investment", balance: 3000 },
        { accountType: "debt", balance: 400 },
      ],
    );
    expect(state).toEqual({ cash: 200, investments: 3000, liabilities: 400 });
  });
});

describe("computeForecastDefaults", () => {
  function txn(month: string, partial: Partial<CanonicalFinanceTransaction>): CanonicalFinanceTransaction {
    return {
      id: `${month}-${Math.random()}`,
      sourceTransactionId: "s",
      date: `${month}-15`,
      signedAmount: 0,
      flow: "expense",
      merchant: "M",
      groupKey: "FOOD_AND_DRINK",
      categoryKey: "food",
      accountId: "a1",
      manualAccountId: null,
      pending: false,
      source: "plaid",
      ...partial,
    };
  }

  it("uses the median of trailing monthly (income - expenses) as the savings default", () => {
    const months = ["2026-05", "2026-06", "2026-07"];
    const txns = [
      txn("2026-05", { signedAmount: -3000, flow: "income" }),
      txn("2026-05", { signedAmount: 2000, flow: "expense" }),
      txn("2026-06", { signedAmount: -3000, flow: "income" }),
      txn("2026-06", { signedAmount: 2500, flow: "expense" }),
      txn("2026-07", { signedAmount: -3000, flow: "income" }),
      txn("2026-07", { signedAmount: 2200, flow: "expense" }),
    ];
    // Net: 1000, 500, 800 -> median 800
    const defaults = computeForecastDefaults(txns, months);
    expect(defaults.monthlySavings).toBe(800);
  });

  it("floors a negative median savings at 0 rather than projecting a shrinking default", () => {
    const months = ["2026-07"];
    const txns = [
      txn("2026-07", { signedAmount: -1000, flow: "income" }),
      txn("2026-07", { signedAmount: 2000, flow: "expense" }),
    ];
    expect(computeForecastDefaults(txns, months).monthlySavings).toBe(0);
  });

  it("uses the median of LOAN_PAYMENTS transfers as the debt payment default", () => {
    const months = ["2026-06", "2026-07"];
    const txns = [
      txn("2026-06", { signedAmount: 300, flow: "transfer", groupKey: "LOAN_PAYMENTS" }),
      txn("2026-07", { signedAmount: 500, flow: "transfer", groupKey: "LOAN_PAYMENTS" }),
    ];
    expect(computeForecastDefaults(txns, months).monthlyDebtPayment).toBe(400);
  });

  it("ignores transactions outside the requested months", () => {
    const months = ["2026-07"];
    const txns = [txn("2026-01", { signedAmount: -5000, flow: "income" })];
    expect(computeForecastDefaults(txns, months).monthlySavings).toBe(0);
  });

  it("defaults to 0 debt payment with no LOAN_PAYMENTS activity", () => {
    const months = ["2026-07"];
    const txns = [txn("2026-07", { signedAmount: 100, flow: "expense" })];
    expect(computeForecastDefaults(txns, months).monthlyDebtPayment).toBe(0);
  });
});

describe("parseForecastAssumptions", () => {
  const DEFAULTS = { monthlySavings: 500, monthlyDebtPayment: 200 };

  it("falls back to computed defaults with no query params", () => {
    const assumptions = parseForecastAssumptions({}, DEFAULTS);
    expect(assumptions).toEqual({
      monthlySavings: 500,
      annualReturnPct: 5,
      annualCashYieldPct: 0,
      monthlyDebtPayment: 200,
      horizonMonths: 12,
    });
  });

  it("reads every assumption from its own query param", () => {
    const assumptions = parseForecastAssumptions(
      {
        monthlySavings: "1000",
        annualReturnPct: "7",
        annualCashYieldPct: "2",
        monthlyDebtPayment: "300",
        horizon: "60",
      },
      DEFAULTS,
    );
    expect(assumptions).toEqual({
      monthlySavings: 1000,
      annualReturnPct: 7,
      annualCashYieldPct: 2,
      monthlyDebtPayment: 300,
      horizonMonths: 60,
    });
  });

  it("falls back to a default rather than crashing on a non-numeric value", () => {
    const assumptions = parseForecastAssumptions({ monthlySavings: "not-a-number" }, DEFAULTS);
    expect(assumptions.monthlySavings).toBe(500);
  });

  it("rejects an unsupported horizon and falls back to 12 months", () => {
    const assumptions = parseForecastAssumptions({ horizon: "36" }, DEFAULTS);
    expect(assumptions.horizonMonths).toBe(12);
  });

  it("takes the first value from a repeated query param", () => {
    const assumptions = parseForecastAssumptions({ monthlySavings: ["100", "200"] }, DEFAULTS);
    expect(assumptions.monthlySavings).toBe(100);
  });
});
