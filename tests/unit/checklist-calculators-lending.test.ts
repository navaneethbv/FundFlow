import { describe, expect, it } from "vitest";
import {
  calculateCompoundInterest,
  calculateEmergencyFund,
  calculateRentBuy,
} from "@/lib/calculators";
import {
  buildPrivateLoanBalance,
  summarizePrivateLending,
  validatePrivateLoanDraft,
  type PrivateLoanView,
} from "@/lib/private-lending";
import { mondayOf } from "@/lib/weekly-review";

describe("planning calculators", () => {
  it("computes compound growth with contributions separated from growth", () => {
    expect(calculateCompoundInterest({
      initial: 1_000,
      monthlyContribution: 100,
      annualReturn: 0,
      years: 1,
    })).toEqual({ futureValue: 2_200, contributions: 2_200, growth: 0 });
  });

  it("caps the emergency-fund gap at zero and reports covered months", () => {
    expect(calculateEmergencyFund({
      essentialMonthlySpend: 2_000,
      targetMonths: 6,
      currentSavings: 15_000,
    })).toEqual({ target: 12_000, gap: 0, monthsCovered: 7.5 });
  });

  it("returns a deterministic rent-buy scenario with a break-even month", () => {
    const result = calculateRentBuy({
      homePrice: 100_000,
      downPayment: 100_000,
      mortgageApr: 0,
      termYears: 10,
      propertyTaxMonthly: 0,
      insuranceMonthly: 0,
      maintenanceMonthly: 0,
      closingCosts: 0,
      monthlyRent: 1_000,
      rentGrowthApr: 0,
      homeAppreciationApr: 0,
      horizonYears: 1,
    });
    expect(result.monthlyMortgage).toBe(0);
    expect(result.rentCostAtHorizon).toBe(12_000);
    expect(result.homeEquityAtHorizon).toBe(100_000);
    expect(result.buyNetCostAtHorizon).toBe(0);
    expect(result.breakEvenMonth).toBe(1);
  });

  it("handles amortizing principal and zero-month horizons", () => {
    const result = calculateRentBuy({
      homePrice: 240_000,
      downPayment: 40_000,
      mortgageApr: 6,
      termYears: 30,
      propertyTaxMonthly: 100,
      insuranceMonthly: 50,
      maintenanceMonthly: 75,
      closingCosts: 5_000,
      monthlyRent: 1_500,
      rentGrowthApr: 2,
      homeAppreciationApr: 3,
      horizonYears: 0,
    });
    expect(result.monthlyMortgage).toBeGreaterThan(0);
    expect(result.rentCostAtHorizon).toBe(0);
    expect(result.homeEquityAtHorizon).toBe(40_000);
    expect(result.breakEvenMonth).toBeNull();
  });
});

describe("private lending", () => {
  const loan = {
    principal: 1_000,
    annualInterestRate: 36.5,
    startDate: "2026-01-01",
    payments: [],
  } as const;

  it("accrues simple daily interest and applies payments to interest first", () => {
    const balance = buildPrivateLoanBalance({
      ...loan,
      payments: [{ id: "p1", paymentDate: "2026-01-11", amount: 15, note: null }],
    }, "2026-01-11");
    expect(balance.paidInterest).toBe(10);
    expect(balance.paidPrincipal).toBe(5);
    expect(balance.principalOutstanding).toBe(995);
    expect(balance.accruedInterest).toBe(0);
  });

  it("summarizes receivables and payables as a net-worth adjustment", () => {
    const views = [
      { balance: { totalOutstanding: 400 }, direction: "lent" },
      { balance: { totalOutstanding: 150 }, direction: "borrowed" },
    ] as PrivateLoanView[];
    expect(summarizePrivateLending(views)).toEqual({ receivable: 400, payable: 150, netWorthAdjustment: 250 });
  });

  it("rejects malformed drafts at the API boundary", () => {
    expect(validatePrivateLoanDraft({ direction: "lent", counterparty: "", principal: 10, annualInterestRate: 0, startDate: "2026-01-01" })).toEqual({ ok: false, error: "Counterparty must be 1 to 120 characters" });
    expect(validatePrivateLoanDraft({ direction: "borrowed", counterparty: "A", principal: 10, annualInterestRate: 0, startDate: "2026-01-01", dueDate: "2025-12-31" })).toEqual({ ok: false, error: "Due date must be on or after the start date" });
    expect(validatePrivateLoanDraft({ direction: "lent", counterparty: "A", principal: 10, startDate: "2026-02-31" })).toEqual({ ok: false, error: "Start date must be YYYY-MM-DD" });
    expect(validatePrivateLoanDraft({ direction: "lent", counterparty: "A", principal: 10, startDate: "2026-01-01", dueDate: "2026-13-01" })).toEqual({ ok: false, error: "Due date must be on or after the start date" });
  });
});

describe("weekly review", () => {
  it.each([
    ["2026-10-05", "2026-10-05"],
    ["2026-10-07", "2026-10-05"],
    ["2026-10-11", "2026-10-05"],
  ])("normalizes %s to Monday %s", (date, expected) => {
    expect(mondayOf(date)).toBe(expected);
  });
});
