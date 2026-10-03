import { describe, expect, it } from "vitest";
import {
  buildAmortizationSchedule,
  compareAmortizationInterest,
} from "@/lib/amortization";

describe("buildAmortizationSchedule", () => {
  it("returns an empty schedule for a zero principal balance", () => {
    const result = buildAmortizationSchedule({
      principal: 0,
      startDate: "2026-01-01",
      paymentAmount: 100,
      ratePeriods: [{ start: "2026-01-01", annualRate: 5 }],
    });
    expect(result.rows).toEqual([]);
    expect(result.payoffDate).toBe("2026-01-01");
  });

  it("caps the final payment and reconciles principal plus interest", () => {
    const result = buildAmortizationSchedule({
      principal: 100,
      startDate: "2026-01-31",
      paymentAmount: 60,
      ratePeriods: [{ start: "2026-01-31", annualRate: 0 }],
    });
    expect(result.rows.at(-1)?.scheduledPayment).toBe(40);
    expect(result.rows.at(-1)?.closingPrincipal).toBe(0);
    expect(result.totalPayments).toBe(100);
    expect(result.payoffDate).toBe("2026-02-28");
  });

  it("handles leap-day payment dates", () => {
    const result = buildAmortizationSchedule({
      principal: 120,
      startDate: "2028-02-29",
      paymentAmount: 60,
      paymentDay: 31,
      ratePeriods: [{ start: "2028-02-29", annualRate: 0 }],
    });
    expect(result.rows.map((row) => row.date)).toEqual(["2028-02-29", "2028-03-31"]);
  });

  it("uses the new rate on a payment-date rate change and reamortizes", () => {
    const result = buildAmortizationSchedule({
      principal: 1_000,
      startDate: "2026-01-01",
      paymentAmount: 100,
      termMonths: 12,
      ratePeriods: [
        { start: "2026-01-01", annualRate: 0, strategy: "hold" },
        { start: "2026-02-01", annualRate: 12, strategy: "reamortize" },
      ],
      periodCap: 24,
    });
    expect(result.rows[1]?.annualRate).toBe(12);
    expect(result.rows[1]?.scheduledPayment).toBeGreaterThan(80);
  });

  it("applies dated extra payments and reports interest saved", () => {
    const input = {
      principal: 1_000,
      startDate: "2026-01-15",
      paymentAmount: 100,
      ratePeriods: [{ start: "2026-01-15", annualRate: 12 }],
      extraPayments: [{ date: "2026-02-15", amount: 200 }],
    };
    const comparison = compareAmortizationInterest(input);
    expect(comparison.withExtras.rows[1]?.extraPayment).toBe(200);
    expect(comparison.interestSaved).toBeGreaterThan(0);
  });

  it("refuses a non-amortizing payment and a reached period cap", () => {
    expect(() => buildAmortizationSchedule({
      principal: 1_000,
      startDate: "2026-01-01",
      paymentAmount: 1,
      ratePeriods: [{ start: "2026-01-01", annualRate: 24 }],
    })).toThrow("AMORTIZATION_NON_AMORTIZING");

    expect(() => buildAmortizationSchedule({
      principal: 1_000,
      startDate: "2026-01-01",
      paymentAmount: 10,
      ratePeriods: [{ start: "2026-01-01", annualRate: 0 }],
      periodCap: 2,
    })).toThrow("AMORTIZATION_PERIOD_CAP");
  });

  it("validates money, dates, rates, extras, and payment periods", () => {
    const base = { principal: 100, startDate: "2026-01-01", paymentAmount: 20, ratePeriods: [{ start: "2026-01-01", annualRate: 0 }] };
    expect(() => buildAmortizationSchedule({ ...base, principal: -1 })).toThrow("principal");
    expect(() => buildAmortizationSchedule({ ...base, paymentAmount: 0 })).toThrow("paymentAmount");
    expect(() => buildAmortizationSchedule({ ...base, startDate: "bad" })).toThrow("startDate");
    expect(() => buildAmortizationSchedule({ ...base, ratePeriods: [] })).toThrow("rate period");
    expect(() => buildAmortizationSchedule({ ...base, ratePeriods: [{ start: "bad", annualRate: 0 }] })).toThrow("rate period start");
    expect(() => buildAmortizationSchedule({ ...base, ratePeriods: [{ start: "2026-01-01", annualRate: -1 }] })).toThrow("annualRate");
    expect(() => buildAmortizationSchedule({ ...base, extraPayments: [{ date: "bad", amount: 1 }] })).toThrow("extra payment date");
    expect(() => buildAmortizationSchedule({ ...base, extraPayments: [{ date: "2026-01-01", amount: -1 }] })).toThrow("extra payment amount");
  });

  it("holds the prior payment through a rate change", () => {
    const result = buildAmortizationSchedule({
      principal: 500,
      startDate: "2026-01-01",
      paymentAmount: 100,
      ratePeriods: [
        { start: "2026-01-01", annualRate: 0, strategy: "hold" },
        { start: "2026-02-01", annualRate: 24, strategy: "hold" },
      ],
    });
    expect(result.rows[1]?.scheduledPayment).toBe(100);
    expect(result.rows[1]?.annualRate).toBe(24);
  });
});
