import { describe, expect, it } from "vitest";
import { buildLookthroughSummary, parseConstituentWeights, parseLookthroughData } from "@/lib/portfolio-lookthrough";

describe("portfolio look-through", () => {
  it("requires stable, conserving constituent weights", () => {
    expect(parseConstituentWeights([{ key: "ticker:A", name: "A", sector: "Tech", region: "US", weight: 0.5 }])).toMatchObject({ ok: false });
    expect(parseConstituentWeights([
      { key: "ticker:A", name: "A", sector: "Tech", region: "US", weight: 0.5 },
      { key: "ticker:A", name: "Again", sector: "Tech", region: "US", weight: 0.5 },
    ])).toMatchObject({ ok: false });
    expect(parseLookthroughData({ asOfDate: "2026-02-31", weights: [{ key: "ticker:A", name: "A", sector: "Tech", region: "US", weight: 1 }] })).toMatchObject({ ok: false });
    expect(parseLookthroughData({ asOfDate: "2099-01-01", weights: [{ key: "ticker:A", name: "A", sector: "Tech", region: "US", weight: 1 }] })).toMatchObject({ ok: false });
  });

  it("merges direct and fund exposure without double-counting the stock", () => {
    const holdings = [
      { id: "direct", securityName: "Apple", ticker: "AAPL", securityType: "equity", value: 100 },
      { id: "fund", securityName: "Example fund", ticker: "FUND", securityType: "etf", value: 100 },
      { id: "unknown-fund", securityName: "Unpriced fund", ticker: null, securityType: "mutual fund", value: 25 },
    ] as const;
    const records = [{
      holdingId: "fund",
      version: 1,
      source: "manual" as const,
      asOfDate: "2026-01-01",
      weights: [
        { key: "ticker:AAPL", name: "Apple", sector: "Technology", region: "North America", weight: 0.5 },
        { key: "unknown:other", name: "Other holdings", sector: "Unknown", region: "Unknown", weight: 0.5 },
      ],
    }];
    const summary = buildLookthroughSummary(holdings, records);
    expect(summary.totalValue).toBe(225);
    expect(summary.coveredValue).toBe(150);
    expect(summary.unknownValue).toBe(75);
    expect(summary.coveragePct).toBeCloseTo(66.67, 2);
    expect(summary.unknownHoldingCount).toBe(1);
    expect(summary.bySecurity[0]).toMatchObject({ key: "ticker:AAPL", value: 150, weightPct: 66.67 });
    expect(summary.bySecurity[0]?.contributors.map((row) => row.holdingId)).toEqual(["direct", "fund"]);
    expect(summary.byRegion.some((row) => row.name === "North America" && row.value === 50)).toBe(true);
  });
});
