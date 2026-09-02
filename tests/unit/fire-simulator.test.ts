import { describe, it, expect } from "vitest";
import { calculateFireSimulation, type FireSimulatorInput } from "@/lib/fire-simulator";
import { parseNumericInput } from "@/components/forecasting/FireSimulator";

describe("FireSimulator numeric input parsing", () => {
  it("preserves a typed 0 instead of snapping to the default", () => {
    expect(parseNumericInput("0", 4.0)).toBe(0);
    expect(parseNumericInput("0.", 0)).toBe(0);
    expect(parseNumericInput("-3", 0)).toBe(-3);
  });

  it("falls back only for empty or non-numeric input", () => {
    expect(parseNumericInput("", 4.0)).toBe(4.0);
    expect(parseNumericInput("   ", 30)).toBe(30);
    expect(parseNumericInput("abc", 4.0)).toBe(4.0);
    expect(parseNumericInput("42", 4.0)).toBe(42);
  });
});

describe("FIRE Simulator: Calculations & Milestones", () => {
  const baseInput: FireSimulatorInput = {
    currentNetWorth: 100000,
    monthlyIncome: 6000,
    monthlySpend: 4000,
    monthlySavings: 2000,
    annualReturnPct: 8.0,
    withdrawalRatePct: 4.0,
    currentAge: 30,
    projectionHorizonMonths: 240,
  };

  it("computes accurate standard, lean, and fat FIRE targets based on annual spend", () => {
    const result = calculateFireSimulation(baseInput);
    // Annual spend = 4000 * 12 = 48,000
    // Standard FIRE = 48000 / 0.04 = 1,200,000
    // Lean FIRE = (48000 * 0.75) / 0.04 = 900,000
    // Fat FIRE = (48000 * 1.5) / 0.04 = 1,800,000
    expect(result.milestones.standardFireTarget).toBe(1200000);
    expect(result.milestones.leanFireTarget).toBe(900000);
    expect(result.milestones.fatFireTarget).toBe(1800000);
  });

  it("calculates progress percentage and savings rate", () => {
    const result = calculateFireSimulation(baseInput);
    // 100,000 / 1,200,000 = 8.33%
    expect(result.currentProgressPct).toBe(8.33);
    // 2000 / 6000 = 33.33%
    expect(result.savingsRatePct).toBe(33.33);
  });

  it("projects reaching FIRE and computes projected age", () => {
    const result = calculateFireSimulation(baseInput);
    expect(result.monthsToStandardFire).toBeGreaterThan(0);
    expect(result.projectedFireAge).toBeGreaterThan(30);
    expect(result.projectedFireAge).toBeLessThan(65);
  });

  it("incorporates life events into timeline projection", () => {
    const withEvents = calculateFireSimulation({
      ...baseInput,
      lifeEvents: [
        {
          id: "ev-1",
          name: "Inheritance",
          monthOffset: 12,
          oneTimeCashFlow: 150000,
        },
      ],
    });

    const month13Without = calculateFireSimulation(baseInput).timeline[13]!;
    const month13With = withEvents.timeline[13]!;

    expect(month13With.netWorthWithEvents).toBeGreaterThan(month13Without.netWorthBase + 100000);
  });

  it("handles edge cases gracefully (zero income, negative net worth)", () => {
    const zeroIncome = calculateFireSimulation({
      ...baseInput,
      monthlyIncome: 0,
      currentNetWorth: -10000,
    });
    expect(zeroIncome.savingsRatePct).toBe(0);
    expect(zeroIncome.currentProgressPct).toBe(0);
    expect(zeroIncome.timeline).toHaveLength(241);
  });

  it("clamps a non-positive withdrawal rate so targets stay finite", () => {
    const result = calculateFireSimulation({ ...baseInput, withdrawalRatePct: -2 });
    expect(Number.isFinite(result.milestones.standardFireTarget)).toBe(true);
    expect(result.milestones.standardFireTarget).toBeGreaterThan(0);
    expect(Number.isFinite(result.milestones.coastFireTarget)).toBe(true);
  });

  it("clamps returns at or below -100% so the timeline stays numeric", () => {
    const result = calculateFireSimulation({ ...baseInput, annualReturnPct: -120 });
    for (const point of result.timeline) {
      expect(Number.isFinite(point.netWorthBase)).toBe(true);
      expect(Number.isFinite(point.netWorthWithEvents)).toBe(true);
    }
  });
});
