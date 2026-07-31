import { describe, it, expect } from "vitest";
import {
  computeTimeWeightedReturn,
  hasSufficientPerformanceData,
} from "@/lib/investment-performance";

describe("hasSufficientPerformanceData", () => {
  it("requires at least two valuation points", () => {
    expect(hasSufficientPerformanceData([])).toBe(false);
    expect(hasSufficientPerformanceData([{ date: "2026-07-01", value: 100 }])).toBe(false);
    expect(
      hasSufficientPerformanceData([
        { date: "2026-07-01", value: 100 },
        { date: "2026-07-02", value: 101 },
      ]),
    ).toBe(true);
  });
});

describe("computeTimeWeightedReturn", () => {
  it("returns an empty series for no valuations", () => {
    expect(computeTimeWeightedReturn({ valuations: [], externalFlows: [] })).toEqual([]);
  });

  it("returns a single 0% point for one valuation", () => {
    const result = computeTimeWeightedReturn({
      valuations: [{ date: "2026-07-01", value: 1000 }],
      externalFlows: [],
    });
    expect(result).toEqual([{ date: "2026-07-01", pct: 0 }]);
  });

  it("computes pure market growth with no flows", () => {
    const result = computeTimeWeightedReturn({
      valuations: [
        { date: "2026-07-01", value: 1000 },
        { date: "2026-07-31", value: 1100 },
      ],
      externalFlows: [],
    });
    expect(result).toEqual([
      { date: "2026-07-01", pct: 0 },
      { date: "2026-07-31", pct: 10 },
    ]);
  });

  it("removes a deposit from the return instead of counting it as a gain", () => {
    // Balance rose from 1000 to 2000, but 1000 of that was a fresh deposit —
    // the market contributed nothing.
    const result = computeTimeWeightedReturn({
      valuations: [
        { date: "2026-07-01", value: 1000 },
        { date: "2026-07-02", value: 2000 },
      ],
      externalFlows: [{ date: "2026-07-02", amount: 1000 }],
    });
    expect(result[1].pct).toBe(0);
  });

  it("removes a withdrawal from the return instead of counting it as a loss", () => {
    const result = computeTimeWeightedReturn({
      valuations: [
        { date: "2026-07-01", value: 1000 },
        { date: "2026-07-02", value: 500 },
      ],
      externalFlows: [{ date: "2026-07-02", amount: -500 }],
    });
    expect(result[1].pct).toBe(0);
  });

  it("reflects a fee as a real (small negative) return rather than excluding it", () => {
    const result = computeTimeWeightedReturn({
      valuations: [
        { date: "2026-07-01", value: 1000 },
        { date: "2026-07-02", value: 990 },
      ],
      externalFlows: [],
    });
    expect(result[1].pct).toBe(-1);
  });

  it("treats a flat price series as 0% throughout", () => {
    const result = computeTimeWeightedReturn({
      valuations: [
        { date: "2026-07-01", value: 1000 },
        { date: "2026-07-15", value: 1000 },
        { date: "2026-07-30", value: 1000 },
      ],
      externalFlows: [],
    });
    expect(result.map((p) => p.pct)).toEqual([0, 0, 0]);
  });

  it("spans a gap of missing valuation days as one sub-period", () => {
    const result = computeTimeWeightedReturn({
      valuations: [
        { date: "2026-07-01", value: 1000 },
        { date: "2026-07-30", value: 1050 },
      ],
      externalFlows: [],
    });
    expect(result).toHaveLength(2);
    expect(result[1].pct).toBe(5);
  });

  it("sums multiple same-day flows into one sub-period adjustment", () => {
    const result = computeTimeWeightedReturn({
      valuations: [
        { date: "2026-07-01", value: 1000 },
        { date: "2026-07-02", value: 3000 },
      ],
      externalFlows: [
        { date: "2026-07-02", amount: 1000 },
        { date: "2026-07-02", amount: 1000 },
      ],
    });
    expect(result[1].pct).toBe(0);
  });

  it("does not report an infinite return from a zero starting balance", () => {
    const result = computeTimeWeightedReturn({
      valuations: [
        { date: "2026-07-01", value: 0 },
        { date: "2026-07-02", value: 500 },
      ],
      externalFlows: [],
    });
    expect(result[1].pct).toBe(0);
  });

  it("chain-links returns across more than two sub-periods", () => {
    // +10% then +10% compounds to +21%, not +20%.
    const result = computeTimeWeightedReturn({
      valuations: [
        { date: "2026-07-01", value: 1000 },
        { date: "2026-07-15", value: 1100 },
        { date: "2026-07-30", value: 1210 },
      ],
      externalFlows: [],
    });
    expect(result.map((p) => p.pct)).toEqual([0, 10, 21]);
  });
});
