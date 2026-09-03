import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import FireSimulator from "@/components/forecasting/FireSimulator";

describe("FireSimulator Component Rendering", () => {
  it("renders FIRE milestone cards, progress, and life event controls", () => {
    const html = renderToStaticMarkup(
      createElement(FireSimulator, {
        initialNetWorth: 150000,
        initialMonthlyIncome: 7500,
        initialMonthlySpend: 4200,
        initialMonthlySavings: 3300,
      }),
    );

    expect(html).toContain("FIRE &amp; life-event simulator");
    expect(html).toContain("Lean FIRE");
    expect(html).toContain("Standard FIRE");
    expect(html).toContain("Fat FIRE");
    expect(html).toContain("Current FIRE progress");
    expect(html).toContain("Scheduled life event scenarios");
  });
});
