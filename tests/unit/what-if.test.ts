import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Source-level checks (repo convention for view wiring): the underlying
 * math (computeRunwayMonths, buildPayoffPlan) is unit-tested in
 * insights.test.ts / debt.test.ts; these assert the what-if panel actually
 * drives it client-side.
 */
describe("what-if simulator panel", () => {
  const source = readFileSync("components/dashboard/WhatIfPanel.tsx", "utf8");

  it("is a client component driving the pure planning math", () => {
    expect(source).toContain('"use client"');
    expect(source).toContain("computeRunwayMonths");
    expect(source).toContain("buildPayoffPlan");
    expect(source).toContain("formatCurrency");
  });

  it("offers income, spending, and extra-debt sliders", () => {
    const sliders = source.match(/type="range"/g) ?? [];
    expect(sliders).toHaveLength(3);
    expect(source).toContain("Income change");
    expect(source).toContain("Spending change");
    expect(source).toContain("Extra toward debt");
  });

  it("recomputes projections live and handles the divergent-plan case", () => {
    expect(source).toContain("useMemo");
    expect(source).toContain("Monthly surplus");
    // buildPayoffPlan returns null when payments can't cover interest
    expect(source).toMatch(/don'?t cover the interest|don&apos;t cover the interest/);
  });
});
